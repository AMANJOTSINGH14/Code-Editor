const { setTestEnv, connectTestDb, clearTestDb, disconnectTestDb } = require("../testUtils");

setTestEnv();
process.env.AGENT_RUNNER_ENABLED = "true";

// The Gemini client is mocked; the orchestrator, budget accounting, attempt
// persistence and retry logic under test are all real.
const mockGenerate = jest.fn();
jest.mock("../../src/agent-runner/agent/gemini.client", () => {
  const actual = jest.requireActual("../../src/agent-runner/agent/gemini.client");
  return {
    ...actual,
    generate: (...args) => mockGenerate(...args)
  };
});

// The sandbox is mocked too — this file is about the loop, not about Docker
// (executor.test.js covers that).
const mockExecute = jest.fn();
jest.mock("../../src/agent-runner/sandbox/executor", () => ({
  execute: (...args) => mockExecute(...args),
  setDockerClient: () => {}
}));

// Artifact collection touches the filesystem; not what this file exercises.
jest.mock("../../src/agent-runner/artifacts", () => ({
  buildSandboxBinds: () => [],
  collectAndPublish: async () => [],
  resolveArtifactPath: () => null
}));

const { runAgent } = require("../../src/agent-runner/agent/orchestrator");
const AgentRun = require("../../src/agent-runner/models/AgentRun");
const AgentTask = require("../../src/agent-runner/models/AgentTask");
const prompts = require("../../src/agent-runner/agent/prompts");
const { ModelUnavailableError } = require("../../src/agent-runner/agent/gemini.client");
const { DailyCapExceededError } = require("../../src/agent-runner/quota/budget");
const limiter = require("../../src/agent-runner/quota/limiter");

/**
 * Build a Gemini response in the format prompts.parseResponse expects.
 * @param {string} code - Program source.
 * @param {string} plan - Plan text.
 * @returns {Object} Mock client result.
 */
function geminiResponse(code, plan = "do the thing") {
  return {
    text: `### PLAN\n${plan}\n\n### CODE\n\`\`\`javascript\n${code}\n\`\`\``,
    model: "gemini-2.5-flash",
    promptTokens: 100,
    responseTokens: 50,
    totalTokens: 150,
    latencyMs: 500,
    retries: 0,
    queuedMs: 0
  };
}

/**
 * Build a sandbox execution result.
 * @param {Object} overrides - Field overrides.
 * @returns {Object} Executor result.
 */
function execResult(overrides = {}) {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 100,
    timedOut: false,
    outputTruncated: false,
    ...overrides
  };
}

describe("agent-runner orchestrator", () => {
  let task;

  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    mockGenerate.mockReset();
    mockExecute.mockReset();
    limiter.resetForTest();

    task = await AgentTask.create({
      name: "Parse CSV",
      slug: "parse-csv",
      prompt: "Parse the CSV and write totals.",
      fixtures: [{ name: "data.csv", content: "a,b\n1,2\n" }]
    });
  });

  /**
   * Create a queued run for the seeded task.
   * @returns {Promise<string>} Run id.
   */
  async function createRun() {
    const run = await AgentRun.create({
      taskId: task._id,
      triggerSource: "manual",
      status: "queued"
    });
    return run._id.toString();
  }

  describe("happy path", () => {
    it("succeeds on attempt 1 with a single Gemini call", async () => {
      mockGenerate.mockResolvedValueOnce(geminiResponse("console.log('ok')"));
      mockExecute.mockResolvedValueOnce(execResult({ stdout: "ok\n" }));

      const runId = await createRun();
      const result = await runAgent(runId);

      expect(result.status).toBe("succeeded");

      const run = await AgentRun.findById(runId);
      expect(run.status).toBe("succeeded");
      expect(run.attempts).toHaveLength(1);
      expect(run.attempts[0].exitCode).toBe(0);
      expect(run.attempts[0].generatedCode).toBe("console.log('ok')");
      // Plan and code arrive in ONE call, so a clean run costs exactly one.
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(run.geminiCalls).toHaveLength(1);
      expect(run.geminiCalls[0].totalTokens).toBe(150);
      expect(run.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("stamps the prompt version on every attempt", async () => {
      mockGenerate.mockResolvedValueOnce(geminiResponse("console.log(1)"));
      mockExecute.mockResolvedValueOnce(execResult());

      const runId = await createRun();
      await runAgent(runId);

      const run = await AgentRun.findById(runId);
      expect(run.attempts[0].promptVersion).toBe(prompts.PROMPT_VERSION);
    });
  });

  describe("self-correction", () => {
    it("feeds real stderr back and succeeds on attempt 2", async () => {
      mockGenerate
        .mockResolvedValueOnce(geminiResponse("throw new Error('boom')"))
        .mockResolvedValueOnce(geminiResponse("console.log('fixed')"));

      mockExecute
        .mockResolvedValueOnce(
          execResult({ exitCode: 1, stderr: "TypeError: Cannot read properties of undefined" })
        )
        .mockResolvedValueOnce(execResult({ stdout: "fixed\n" }));

      const runId = await createRun();
      const result = await runAgent(runId);

      expect(result.status).toBe("succeeded");
      expect(result.attempts).toBe(2);

      // The correction prompt must carry the ACTUAL stderr, not a summary —
      // reading real diagnostics is the mechanism being demonstrated.
      const correctionPrompt = mockGenerate.mock.calls[1][0].prompt;
      expect(correctionPrompt).toContain("TypeError: Cannot read properties of undefined");
      expect(correctionPrompt).toContain("throw new Error('boom')");
      expect(correctionPrompt).toContain("exited with code 1");
    });

    it("persists every attempt separately and never overwrites", async () => {
      mockGenerate
        .mockResolvedValueOnce(geminiResponse("v1", "plan one"))
        .mockResolvedValueOnce(geminiResponse("v2", "plan two"))
        .mockResolvedValueOnce(geminiResponse("v3", "plan three"));

      mockExecute
        .mockResolvedValueOnce(execResult({ exitCode: 1, stderr: "err one" }))
        .mockResolvedValueOnce(execResult({ exitCode: 1, stderr: "err two" }))
        .mockResolvedValueOnce(execResult({ stdout: "done" }));

      const runId = await createRun();
      await runAgent(runId);

      const run = await AgentRun.findById(runId);
      // The attempt history is the whole point of the demo — a successful
      // attempt 3 must not erase the two failures that preceded it.
      expect(run.attempts).toHaveLength(3);
      expect(run.attempts.map((a) => a.generatedCode)).toEqual(["v1", "v2", "v3"]);
      expect(run.attempts.map((a) => a.plan)).toEqual(["plan one", "plan two", "plan three"]);
      expect(run.attempts.map((a) => a.exitCode)).toEqual([1, 1, 0]);
      expect(run.attempts[0].stderr).toBe("err one");
      expect(run.attempts[1].stderr).toBe("err two");
      expect(run.attempts.map((a) => a.index)).toEqual([1, 2, 3]);
    });

    it("treats a timeout as a failure worth correcting", async () => {
      mockGenerate
        .mockResolvedValueOnce(geminiResponse("while(true){}"))
        .mockResolvedValueOnce(geminiResponse("console.log('bounded')"));

      mockExecute
        .mockResolvedValueOnce(execResult({ exitCode: null, timedOut: true, durationMs: 30000 }))
        .mockResolvedValueOnce(execResult());

      const runId = await createRun();
      const result = await runAgent(runId);

      expect(result.status).toBe("succeeded");
      const correctionPrompt = mockGenerate.mock.calls[1][0].prompt;
      expect(correctionPrompt).toContain("KILLED");
      expect(correctionPrompt).toContain("infinite loop");
    });
  });

  describe("bounded retries", () => {
    it("stops after max attempts and marks the run failed", async () => {
      mockGenerate.mockResolvedValue(geminiResponse("still broken"));
      mockExecute.mockResolvedValue(execResult({ exitCode: 1, stderr: "still failing" }));

      const runId = await createRun();
      const result = await runAgent(runId);

      expect(result.status).toBe("failed");

      const run = await AgentRun.findById(runId);
      expect(run.status).toBe("failed");
      // Max attempts is 3 — the loop must not run unbounded.
      expect(run.attempts).toHaveLength(3);
      expect(mockGenerate).toHaveBeenCalledTimes(3);
      expect(run.error.code).toBe("MAX_ATTEMPTS_EXHAUSTED");
    });

    it("reports timeout status when the final attempt timed out", async () => {
      mockGenerate.mockResolvedValue(geminiResponse("while(true){}"));
      mockExecute.mockResolvedValue(execResult({ exitCode: null, timedOut: true }));

      const runId = await createRun();
      const result = await runAgent(runId);

      // Distinct from `failed` because it implies a different fix.
      expect(result.status).toBe("timeout");
      expect((await AgentRun.findById(runId)).status).toBe("timeout");
    });
  });

  describe("quota enforcement", () => {
    it("terminates as budget_exceeded without retrying", async () => {
      // config is a plain object read once at module load, so the budget is
      // lowered by patching it directly rather than juggling env + resetModules.
      const runnerConfig = require("../../src/agent-runner/config");
      const originalBudget = runnerConfig.gemini.callsPerRun;
      runnerConfig.gemini.callsPerRun = 2;

      try {
        mockGenerate.mockResolvedValue(geminiResponse("broken"));
        mockExecute.mockResolvedValue(execResult({ exitCode: 1, stderr: "nope" }));

        const runId = await createRun();
        const result = await runAgent(runId);

        expect(result.status).toBe("budget_exceeded");

        const run = await AgentRun.findById(runId);
        expect(run.status).toBe("budget_exceeded");
        expect(run.error.code).toBe("BUDGET_EXCEEDED");
        // The reason must survive in run history, not just in logs.
        expect(run.error.message).toMatch(/budget/i);
        // Stopped at the budget, well short of maxAttempts.
        expect(mockGenerate).toHaveBeenCalledTimes(2);
      } finally {
        runnerConfig.gemini.callsPerRun = originalBudget;
      }
    });

    it("fails the run when the daily cap is reached", async () => {
      mockGenerate.mockRejectedValueOnce(new DailyCapExceededError(200, 200));

      const runId = await createRun();
      const result = await runAgent(runId);

      expect(result.status).toBe("failed");
      const run = await AgentRun.findById(runId);
      expect(run.error.code).toBe("DAILY_CAP_EXCEEDED");
      // Refused before any container started.
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe("model pinning", () => {
    it("fails loudly when the pinned model is unavailable", async () => {
      mockGenerate.mockRejectedValueOnce(
        new ModelUnavailableError("gemini-2.5-flash", 404, "not found")
      );

      const runId = await createRun();
      const result = await runAgent(runId);

      expect(result.status).toBe("failed");
      const run = await AgentRun.findById(runId);
      expect(run.error.code).toBe("MODEL_UNAVAILABLE");
      // No silent substitution: exactly one attempt, then stop.
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe("infrastructure failures", () => {
    it("does not feed a sandbox fault back to the model", async () => {
      mockGenerate.mockResolvedValueOnce(geminiResponse("console.log(1)"));
      mockExecute.mockRejectedValueOnce(new Error("no such image: agent-sandbox:node20"));

      const runId = await createRun();
      const result = await runAgent(runId);

      expect(result.status).toBe("failed");
      const run = await AgentRun.findById(runId);
      expect(run.error.code).toBe("SANDBOX_ERROR");
      // A broken sandbox is not the generated code's fault; asking for a
      // correction would produce a confused answer and waste budget.
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it("fails cleanly when the model returns prose instead of code", async () => {
      mockGenerate.mockResolvedValue({
        text: "I cannot help with that.",
        model: "gemini-2.5-flash",
        promptTokens: 10,
        responseTokens: 5,
        totalTokens: 15,
        latencyMs: 100,
        retries: 0,
        queuedMs: 0
      });
      // Prose with no fences is taken as the program and really is invalid JS,
      // so the sandbox is what rejects it — exactly as it would in production.
      mockExecute.mockResolvedValue(
        execResult({ exitCode: 1, stderr: "SyntaxError: Unexpected identifier" })
      );

      const runId = await createRun();
      const result = await runAgent(runId);

      // The run must terminate cleanly rather than crashing the worker.
      expect(result.status).toBe("failed");
      const run = await AgentRun.findById(runId);
      expect(run.attempts).toHaveLength(3);
      expect(run.status).toBe("failed");
    });
  });
});
