const fs = require("fs");
const os = require("os");
const path = require("path");
const { setTestEnv, connectTestDb, clearTestDb, disconnectTestDb } = require("../testUtils");

setTestEnv();

// Point the artifact root at a throwaway directory before config is loaded.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "agentrunner-artifacts-"));
process.env.AGENT_RUNNER_ARTIFACTS_PATH = TMP_ROOT;

const artifacts = require("../../src/agent-runner/artifacts");
const config = require("../../src/agent-runner/config");
const AgentRun = require("../../src/agent-runner/models/AgentRun");
const AgentTask = require("../../src/agent-runner/models/AgentTask");
const githubSink = require("../../src/agent-runner/artifacts/sinks/github");

describe("agent-runner artifacts", () => {
  let task;

  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearTestDb();
    task = await AgentTask.create({ name: "T", slug: "t", prompt: "p" });
  });

  /**
   * Create a run plus its artifact directory.
   * @returns {Promise<{run: Object, runId: string, dir: string}>} Fixture.
   */
  async function seedRun() {
    const run = await AgentRun.create({ taskId: task._id, triggerSource: "manual" });
    const runId = run._id.toString();
    const dir = artifacts.localRunDir(runId);
    fs.mkdirSync(dir, { recursive: true });
    return { run, runId, dir };
  }

  describe("sandbox bind", () => {
    it("creates the run directory and mounts it read-write at /workspace/out", async () => {
      const run = await AgentRun.create({ taskId: task._id, triggerSource: "manual" });
      const runId = run._id.toString();

      const binds = artifacts.buildSandboxBinds(runId);

      expect(binds).toHaveLength(1);
      expect(binds[0]).toContain(":/workspace/out:rw");
      // Created up-front because Docker would otherwise create the bind source
      // as root, leaving the uid-1000 sandbox unable to write to it.
      expect(fs.existsSync(artifacts.localRunDir(runId))).toBe(true);
    });

    it("scopes the mount to one run, never the artifacts root", async () => {
      const a = await AgentRun.create({ taskId: task._id, triggerSource: "manual" });
      const b = await AgentRun.create({ taskId: task._id, triggerSource: "manual" });

      const bindA = artifacts.buildSandboxBinds(a._id.toString())[0];

      // Mounting the root would let any run read and overwrite every other
      // run's output. The bind source must end with this run's own id.
      expect(bindA.startsWith(`${config.artifacts.hostPath}/${a._id}`)).toBe(true);
      expect(bindA).not.toContain(b._id.toString());
    });

    it("uses the daemon-visible host path, not the local path", () => {
      const original = config.artifacts.hostPath;
      config.artifacts.hostPath = "/host/side/artifacts";
      try {
        // Sandbox containers are siblings driven through the host daemon, so a
        // bind source must be a host path — not a path inside this container.
        expect(artifacts.hostRunDir("abc123")).toBe("/host/side/artifacts/abc123");
      } finally {
        config.artifacts.hostPath = original;
      }
    });
  });

  describe("collection", () => {
    it("collects files with size and sha256, and records them on the run", async () => {
      const { run, runId, dir } = await seedRun();
      fs.writeFileSync(path.join(dir, "total.txt"), "42");
      fs.writeFileSync(path.join(dir, "report.json"), '{"ok":true}');

      const collected = await artifacts.collectAndPublish(run, task, runId);

      expect(collected).toHaveLength(2);
      const names = collected.map((a) => a.name).sort();
      expect(names).toEqual(["report.json", "total.txt"]);

      const total = collected.find((a) => a.name === "total.txt");
      expect(total.sizeBytes).toBe(2);
      expect(total.sha256).toHaveLength(64);

      const saved = await AgentRun.findById(runId);
      expect(saved.artifacts).toHaveLength(2);
    });

    it("returns empty when the run produced nothing", async () => {
      const { run, runId } = await seedRun();
      expect(await artifacts.collectAndPublish(run, task, runId)).toEqual([]);
    });

    it("skips directories and unsafe names", async () => {
      const { run, runId, dir } = await seedRun();
      fs.writeFileSync(path.join(dir, "good.txt"), "x");
      fs.mkdirSync(path.join(dir, "subdir"));
      fs.writeFileSync(path.join(dir, "sub space.txt"), "x");

      const collected = await artifacts.collectAndPublish(run, task, runId);

      expect(collected.map((a) => a.name)).toEqual(["good.txt"]);
    });

    it("skips artifacts over the size cap", async () => {
      const { run, runId, dir } = await seedRun();
      fs.writeFileSync(path.join(dir, "small.txt"), "x");
      fs.writeFileSync(
        path.join(dir, "huge.bin"),
        Buffer.alloc(artifacts.MAX_ARTIFACT_BYTES + 1024)
      );

      const collected = await artifacts.collectAndPublish(run, task, runId);
      expect(collected.map((a) => a.name)).toEqual(["small.txt"]);
    });
  });

  describe("download path resolution", () => {
    it("resolves a real artifact", async () => {
      const { runId, dir } = await seedRun();
      fs.writeFileSync(path.join(dir, "out.txt"), "data");

      const resolved = artifacts.resolveArtifactPath(runId, "out.txt");
      expect(resolved).not.toBeNull();
      expect(fs.readFileSync(resolved.path, "utf8")).toBe("data");
    });

    it("refuses path traversal", async () => {
      const { runId } = await seedRun();

      expect(artifacts.resolveArtifactPath(runId, "../../../etc/passwd")).toBeNull();
      expect(artifacts.resolveArtifactPath(runId, "..")).toBeNull();
      expect(artifacts.resolveArtifactPath(runId, "sub/file.txt")).toBeNull();
      expect(artifacts.resolveArtifactPath(runId, "a\\..\\..\\b")).toBeNull();
    });

    it("returns null for a missing artifact", async () => {
      const { runId } = await seedRun();
      expect(artifacts.resolveArtifactPath(runId, "nope.txt")).toBeNull();
    });
  });

  describe("github sink gating", () => {
    it("skips cleanly when disabled", () => {
      const state = githubSink.readiness();
      expect(state.ready).toBe(false);
      expect(state.reason).toMatch(/GITHUB_ENABLED/);
    });

    it("skips cleanly when enabled but the token is missing", () => {
      const original = config.artifacts.github.enabled;
      config.artifacts.github.enabled = true;
      try {
        // Optional means optional: a missing token is a skip, never a failure
        // of a run whose real work already succeeded.
        const state = githubSink.readiness();
        expect(state.ready).toBe(false);
        expect(state.reason).toMatch(/TOKEN/);
      } finally {
        config.artifacts.github.enabled = original;
      }
    });

    it("rejects a malformed repo string", () => {
      const cfg = config.artifacts.github;
      const originals = { enabled: cfg.enabled, token: cfg.token, repo: cfg.repo };
      cfg.enabled = true;
      cfg.token = "ghp_test";
      cfg.repo = "not-a-valid-repo";
      try {
        expect(githubSink.readiness().reason).toMatch(/owner\/repo/);
      } finally {
        Object.assign(cfg, originals);
      }
    });
  });
});
