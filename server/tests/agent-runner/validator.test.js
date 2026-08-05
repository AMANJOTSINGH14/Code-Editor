const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.NODE_ENV = "test";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-access";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "agentrunner-validator-"));
process.env.AGENT_RUNNER_ARTIFACTS_PATH = TMP;

const validator = require("../../src/agent-runner/agent/validator");
const artifacts = require("../../src/agent-runner/artifacts");
const { TASKS } = require("../../src/agent-runner/demo/seed-demo");

// The real seeded task, so the assertions under test are the ones that ship.
const TASK = TASKS.find((t) => t.slug === "self-correction-deps");

// The correct answer, derived by hand from SERVICES_INI.
const CORRECT = {
  serviceCount: 3,
  totalReplicas: 9,
  services: [
    { name: "api-gateway", replicas: 3, envCount: 3, hasHealthcheck: true },
    { name: "worker", replicas: 5, envCount: 2, hasHealthcheck: false },
    { name: "scheduler", replicas: 1, envCount: 1, hasHealthcheck: true }
  ]
};

/**
 * Write an artifact for a fake run and return its id.
 * @param {*} content - Artifact content (object or raw string).
 * @returns {string} Run id.
 */
function seedArtifact(content) {
  const runId = `run${Math.random().toString(36).slice(2, 10)}`;
  const dir = artifacts.localRunDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "services-summary.json"),
    typeof content === "string" ? content : JSON.stringify(content, null, 2)
  );
  return runId;
}

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("agent-runner artifact validator", () => {
  it("passes the hand-derived correct answer", () => {
    const result = validator.validateArtifact(TASK, seedArtifact(CORRECT));
    expect(result.applicable).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.checked).toBe(12);
  });

  it("catches the exact wrong output a live run produced", () => {
    // Verbatim from run 6a720a707b5e42e9626b7a81: exit 0, valid JSON, and
    // completely wrong — env/healthcheck counted as services, worker and
    // scheduler dropped. This was recorded as `succeeded` before the validator.
    const runId = seedArtifact({
      serviceCount: 3,
      totalReplicas: 3,
      services: [
        { name: "api-gateway", replicas: 3, envCount: 0, hasHealthcheck: false },
        { name: "env", replicas: 0, envCount: 3, hasHealthcheck: false },
        { name: "healthcheck", replicas: 0, envCount: 0, hasHealthcheck: false }
      ]
    });

    const result = validator.validateArtifact(TASK, runId);
    expect(result.passed).toBe(false);

    const byLabel = Object.fromEntries(result.failures.map((f) => [f.label, f]));
    expect(byLabel.totalReplicas).toEqual(
      expect.objectContaining({ expected: 9, actual: 3 })
    );
    // worker and scheduler are absent entirely -> resolve to undefined.
    expect(byLabel["worker replicas"].actual).toBeUndefined();
    expect(byLabel["scheduler replicas"].actual).toBeUndefined();
    // serviceCount coincidentally matched, so it must NOT be reported.
    expect(byLabel.serviceCount).toBeUndefined();
  });

  it("produces feedback naming expected and actual values", () => {
    const runId = seedArtifact({ ...CORRECT, totalReplicas: 3 });
    const result = validator.validateArtifact(TASK, runId);
    const text = validator.describeFailures(result.failures, result.checked);

    // The agent must be told the target, not just that something is wrong.
    expect(text).toMatch(/totalReplicas: expected 9, got 3/);
  });

  it("fails when the artifact was never created", () => {
    const runId = `run${Math.random().toString(36).slice(2, 10)}`;
    fs.mkdirSync(artifacts.localRunDir(runId), { recursive: true });

    const result = validator.validateArtifact(TASK, runId);
    expect(result.passed).toBe(false);
    expect(result.failures[0].actual).toMatch(/not created/);
  });

  it("fails on unparseable JSON rather than throwing", () => {
    const result = validator.validateArtifact(TASK, seedArtifact("{not json"));
    expect(result.passed).toBe(false);
    expect(result.failures[0].actual).toMatch(/unparseable/);
  });

  it("rejects a stringified number", () => {
    // "9" is a real bug: consumers doing arithmetic would concatenate.
    const result = validator.validateArtifact(TASK, seedArtifact({ ...CORRECT, totalReplicas: "9" }));
    expect(result.passed).toBe(false);
  });

  it("is order-independent for the services array", () => {
    // The agent chooses the order; asserting by index would fail a correct
    // answer that sorted differently.
    const reversed = { ...CORRECT, services: [...CORRECT.services].reverse() };
    expect(validator.validateArtifact(TASK, seedArtifact(reversed)).passed).toBe(true);
  });

  it("treats a task with no validator as not applicable", () => {
    const happy = TASKS.find((t) => t.slug === "order-total");
    const result = validator.validateArtifact(happy, seedArtifact(CORRECT));
    expect(result.applicable).toBe(false);
    // Not applicable must not read as "verified".
    expect(result.checked).toBe(0);
  });

  describe("path resolution", () => {
    const doc = { a: { b: 2 }, list: [{ name: "x", v: 1 }, { name: "y", v: 2 }] };

    it("resolves nested keys, length, and array-by-name", () => {
      expect(validator.resolvePath(doc, "a.b").value).toBe(2);
      expect(validator.resolvePath(doc, "list.length").value).toBe(2);
      expect(validator.resolvePath(doc, "list[y].v").value).toBe(2);
    });

    it("returns undefined for missing paths instead of throwing", () => {
      expect(validator.resolvePath(doc, "nope.deep.deeper").value).toBeUndefined();
      expect(validator.resolvePath(doc, "list[zzz].v").value).toBeUndefined();
    });
  });
});
