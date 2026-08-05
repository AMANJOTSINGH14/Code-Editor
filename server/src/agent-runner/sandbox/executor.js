const { Writable } = require("stream");
const Docker = require("dockerode");
const config = require("../config");
const logger = require("../../utils/logger");

/**
 * Ephemeral sandbox executor.
 *
 * One container per run, created hardened, killed on a wall-clock deadline, and
 * removed unconditionally. Nothing here trusts the code it runs.
 */

// The whole bootstrap script is a single argv entry to `sh -c`, and Linux caps
// ONE argument at MAX_ARG_STRLEN = 32 * PAGE_SIZE = 131072 bytes — a far tighter
// limit than the ~2MB total ARG_MAX. Base64 inflates by 4/3, so this ceiling
// leaves headroom for the wrapper and still refuses oversized payloads loudly
// rather than letting the kernel return a confusing E2BIG.
const MAX_BOOTSTRAP_SCRIPT_BYTES = 100 * 1024;

// Grace period beyond the wall-clock deadline before we stop waiting on
// container.wait(). kill() normally makes wait() resolve immediately; this only
// fires if the daemon itself is wedged, and prevents a hung run from pinning the
// worker forever.
const WAIT_GRACE_MS = 10000;

// Filenames are interpolated into a shell command, so anything outside this set
// (path separators, "..", quotes, expansion characters) is rejected rather than
// escaped.
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

/** @type {Docker|null} */
let dockerClient = null;

/**
 * Get the Docker client, creating it on first use so that merely requiring this
 * module never touches the Docker socket.
 * @returns {Docker} Docker client.
 */
function getDocker() {
  if (!dockerClient) dockerClient = new Docker();
  return dockerClient;
}

/**
 * Inject a Docker client. Tests use this to drive the executor without a daemon.
 * @param {Docker|null} client - Client to use, or null to reset.
 * @returns {void}
 */
function setDockerClient(client) {
  dockerClient = client;
}

/**
 * Shared output budget across stdout and stderr.
 *
 * The cap is on TOTAL captured bytes, so a program that floods only stderr is
 * bounded exactly like one that floods only stdout.
 * @param {number} maxBytes - Maximum total bytes to retain.
 * @returns {Object} Budget handle.
 */
function createOutputBudget(maxBytes) {
  let used = 0;
  let truncated = false;
  return {
    remaining: () => Math.max(0, maxBytes - used),
    consume: (n) => {
      used += n;
    },
    markTruncated: () => {
      truncated = true;
    },
    isTruncated: () => truncated,
    bytesUsed: () => used
  };
}

/**
 * Writable sink that retains at most its share of the shared budget.
 *
 * Past the cap it keeps ACKNOWLEDGING writes while discarding them. Dropping the
 * callback instead would apply backpressure to the container's output stream and
 * wedge the run; the point is to bound this process's memory, not to stall the
 * sandbox.
 */
class CappedCollector extends Writable {
  /**
   * @param {Object} budget - Shared budget from createOutputBudget.
   */
  constructor(budget) {
    super();
    this.budget = budget;
    this.chunks = [];
  }

  /**
   * @param {Buffer} chunk - Incoming bytes.
   * @param {string} encoding - Ignored.
   * @param {Function} callback - Write callback.
   * @returns {void}
   */
  _write(chunk, encoding, callback) {
    const remaining = this.budget.remaining();
    if (remaining <= 0) {
      this.budget.markTruncated();
      return callback();
    }
    if (chunk.length > remaining) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.budget.consume(remaining);
      this.budget.markTruncated();
    } else {
      this.chunks.push(chunk);
      this.budget.consume(chunk.length);
    }
    return callback();
  }

  /**
   * Collected text.
   * @returns {string} UTF-8 text.
   */
  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/**
 * Validate a workspace filename.
 * @param {string} name - Filename.
 * @returns {void}
 * @throws {Error} When the name is unsafe.
 */
function assertSafeFilename(name) {
  if (!SAFE_FILENAME.test(name)) {
    throw new Error(
      `Unsafe sandbox filename: ${JSON.stringify(name)}. ` +
        "Only [A-Za-z0-9._-] is allowed; files are written flat into /workspace."
    );
  }
}

/**
 * Build the shell bootstrap that materialises files and executes the entrypoint.
 *
 * Files are base64-encoded into the command rather than copied in, because
 * `docker cp` cannot work here: /workspace is a tmpfs, and a tmpfs mount SHADOWS
 * whatever was copied into that path in the image layer. The copy appears to
 * succeed and the files are simply invisible at runtime. Encoding into the Cmd
 * sidesteps the mount entirely, and base64's alphabet is shell-safe by
 * construction.
 * @param {Array<{name: string, content: string}>} files - Files to materialise.
 * @param {string} entrypoint - Filename to execute.
 * @returns {string} Shell script.
 * @throws {Error} When a filename is unsafe or the script exceeds the arg limit.
 */
function buildBootstrapScript(files, entrypoint) {
  assertSafeFilename(entrypoint);

  // `set -e` makes a failed write abort before the program runs, so a truncated
  // file can never be mistaken for a program that failed on its own merits.
  const lines = ["set -e", "mkdir -p /workspace/out"];

  for (const file of files) {
    assertSafeFilename(file.name);
    const encoded = Buffer.from(file.content, "utf8").toString("base64");
    lines.push(`echo ${encoded} | base64 -d > /workspace/${file.name}`);
  }

  // `exec` replaces the shell so the program is PID 1: it receives SIGKILL
  // directly on timeout, and its exit status is the container's exit status
  // rather than the shell's.
  lines.push(`exec node /workspace/${entrypoint}`);

  const script = lines.join("\n");
  const size = Buffer.byteLength(script, "utf8");
  if (size > MAX_BOOTSTRAP_SCRIPT_BYTES) {
    throw new Error(
      `Sandbox bootstrap script is ${size} bytes, over the ${MAX_BOOTSTRAP_SCRIPT_BYTES} ` +
        "byte limit imposed by the kernel's per-argument cap (MAX_ARG_STRLEN)."
    );
  }
  return script;
}

/**
 * Build the hardened container configuration.
 * @param {Object} options - Options.
 * @param {string} options.runId - Run id, used as the container label value.
 * @param {string} options.script - Bootstrap script.
 * @param {string[]} options.binds - Optional host binds.
 * @returns {Object} Dockerode create-container options.
 */
function buildContainerConfig({ runId, script, binds }) {
  const sandbox = config.sandbox;
  return {
    Image: sandbox.image,
    Cmd: ["/bin/sh", "-c", script],
    WorkingDir: "/workspace",
    // Non-root. Combined with CapDrop ALL and no-new-privileges, there is no
    // supported path back to uid 0 inside the container.
    User: "1000:1000",
    // Tty MUST stay false: with a TTY the daemon merges stdout and stderr into
    // one unframed stream and demuxing becomes impossible. The agent loop feeds
    // stderr back to the model, so keeping them separate is load-bearing.
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: false,
    OpenStdin: false,
    NetworkDisabled: true,
    // Lets the boot reaper identify containers this subsystem owns.
    Labels: { [sandbox.label]: runId },
    Env: ["NODE_OPTIONS=--max-old-space-size=256"],
    HostConfig: {
      // No network interface at all — not a firewall rule, no interface to
      // configure. Exfiltration and dependency installation are both impossible.
      NetworkMode: "none",
      ReadonlyRootfs: true,
      // The only writable paths. noexec/nosuid/nodev stop the program from
      // dropping a binary into the workspace and executing it.
      Tmpfs: {
        "/workspace": `rw,noexec,nosuid,nodev,size=${sandbox.tmpfsSizeMb}m,mode=1777`,
        "/tmp": "rw,noexec,nosuid,nodev,size=8m,mode=1777"
      },
      Memory: sandbox.memoryBytes,
      // Equal to Memory means zero swap. Without this the container can exceed
      // its memory limit by swapping, which defeats the cap.
      MemorySwap: sandbox.memoryBytes,
      NanoCpus: sandbox.nanoCpus,
      // Bounds fork bombs.
      PidsLimit: sandbox.pidsLimit,
      CapDrop: ["ALL"],
      // Blocks privilege escalation through setuid binaries.
      SecurityOpt: ["no-new-privileges"],
      Privileged: false,
      // Removal is explicit in the finally block: AutoRemove would race us to
      // the container and can delete it before the exit code is read.
      AutoRemove: false,
      Binds: binds && binds.length ? binds : undefined
    }
  };
}

/**
 * Execute generated code in a fresh, hardened, ephemeral container.
 *
 * @param {Object} options - Execution options.
 * @param {string} options.runId - Run id (used for the container label).
 * @param {Array<{name: string, content: string}>} options.files - Files to write into /workspace.
 * @param {string} [options.entrypoint] - File to execute. Defaults to main.js.
 * @param {number} [options.timeoutMs] - Wall-clock limit. Defaults to config.
 * @param {string[]} [options.binds] - Optional host binds (used by the artifact sink).
 * @returns {Promise<{exitCode: number|null, stdout: string, stderr: string, durationMs: number, timedOut: boolean, outputTruncated: boolean}>} Execution result.
 */
async function execute({ runId, files = [], entrypoint = "main.js", timeoutMs, binds = [] }) {
  const docker = getDocker();
  const limitMs = timeoutMs || config.sandbox.timeoutMs;
  const script = buildBootstrapScript(files, entrypoint);

  const budget = createOutputBudget(config.sandbox.maxOutputBytes);
  const stdout = new CappedCollector(budget);
  const stderr = new CappedCollector(budget);

  const startedAt = Date.now();
  let container = null;
  let timedOut = false;
  let timer = null;

  try {
    container = await docker.createContainer(buildContainerConfig({ runId, script, binds }));

    // Attach BEFORE start, or output produced between start and attach is lost —
    // and for a fast-failing program that is often the entire stderr.
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    container.modem.demuxStream(stream, stdout, stderr);

    const streamClosed = new Promise((resolve) => {
      stream.on("end", resolve);
      stream.on("close", resolve);
      stream.on("error", resolve);
    });

    await container.start();

    timer = setTimeout(() => {
      timedOut = true;
      // SIGKILL, not SIGTERM: hostile or hung code must not get a chance to
      // ignore the signal or trap it and keep running.
      container.kill({ signal: "SIGKILL" }).catch((error) => {
        logger.warn({ message: "Sandbox kill failed", runId, error: error.message });
      });
    }, limitMs);

    // kill() makes wait() resolve, so this normally settles right after the
    // deadline. The race only matters if the daemon stops responding.
    const waitResult = await Promise.race([
      container.wait(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Container did not exit after kill")),
          limitMs + WAIT_GRACE_MS
        )
      )
    ]);

    clearTimeout(timer);
    timer = null;

    // Give the output stream a moment to flush what the container wrote just
    // before exiting; never block on it indefinitely.
    await Promise.race([streamClosed, new Promise((resolve) => setTimeout(resolve, 2000))]);

    const exitCode = waitResult && typeof waitResult.StatusCode === "number"
      ? waitResult.StatusCode
      : null;

    const result = {
      // A SIGKILLed container reports 137. Surfacing that as an exit code
      // alongside timedOut:true would let a caller mistake a timeout for the
      // program's own failure, so it is normalised to null.
      exitCode: timedOut ? null : exitCode,
      stdout: stdout.text(),
      stderr: stderr.text(),
      durationMs: Date.now() - startedAt,
      timedOut,
      outputTruncated: budget.isTruncated()
    };

    logger.info({
      message: "Sandbox run finished",
      runId,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      outputBytes: budget.bytesUsed(),
      outputTruncated: result.outputTruncated
    });

    return result;
  } finally {
    if (timer) clearTimeout(timer);
    // Runs on the success path, on timeout, and on any throw above — including a
    // failure inside createContainer's own callers. A leaked container holds its
    // memory reservation and tmpfs until the daemon restarts.
    if (container) {
      try {
        await container.remove({ force: true });
      } catch (error) {
        // Already gone is fine; anything else is logged, never rethrown, so a
        // cleanup failure cannot mask the real error from the try block.
        logger.warn({ message: "Sandbox container cleanup failed", runId, error: error.message });
      }
    }
  }
}

module.exports = {
  execute,
  setDockerClient,
  getDocker,
  buildBootstrapScript,
  buildContainerConfig,
  createOutputBudget,
  CappedCollector,
  MAX_BOOTSTRAP_SCRIPT_BYTES
};
