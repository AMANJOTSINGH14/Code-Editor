const { PassThrough } = require("stream");

// Env is set inline rather than via tests/testUtils.js on purpose: that module
// pulls in mongodb-memory-server, which spawns a mongod binary and leaves a
// handle open. The executor touches no database, and these tests should not pay
// several seconds of startup for a dependency they never use.
process.env.NODE_ENV = "test";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-access";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh";

const Docker = require("dockerode");
const executor = require("../../src/agent-runner/sandbox/executor");
const config = require("../../src/agent-runner/config");

// A real docker-modem instance, constructed but never connected. Using the
// genuine demuxStream means these tests exercise the actual 8-byte frame header
// parsing rather than a hand-rolled stand-in that could diverge from it.
const realModem = new Docker().modem;

const STDOUT = 1;
const STDERR = 2;

/**
 * Encode a chunk in Docker's stream multiplexing format:
 * one 8-byte header (stream type, 3 zero bytes, 4-byte big-endian length)
 * followed by the payload.
 * @param {number} streamType - 1 for stdout, 2 for stderr.
 * @param {string} text - Payload.
 * @returns {Buffer} Framed chunk.
 */
function frame(streamType, text) {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/**
 * Build a mock Docker client.
 * @param {Object} options - Behaviour switches.
 * @returns {Object} Mock docker client plus recorded calls.
 */
function createMockDocker(options = {}) {
  const {
    exitCode = 0,
    frames = [],
    neverExits = false,
    startError = null,
    createError = null,
    removeError = null
  } = options;

  const calls = {
    created: [],
    started: 0,
    killed: 0,
    removed: 0,
    removeOptions: []
  };

  const stream = new PassThrough();
  let resolveWait = null;

  const container = {
    id: "mock-container-id",
    modem: realModem,

    attach: jest.fn(async () => stream),

    start: jest.fn(async () => {
      if (startError) throw startError;
      calls.started += 1;
      // Emit output the way the daemon would: after start, asynchronously.
      setImmediate(() => {
        frames.forEach((f) => stream.write(f));
        if (!neverExits) stream.end();
      });
    }),

    wait: jest.fn(
      () =>
        new Promise((resolve) => {
          resolveWait = resolve;
          // A container that exits on its own settles shortly after start.
          // A hung one waits for kill() to release it.
          if (!neverExits) setTimeout(() => resolve({ StatusCode: exitCode }), 10);
        })
    ),

    kill: jest.fn(async () => {
      calls.killed += 1;
      // Mirrors the daemon: killing a container makes the pending wait() settle,
      // and SIGKILL surfaces as 137.
      if (resolveWait) {
        stream.end();
        resolveWait({ StatusCode: 137 });
      }
    }),

    remove: jest.fn(async (opts) => {
      calls.removed += 1;
      calls.removeOptions.push(opts);
      if (removeError) throw removeError;
    })
  };

  const docker = {
    createContainer: jest.fn(async (cfg) => {
      if (createError) throw createError;
      calls.created.push(cfg);
      return container;
    }),
    getContainer: jest.fn(() => container)
  };

  return { docker, container, calls, stream };
}

describe("agent-runner sandbox executor", () => {
  afterEach(() => {
    executor.setDockerClient(null);
  });

  describe("container hardening", () => {
    it("applies every isolation setting to the container config", async () => {
      const { docker, calls } = createMockDocker({ exitCode: 0 });
      executor.setDockerClient(docker);

      await executor.execute({
        runId: "run-hardening",
        files: [{ name: "main.js", content: "console.log('hi')" }]
      });

      const cfg = calls.created[0];
      const host = cfg.HostConfig;

      expect(host.NetworkMode).toBe("none");
      expect(host.ReadonlyRootfs).toBe(true);
      expect(host.Memory).toBe(config.sandbox.memoryBytes);
      // Equal to Memory means swap is disabled; without it the memory cap leaks.
      expect(host.MemorySwap).toBe(config.sandbox.memoryBytes);
      expect(host.NanoCpus).toBe(config.sandbox.nanoCpus);
      expect(host.PidsLimit).toBe(config.sandbox.pidsLimit);
      expect(host.CapDrop).toEqual(["ALL"]);
      expect(host.SecurityOpt).toEqual(["no-new-privileges"]);
      expect(host.Privileged).toBe(false);
      expect(host.Tmpfs["/workspace"]).toContain("noexec");

      expect(cfg.User).toBe("1000:1000");
      // Demuxing stdout from stderr is impossible with a TTY attached, and the
      // agent loop depends on reading stderr separately.
      expect(cfg.Tty).toBe(false);
      expect(cfg.Labels["codesync.agentrun"]).toBe("run-hardening");
    });
  });

  describe("exit codes", () => {
    it("propagates a non-zero exit code", async () => {
      const { docker } = createMockDocker({
        exitCode: 1,
        frames: [frame(STDERR, "TypeError: boom\n")]
      });
      executor.setDockerClient(docker);

      const result = await executor.execute({
        runId: "run-fail",
        files: [{ name: "main.js", content: "throw new Error('boom')" }]
      });

      expect(result.exitCode).toBe(1);
      expect(result.timedOut).toBe(false);
      expect(result.stderr).toContain("TypeError: boom");
    });

    it("returns exit code 0 and separates stdout from stderr", async () => {
      const { docker } = createMockDocker({
        exitCode: 0,
        frames: [frame(STDOUT, "out-line\n"), frame(STDERR, "warn-line\n")]
      });
      executor.setDockerClient(docker);

      const result = await executor.execute({
        runId: "run-ok",
        files: [{ name: "main.js", content: "console.log('out-line')" }]
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("out-line\n");
      expect(result.stderr).toBe("warn-line\n");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("timeout", () => {
    it("kills the container and reports a timeout when the deadline passes", async () => {
      const { docker, container, calls } = createMockDocker({ neverExits: true });
      executor.setDockerClient(docker);

      const result = await executor.execute({
        runId: "run-timeout",
        files: [{ name: "main.js", content: "while(true){}" }],
        timeoutMs: 120
      });

      expect(container.kill).toHaveBeenCalled();
      expect(container.kill.mock.calls[0][0]).toEqual({ signal: "SIGKILL" });
      expect(result.timedOut).toBe(true);
      // 137 (SIGKILL) must not be reported as the program's own exit code, or a
      // timeout is indistinguishable from a genuine failure.
      expect(result.exitCode).toBeNull();
      // The container is still removed after being killed.
      expect(calls.removed).toBe(1);
    });

    it("does not kill a container that finishes inside the deadline", async () => {
      const { docker, container } = createMockDocker({ exitCode: 0 });
      executor.setDockerClient(docker);

      const result = await executor.execute({
        runId: "run-fast",
        files: [{ name: "main.js", content: "console.log(1)" }],
        timeoutMs: 5000
      });

      expect(container.kill).not.toHaveBeenCalled();
      expect(result.timedOut).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("removes the container when start throws", async () => {
      const { docker, container, calls } = createMockDocker({
        startError: new Error("daemon refused to start container")
      });
      executor.setDockerClient(docker);

      await expect(
        executor.execute({
          runId: "run-start-throw",
          files: [{ name: "main.js", content: "console.log(1)" }]
        })
      ).rejects.toThrow("daemon refused to start container");

      expect(container.remove).toHaveBeenCalled();
      expect(calls.removeOptions[0]).toEqual({ force: true });
    });

    it("always forces removal on the success path", async () => {
      const { docker, calls } = createMockDocker({ exitCode: 0 });
      executor.setDockerClient(docker);

      await executor.execute({
        runId: "run-cleanup",
        files: [{ name: "main.js", content: "console.log(1)" }]
      });

      expect(calls.removed).toBe(1);
      expect(calls.removeOptions[0]).toEqual({ force: true });
    });

    it("does not mask the original error when cleanup itself fails", async () => {
      const { docker } = createMockDocker({
        startError: new Error("original failure"),
        removeError: new Error("cleanup failure")
      });
      executor.setDockerClient(docker);

      // The caller must see why the run failed, not why the cleanup failed.
      await expect(
        executor.execute({
          runId: "run-both-throw",
          files: [{ name: "main.js", content: "console.log(1)" }]
        })
      ).rejects.toThrow("original failure");
    });

    it("has nothing to remove when container creation itself fails", async () => {
      const { docker, container } = createMockDocker({
        createError: new Error("no such image")
      });
      executor.setDockerClient(docker);

      await expect(
        executor.execute({
          runId: "run-create-throw",
          files: [{ name: "main.js", content: "console.log(1)" }]
        })
      ).rejects.toThrow("no such image");

      expect(container.remove).not.toHaveBeenCalled();
    });
  });

  describe("output cap", () => {
    it("caps total captured output and flags truncation", async () => {
      const originalCap = config.sandbox.maxOutputBytes;
      config.sandbox.maxOutputBytes = 1000;

      try {
        // 50KB of stdout against a 1KB cap.
        const { docker } = createMockDocker({
          exitCode: 0,
          frames: [frame(STDOUT, "A".repeat(50000))]
        });
        executor.setDockerClient(docker);

        const result = await executor.execute({
          runId: "run-logbomb",
          files: [{ name: "main.js", content: "for(;;)console.log('A')" }]
        });

        expect(result.stdout.length).toBe(1000);
        expect(result.outputTruncated).toBe(true);
        expect(result.exitCode).toBe(0);
      } finally {
        config.sandbox.maxOutputBytes = originalCap;
      }
    });

    it("shares one budget across stdout and stderr", async () => {
      const originalCap = config.sandbox.maxOutputBytes;
      config.sandbox.maxOutputBytes = 100;

      try {
        const { docker } = createMockDocker({
          exitCode: 0,
          frames: [frame(STDOUT, "A".repeat(80)), frame(STDERR, "B".repeat(80))]
        });
        executor.setDockerClient(docker);

        const result = await executor.execute({
          runId: "run-shared-budget",
          files: [{ name: "main.js", content: "x" }]
        });

        // Flooding one stream must not buy extra headroom on the other.
        expect(result.stdout.length + result.stderr.length).toBe(100);
        expect(result.outputTruncated).toBe(true);
      } finally {
        config.sandbox.maxOutputBytes = originalCap;
      }
    });

    it("does not flag truncation when output fits", async () => {
      const { docker } = createMockDocker({
        exitCode: 0,
        frames: [frame(STDOUT, "small\n")]
      });
      executor.setDockerClient(docker);

      const result = await executor.execute({
        runId: "run-small",
        files: [{ name: "main.js", content: "console.log('small')" }]
      });

      expect(result.outputTruncated).toBe(false);
    });
  });

  describe("bootstrap script", () => {
    it("base64-encodes files and execs the entrypoint", () => {
      const script = executor.buildBootstrapScript(
        [{ name: "main.js", content: "console.log('hi')" }],
        "main.js"
      );

      expect(script).toContain("set -e");
      expect(script).toContain(Buffer.from("console.log('hi')", "utf8").toString("base64"));
      expect(script).toContain("base64 -d > /workspace/main.js");
      // exec makes the program PID 1 so it takes SIGKILL directly and its exit
      // status becomes the container's.
      expect(script).toContain("exec node /workspace/main.js");
    });

    it("rejects filenames that could escape the workspace", () => {
      expect(() =>
        executor.buildBootstrapScript([{ name: "../../etc/passwd", content: "x" }], "main.js")
      ).toThrow(/Unsafe sandbox filename/);

      expect(() =>
        executor.buildBootstrapScript([{ name: "a b.js", content: "x" }], "main.js")
      ).toThrow(/Unsafe sandbox filename/);

      expect(() =>
        executor.buildBootstrapScript([{ name: "x;rm -rf /.js", content: "x" }], "main.js")
      ).toThrow(/Unsafe sandbox filename/);
    });

    it("rejects a payload that would exceed the kernel per-argument limit", () => {
      // The whole script is one argv entry, capped at MAX_ARG_STRLEN (128KB).
      const huge = "x".repeat(executor.MAX_BOOTSTRAP_SCRIPT_BYTES);
      expect(() =>
        executor.buildBootstrapScript([{ name: "main.js", content: huge }], "main.js")
      ).toThrow(/MAX_ARG_STRLEN/);
    });
  });
});
