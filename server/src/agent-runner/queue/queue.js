const { Queue } = require("bullmq");
const config = require("../config");
const logger = require("../../utils/logger");
const { createConnection, isRedisConfigured } = require("./connection");

/**
 * The single queue every trigger feeds.
 *
 * Webhook, manual API call and cron all enqueue here — one queue, one worker,
 * concurrency 1. There is no second queue and no Kafka.
 */

/** @type {Queue|null} */
let queue = null;

/**
 * Get (lazily creating) the agent runs queue.
 * @returns {Queue|null} The queue, or null when Redis is not configured.
 */
function getQueue() {
  if (queue) return queue;
  if (!isRedisConfigured()) {
    logger.error({
      message: "Agent runner enabled but REDIS_URL is not set — queue unavailable"
    });
    return null;
  }

  queue = new Queue(config.queue.name, {
    connection: createConnection("queue"),
    prefix: config.queue.prefix,
    defaultJobOptions: {
      // The agent loop does its own bounded retrying and persists every attempt.
      // A BullMQ-level retry would silently re-run the whole loop and burn the
      // Gemini budget a second time, so jobs get exactly one shot.
      attempts: 1,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 }
    }
  });

  logger.info({
    message: "Agent runner queue ready",
    queue: config.queue.name,
    prefix: config.queue.prefix,
    db: config.redis.db
  });

  return queue;
}

/**
 * Enqueue a run for execution.
 * @param {Object} payload - Job payload.
 * @param {string} payload.runId - AgentRun id.
 * @param {string} payload.taskId - AgentTask id.
 * @param {string} payload.triggerSource - webhook | manual | cron.
 * @returns {Promise<string|null>} Job id, or null when the queue is unavailable.
 */
async function enqueueRun(payload) {
  const activeQueue = getQueue();
  if (!activeQueue) return null;

  // Job id is the run id: BullMQ de-duplicates on it, giving a third layer of
  // replay protection behind the Redis idempotency key and the Mongo unique index.
  const job = await activeQueue.add("run", payload, { jobId: payload.runId });
  logger.info({
    message: "Agent run enqueued",
    runId: payload.runId,
    taskId: payload.taskId,
    triggerSource: payload.triggerSource
  });
  return job.id;
}

/**
 * Close the queue.
 * @returns {Promise<void>} Resolves when closed.
 */
async function closeQueue() {
  if (!queue) return;
  await queue.close();
  queue = null;
}

module.exports = {
  getQueue,
  enqueueRun,
  closeQueue
};
