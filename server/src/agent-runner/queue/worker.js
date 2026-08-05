const { Worker } = require("bullmq");
const config = require("../config");
const logger = require("../../utils/logger");
const { createConnection, isRedisConfigured } = require("./connection");

/**
 * The queue worker.
 *
 * Concurrency is 1 by configuration and by intent: runs execute strictly one at
 * a time. Parallel runs would stack sandbox containers (each holding a 512MB
 * reservation) and, more importantly, would race each other for the Gemini quota
 * shared with the RAG reviewer.
 */

/** @type {Worker|null} */
let worker = null;

/**
 * Start the worker.
 * @returns {Worker|null} The worker, or null when Redis is unavailable.
 */
function startWorker() {
  if (worker) return worker;
  if (!isRedisConfigured()) {
    logger.error({ message: "Agent runner worker not started — REDIS_URL is not set" });
    return null;
  }

  worker = new Worker(
    config.queue.name,
    async (job) => {
      // Required lazily so the orchestrator's dependency graph (dockerode, the
      // Gemini client) loads only in a process that actually runs jobs.
      const { runAgent } = require("../agent/orchestrator");
      logger.info({ message: "Agent run started", runId: job.data.runId, jobId: job.id });
      return runAgent(job.data.runId);
    },
    {
      connection: createConnection("worker"),
      prefix: config.queue.prefix,
      concurrency: config.queue.concurrency,
      // The orchestrator can legitimately occupy a job for minutes: up to 3
      // attempts, each with a Gemini call that may queue behind the rate limiter
      // plus a 30s sandbox execution. The default 30s lock would expire
      // mid-run and let BullMQ hand the same job to another worker.
      lockDuration: 600000,
      stalledInterval: 60000
    }
  );

  worker.on("completed", (job, result) => {
    logger.info({
      message: "Agent run job completed",
      runId: job.data.runId,
      status: result ? result.status : "unknown"
    });
  });

  worker.on("failed", (job, error) => {
    // The orchestrator persists its own terminal states; reaching here means an
    // unexpected throw escaped it.
    logger.error({
      message: "Agent run job threw",
      runId: job ? job.data.runId : null,
      error: error.message
    });
  });

  logger.info({
    message: "Agent runner worker started",
    queue: config.queue.name,
    concurrency: config.queue.concurrency
  });

  return worker;
}

/**
 * Stop the worker.
 * @returns {Promise<void>} Resolves when closed.
 */
async function stopWorker() {
  if (!worker) return;
  await worker.close();
  worker = null;
}

module.exports = { startWorker, stopWorker };
