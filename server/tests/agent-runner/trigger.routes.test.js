const request = require("supertest");
const { setTestEnv, connectTestDb, clearTestDb, disconnectTestDb } = require("../testUtils");

setTestEnv();
// Must be set before app.js is required: agent-runner/config.js reads it at
// module load, and register() short-circuits on it.
process.env.AGENT_RUNNER_ENABLED = "true";
process.env.AGENT_RUNNER_WEBHOOK_SECRET = "test-webhook-secret";

// Redis is unavailable in tests (REDIS_URL=""), so the real queue would refuse
// the job and the trigger layer would never be exercised. Only the enqueue call
// is replaced; run creation, HMAC verification and idempotency are all real.
const mockEnqueue = jest.fn(async (payload) => `job-${payload.runId}`);
jest.mock("../../src/agent-runner/queue/queue", () => ({
  getQueue: () => ({}),
  enqueueRun: (payload) => mockEnqueue(payload),
  closeQueue: async () => {}
}));

const app = require("../../src/app");
const AgentTask = require("../../src/agent-runner/models/AgentTask");
const AgentRun = require("../../src/agent-runner/models/AgentRun");
const {
  computeSignature,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  IDEMPOTENCY_HEADER
} = require("../../src/agent-runner/middleware/hmac");

const CONTENT_TYPE = "application/agent-runner+json";
const SECRET = "test-webhook-secret";

/**
 * Fire a signed webhook delivery.
 * @param {Object} options - Delivery options.
 * @returns {Promise<import("supertest").Response>} Supertest response.
 */
function fireWebhook({ taskRef, body = {}, secret = SECRET, timestamp, idempotencyKey }) {
  const raw = JSON.stringify(body);
  const ts = timestamp || Math.floor(Date.now() / 1000).toString();
  const signature = computeSignature(secret, ts, raw);

  const req = request(app)
    .post(`/api/runs/trigger/${taskRef}`)
    .set("Content-Type", CONTENT_TYPE)
    .set(TIMESTAMP_HEADER, ts)
    .set(SIGNATURE_HEADER, `v1=${signature}`);

  if (idempotencyKey) req.set(IDEMPOTENCY_HEADER, idempotencyKey);

  return req.send(raw);
}

describe("agent-runner trigger layer", () => {
  let task;

  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    mockEnqueue.mockClear();
    task = await AgentTask.create({
      name: "Demo task",
      slug: "demo-task",
      prompt: "Write a program that prints hello."
    });
  });

  describe("HMAC verification", () => {
    it("accepts a valid signature and returns 202 with a runId", async () => {
      const res = await fireWebhook({ taskRef: task._id.toString() });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.runId).toBeTruthy();
      expect(res.body.data.status).toBe("queued");
      expect(res.body.data.replayed).toBe(false);

      // 202 must mean "queued", not "executed" — the response cannot wait on the
      // agent loop.
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue.mock.calls[0][0].triggerSource).toBe("webhook");
    });

    it("rejects a signature made with the wrong secret", async () => {
      const res = await fireWebhook({ taskRef: task._id.toString(), secret: "wrong-secret" });

      expect(res.status).toBe(401);
      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(await AgentRun.countDocuments()).toBe(0);
    });

    it("rejects a tampered body under a signature that was valid for the original", async () => {
      const original = JSON.stringify({ amount: 1 });
      const ts = Math.floor(Date.now() / 1000).toString();
      const signature = computeSignature(SECRET, ts, original);

      const res = await request(app)
        .post(`/api/runs/trigger/${task._id}`)
        .set("Content-Type", CONTENT_TYPE)
        .set(TIMESTAMP_HEADER, ts)
        .set(SIGNATURE_HEADER, `v1=${signature}`)
        .send(JSON.stringify({ amount: 1000000 }));

      expect(res.status).toBe(401);
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it("rejects a stale timestamp even when the signature is valid", async () => {
      const stale = (Math.floor(Date.now() / 1000) - 4000).toString();
      const res = await fireWebhook({ taskRef: task._id.toString(), timestamp: stale });

      expect(res.status).toBe(401);
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it("rejects a delivery with no signature headers", async () => {
      const res = await request(app)
        .post(`/api/runs/trigger/${task._id}`)
        .set("Content-Type", CONTENT_TYPE)
        .send(JSON.stringify({}));

      expect(res.status).toBe(401);
    });

    it("refuses application/json rather than verifying a re-serialised body", async () => {
      const raw = JSON.stringify({});
      const ts = Math.floor(Date.now() / 1000).toString();

      const res = await request(app)
        .post(`/api/runs/trigger/${task._id}`)
        .set("Content-Type", "application/json")
        .set(TIMESTAMP_HEADER, ts)
        .set(SIGNATURE_HEADER, `v1=${computeSignature(SECRET, ts, raw)}`)
        .send(raw);

      // The global express.json() consumed the stream, so the signed bytes are
      // gone. Failing loudly beats verifying bytes the sender never signed.
      expect(res.status).toBe(415);
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("idempotency", () => {
    it("does not double-run a replayed delivery", async () => {
      const key = "delivery-abc-123";

      const first = await fireWebhook({ taskRef: task._id.toString(), idempotencyKey: key });
      const second = await fireWebhook({ taskRef: task._id.toString(), idempotencyKey: key });

      expect(first.status).toBe(202);
      expect(first.body.data.replayed).toBe(false);

      // A replay is a successful no-op that resolves to the ORIGINAL run.
      expect(second.status).toBe(200);
      expect(second.body.data.replayed).toBe(true);
      expect(second.body.data.runId).toBe(first.body.data.runId);

      expect(await AgentRun.countDocuments()).toBe(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });

    it("treats distinct delivery keys as distinct runs", async () => {
      await fireWebhook({ taskRef: task._id.toString(), idempotencyKey: "key-1" });
      await fireWebhook({ taskRef: task._id.toString(), idempotencyKey: "key-2" });

      expect(await AgentRun.countDocuments()).toBe(2);
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
    });

    it("de-duplicates identical unkeyed deliveries via the signature", async () => {
      // With no explicit key, the signature stands in for one — so a sender that
      // retries the exact same delivery is still protected.
      const body = { nonce: "fixed" };
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const first = await fireWebhook({ taskRef: task._id.toString(), body, timestamp });
      const second = await fireWebhook({ taskRef: task._id.toString(), body, timestamp });

      expect(first.status).toBe(202);
      expect(second.status).toBe(200);
      expect(second.body.data.replayed).toBe(true);
      expect(await AgentRun.countDocuments()).toBe(1);
    });
  });

  describe("task resolution", () => {
    it("resolves a task by slug", async () => {
      const res = await fireWebhook({ taskRef: "demo-task" });
      expect(res.status).toBe(202);
    });

    it("404s for an unknown task", async () => {
      const res = await fireWebhook({ taskRef: "no-such-task" });
      expect(res.status).toBe(404);
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it("409s for a disabled task", async () => {
      await AgentTask.updateOne({ _id: task._id }, { enabled: false });
      const res = await fireWebhook({ taskRef: "demo-task" });
      expect(res.status).toBe(409);
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("authenticated routes", () => {
    it("requires a JWT for the manual trigger", async () => {
      const res = await request(app).post("/api/runs").send({ taskId: "demo-task" });
      expect(res.status).toBe(401);
    });

    it("requires a JWT to list runs", async () => {
      const res = await request(app).get("/api/runs");
      expect(res.status).toBe(401);
    });
  });
});
