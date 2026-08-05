const cron = require("node-cron");
const config = require("../config");
const logger = require("../../utils/logger");
const AgentTask = require("../models/AgentTask");
const { createConnection, isRedisConfigured } = require("../queue/connection");
const { createAndEnqueue } = require("../services/run.service");

/**
 * Scheduled triggers.
 *
 * Every enabled task carrying a `cronExpression` gets a node-cron schedule that
 * enqueues onto the same single queue the webhook and manual triggers use.
 */

/** @type {import("node-cron").ScheduledTask[]} */
let scheduled = [];

/** @type {import("ioredis")|null} */
let lockClient = null;

/**
 * Acquire a short-lived, cross-instance lock for one scheduled firing.
 *
 * node-cron is per-process, so with N server replicas a schedule fires N times
 * for the same tick. Each firing would be a separate run consuming a separate
 * slice of the shared Gemini budget. The lock key includes the tick's minute, so
 * exactly one instance wins per tick and the others no-op.
 *
 * Without Redis there is only one instance worth talking about, so the lock is
 * skipped rather than failing closed.
 * @param {string} taskId - Task id.
 * @returns {Promise<boolean>} True when this instance owns the tick.
 */
async function acquireTickLock(taskId) {
  if (!isRedisConfigured()) return true;
  if (!lockClient) lockClient = createConnection("cron-lock");

  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = `${config.queue.prefix}:cron:${taskId}:${minuteBucket}`;

  try {
    // TTL comfortably longer than a tick, short enough to self-heal.
    const result = await lockClient.set(key, "1", "EX", 120, "NX");
    return result === "OK";
  } catch (error) {
    logger.warn({ message: "Cron tick lock failed, skipping tick", taskId, error: error.message });
    // Fail closed: a missed scheduled run is cheaper than N duplicate runs
    // burning the shared Gemini quota.
    return false;
  }
}

/**
 * Load enabled tasks with a cron expression and schedule them.
 * @returns {Promise<number>} Number of schedules registered.
 */
async function startScheduler() {
  if (!config.cronEnabled) {
    logger.info({ message: "Agent runner cron disabled" });
    return 0;
  }

  const tasks = await AgentTask.find({ enabled: true, cronExpression: { $ne: "" } });

  for (const task of tasks) {
    const expression = task.cronExpression;
    if (!cron.validate(expression)) {
      logger.warn({
        message: "Skipping agent task with invalid cron expression",
        slug: task.slug,
        cronExpression: expression
      });
      continue;
    }

    const taskId = task._id.toString();
    const job = cron.schedule(expression, async () => {
      try {
        const owned = await acquireTickLock(taskId);
        if (!owned) return;

        const { run } = await createAndEnqueue({
          taskRef: taskId,
          triggerSource: "cron"
        });
        logger.info({
          message: "Agent run triggered by cron",
          runId: run._id.toString(),
          slug: task.slug
        });
      } catch (error) {
        // A scheduled firing must never take the process down.
        logger.error({
          message: "Cron trigger failed",
          slug: task.slug,
          error: error.message
        });
      }
    });

    scheduled.push(job);
    logger.info({
      message: "Agent task scheduled",
      slug: task.slug,
      cronExpression: expression
    });
  }

  return scheduled.length;
}

/**
 * Stop all schedules.
 * @returns {void}
 */
function stopScheduler() {
  scheduled.forEach((job) => job.stop());
  scheduled = [];
}

module.exports = { startScheduler, stopScheduler };
