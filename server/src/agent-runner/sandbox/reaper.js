const config = require("../config");
const logger = require("../../utils/logger");
const { getDocker } = require("./executor");

/**
 * Orphan container reaper.
 *
 * executor.js removes its container in a `finally`, which covers every path the
 * process can take — but not paths where the process stops taking them: SIGKILL,
 * an OOM kill, a container restart mid-run. Those leave a sandbox container
 * behind holding its memory reservation and tmpfs allocation until the daemon
 * restarts.
 *
 * Every container the runner creates is labelled `codesync.agentrun=<runId>`, so
 * on boot we can identify precisely the containers this subsystem owns and
 * nothing else.
 */

/**
 * Remove orphaned sandbox containers left by a previous process.
 * @returns {Promise<{removed: number, failed: number}>} Reap counts.
 */
async function reapOrphans() {
  const docker = getDocker();

  let containers;
  try {
    // `all: true` matters — an orphan is usually already exited, and the default
    // listing only returns running containers.
    containers = await docker.listContainers({
      all: true,
      filters: { label: [config.sandbox.label] }
    });
  } catch (error) {
    // Docker being unreachable at boot must not stop the server. Runs will fail
    // with a clear error when someone actually triggers one.
    logger.warn({ message: "Sandbox reaper could not reach Docker", error: error.message });
    return { removed: 0, failed: 0 };
  }

  if (!containers.length) {
    logger.info({ message: "Sandbox reaper found no orphans" });
    return { removed: 0, failed: 0 };
  }

  let removed = 0;
  let failed = 0;

  for (const info of containers) {
    try {
      await docker.getContainer(info.Id).remove({ force: true });
      removed += 1;
      logger.info({
        message: "Reaped orphaned sandbox container",
        containerId: info.Id.slice(0, 12),
        runId: info.Labels ? info.Labels[config.sandbox.label] : null
      });
    } catch (error) {
      failed += 1;
      logger.warn({
        message: "Failed to reap sandbox container",
        containerId: info.Id.slice(0, 12),
        error: error.message
      });
    }
  }

  logger.info({ message: "Sandbox reaper finished", removed, failed });
  return { removed, failed };
}

module.exports = { reapOrphans };
