const config = require("./config");
const logger = require("../utils/logger");

/**
 * Agent Runner subsystem entry point.
 *
 * This module is the ONLY thing the host application knows about. app.js calls
 * register(app) on one line; everything else lives under src/agent-runner/ and
 * can be deleted wholesale (see REMOVAL.md).
 *
 * When AGENT_RUNNER_ENABLED is false — the default — register() returns before
 * requiring anything else. That matters: the requires below pull in dockerode,
 * bullmq, node-cron and two Mongoose models, and registering a Mongoose model is
 * a global side effect. Deferring them keeps the disabled path genuinely inert
 * rather than merely route-free.
 */

let started = false;

/**
 * Start background work: orphan reaping, the scheduler, and (from Phase 3) the
 * queue worker. Failures are logged, never thrown — a broken agent runner must
 * not prevent the editor or the RAG reviewer from serving.
 * @returns {Promise<void>} Resolves when startup completes.
 */
async function startBackground() {
  // Each step requires its own module inside its own try, so a failure in one
  // — including at require time, e.g. dockerode failing to load — cannot stop
  // the others from starting.
  try {
    // Before anything can enqueue work, clear containers a previous process
    // left behind.
    const { reapOrphans } = require("./sandbox/reaper");
    await reapOrphans();
  } catch (error) {
    logger.error({ message: "Sandbox reaper failed at boot", error: error.message });
  }

  try {
    const { startScheduler } = require("./scheduler/cron");
    const count = await startScheduler();
    logger.info({ message: "Agent runner scheduler started", schedules: count });
  } catch (error) {
    logger.error({ message: "Agent runner scheduler failed to start", error: error.message });
  }

  try {
    const { startWorker } = require("./queue/worker");
    startWorker();
  } catch (error) {
    logger.error({ message: "Agent runner worker failed to start", error: error.message });
  }
}

/**
 * Shut down the subsystem's own resources.
 *
 * Best-effort: the host's shutdown handler in server.js calls process.exit(0)
 * when it finishes, and with only one permitted line in the entrypoint there is
 * no way to sequence ahead of it. Everything here is idempotent and fast.
 * @returns {Promise<void>} Resolves when shutdown completes.
 */
async function shutdown() {
  if (!started) return;
  started = false;

  try {
    const { stopScheduler } = require("./scheduler/cron");
    stopScheduler();

    // Closed before the queue so an in-flight job is allowed to finish rather
    // than being abandoned mid-run with a container still alive.
    const { stopWorker } = require("./queue/worker");
    await stopWorker();

    const { closeQueue } = require("./queue/queue");
    await closeQueue();

    const { closeConnections } = require("./queue/connection");
    await closeConnections();

    logger.info({ message: "Agent runner shut down" });
  } catch (error) {
    logger.warn({ message: "Agent runner shutdown error", error: error.message });
  }
}

/**
 * Register the Agent Runner with the Express app.
 *
 * @param {import("express").Application} app - Express application.
 * @returns {boolean} True when the subsystem was registered.
 */
function register(app) {
  if (!config.enabled) {
    logger.info({ message: "Agent runner disabled (AGENT_RUNNER_ENABLED=false)" });
    return false;
  }

  if (started) return true;
  started = true;

  const runsRouter = require("./routes/runs.routes");
  app.use("/api/runs", runsRouter);

  logger.info({
    message: "Agent runner registered",
    mount: "/api/runs",
    redisDb: config.redis.db,
    queuePrefix: config.queue.prefix,
    sandboxImage: config.sandbox.image,
    model: config.gemini.model
  });

  // Under test, mount the routes but start nothing in the background: workers,
  // cron timers and Docker calls would leak across test files and keep Jest
  // from exiting.
  if (process.env.NODE_ENV === "test") {
    return true;
  }

  startBackground().catch((error) => {
    logger.error({ message: "Agent runner background startup failed", error: error.message });
  });

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return true;
}

module.exports = { register, shutdown };
