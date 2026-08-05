const { setTestEnv, connectTestDb, clearTestDb, disconnectTestDb } = require("../testUtils");

setTestEnv();
process.env.AGENT_RUNNER_ENABLED = "true";

const { streamRun } = require("../../src/agent-runner/stream/sse");
const pubsub = require("../../src/agent-runner/stream/pubsub");
const AgentRun = require("../../src/agent-runner/models/AgentRun");
const AgentTask = require("../../src/agent-runner/models/AgentTask");

/**
 * Minimal Express-response stand-in that records SSE frames.
 * @returns {Object} Fake response with parsed frame access.
 */
// Every fake response is tracked so afterEach can close it. A stream left open
// holds a pubsub subscription and a heartbeat timer.
const openResponses = [];

function createFakeRes() {
  const chunks = [];
  const listeners = {};

  const res = {
    headers: null,
    ended: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk) {
      chunks.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
    },
    on(event, handler) {
      listeners[event] = handler;
    },
    close() {
      if (listeners.close) listeners.close();
    },
    raw: () => chunks.join(""),
    /**
     * Parse the recorded stream into {event, data} pairs.
     * @returns {Object[]} Frames.
     */
    frames() {
      return chunks
        .join("")
        .split("\n\n")
        .filter((block) => block.includes("data:"))
        .map((block) => {
          const lines = block.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          return {
            event: eventLine ? eventLine.slice(6).trim() : "message",
            data: JSON.parse(dataLine.slice(5).trim())
          };
        });
    }
  };

  openResponses.push(res);
  return res;
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

describe("agent-runner SSE stream", () => {
  let task;

  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    task = await AgentTask.create({ name: "T", slug: "t", prompt: "p" });
  });

  afterEach(() => {
    // Close every stream this test opened, releasing its pubsub subscription
    // and heartbeat timer.
    openResponses.splice(0).forEach((res) => res.close());
  });

  it("sets event-stream headers and disables proxy buffering", async () => {
    const run = await AgentRun.create({ taskId: task._id, triggerSource: "manual", status: "succeeded" });
    const res = createFakeRes();

    await streamRun(run._id.toString(), res);

    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.headers["Cache-Control"]).toBe("no-cache");
    // Without this nginx buffers the whole response and nothing is live.
    expect(res.headers["X-Accel-Buffering"]).toBe("no");
  });

  it("replays existing state so a late viewer is not shown an empty run", async () => {
    const run = await AgentRun.create({
      taskId: task._id,
      triggerSource: "manual",
      status: "succeeded",
      attempts: [
        { index: 1, generatedCode: "v1", stdout: "", stderr: "boom", exitCode: 1, durationMs: 10 },
        { index: 2, generatedCode: "v2", stdout: "ok", stderr: "", exitCode: 0, durationMs: 20 }
      ],
      artifacts: [{ name: "total.txt", sizeBytes: 2, sha256: "abc" }]
    });

    const res = createFakeRes();
    await streamRun(run._id.toString(), res);

    const frames = res.frames();
    const events = frames.map((f) => f.event);

    expect(events[0]).toBe("status");
    expect(events).toContain("attempt_start");
    expect(events).toContain("attempt_result");
    expect(events).toContain("artifact");
    expect(events[events.length - 1]).toBe("done");

    // Replayed history is marked as such so a client can tell it from live data.
    const results = frames.filter((f) => f.event === "attempt_result");
    expect(results).toHaveLength(2);
    expect(results[0].data.replay).toBe(true);
    expect(results[0].data.stderr).toBe("boom");
    expect(results[1].data.exitCode).toBe(0);
  });

  it("ends immediately for an already-terminal run", async () => {
    const run = await AgentRun.create({
      taskId: task._id,
      triggerSource: "manual",
      status: "budget_exceeded",
      error: { message: "out of budget", code: "BUDGET_EXCEEDED" }
    });

    const res = createFakeRes();
    await streamRun(run._id.toString(), res);

    expect(res.ended).toBe(true);
    const done = res.frames().find((f) => f.event === "done");
    expect(done.data.status).toBe("budget_exceeded");
    expect(done.data.error.code).toBe("BUDGET_EXCEEDED");
  });

  it("delivers live events published after the stream opens", async () => {
    const run = await AgentRun.create({ taskId: task._id, triggerSource: "manual", status: "queued" });
    const runId = run._id.toString();
    const res = createFakeRes();

    await streamRun(runId, res);
    // Still open: a non-terminal run holds the connection.
    expect(res.ended).toBe(false);

    pubsub.publish(runId, "log", { message: "attempt 1 starting" });
    pubsub.publish(runId, "attempt_result", { index: 1, exitCode: 1 });
    await nextTick();

    const events = res.frames();
    expect(events.some((f) => f.event === "log" && f.data.message === "attempt 1 starting")).toBe(true);
    expect(events.some((f) => f.event === "attempt_result" && f.data.exitCode === 1)).toBe(true);
  });

  it("closes the stream on the done event", async () => {
    const run = await AgentRun.create({ taskId: task._id, triggerSource: "manual", status: "executing" });
    const runId = run._id.toString();
    const res = createFakeRes();

    await streamRun(runId, res);
    expect(res.ended).toBe(false);

    pubsub.publish(runId, "done", { status: "succeeded" });
    await nextTick();

    expect(res.ended).toBe(true);
  });

  it("stops writing once the client disconnects", async () => {
    const run = await AgentRun.create({ taskId: task._id, triggerSource: "manual", status: "executing" });
    const runId = run._id.toString();
    const res = createFakeRes();

    await streamRun(runId, res);
    const before = res.frames().length;

    // Simulates the browser navigating away mid-run.
    res.close();
    pubsub.publish(runId, "log", { message: "should not be written" });
    await nextTick();

    expect(res.frames().length).toBe(before);
    expect(res.raw()).not.toContain("should not be written");
  });

  it("404s a run that does not exist", async () => {
    const res = createFakeRes();
    await streamRun("507f1f77bcf86cd799439011", res);

    const error = res.frames().find((f) => f.event === "error");
    expect(error.data.message).toBe("Run not found");
    expect(res.ended).toBe(true);
  });

  it("isolates events between runs", async () => {
    const runA = await AgentRun.create({ taskId: task._id, triggerSource: "manual", status: "executing" });
    const runB = await AgentRun.create({ taskId: task._id, triggerSource: "manual", status: "executing" });

    const resA = createFakeRes();
    await streamRun(runA._id.toString(), resA);
    const baseline = resA.frames().length;

    pubsub.publish(runB._id.toString(), "log", { message: "run B only" });
    await nextTick();

    expect(resA.frames().length).toBe(baseline);
  });
});
