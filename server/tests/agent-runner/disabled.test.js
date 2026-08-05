const request = require("supertest");
const { setTestEnv, connectTestDb, disconnectTestDb } = require("../testUtils");

setTestEnv();
// The default. Set explicitly so the intent of this file is unmistakable, and
// before app.js is required, since register() reads it at load time.
process.env.AGENT_RUNNER_ENABLED = "false";

const app = require("../../src/app");

describe("agent-runner disabled (default)", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it("registers no run routes", async () => {
    // 404 from the app's catch-all, not 401/415 from the runner's middleware —
    // the routes must not exist at all.
    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("registers no webhook route", async () => {
    const res = await request(app).post("/api/runs/trigger/anything").send({});
    expect(res.status).toBe(404);
  });

  it("leaves the existing routes untouched", async () => {
    // The whole point of the flag: the editor and reviewer behave identically.
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body.data.status).toBe("ok");

    // Still auth-guarded, i.e. reachable and behaving normally.
    expect((await request(app).get("/api/documents")).status).toBe(401);
    expect((await request(app).get("/api/review/history")).status).toBe(401);
  });

  it("does not load the subsystem's heavy dependencies", () => {
    // register() returns before requiring anything, so dockerode, bullmq and
    // node-cron must never enter the module cache — and neither the Mongoose
    // model registrations nor a Docker socket handle are created.
    const loaded = Object.keys(require.cache);
    const heavy = loaded.filter(
      (m) =>
        m.includes("node_modules\\dockerode") ||
        m.includes("node_modules/dockerode") ||
        m.includes("node_modules\\bullmq") ||
        m.includes("node_modules/bullmq") ||
        m.includes("node_modules\\node-cron") ||
        m.includes("node_modules/node-cron")
    );
    expect(heavy).toEqual([]);
  });

  it("does not register the subsystem's Mongoose models", () => {
    const mongoose = require("mongoose");
    expect(mongoose.modelNames()).not.toContain("AgentRun");
    expect(mongoose.modelNames()).not.toContain("AgentTask");
  });
});
