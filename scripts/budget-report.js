#!/usr/bin/env node
/**
 * Gemini quota report for the Agent Runner.
 *
 *   node scripts/budget-report.js
 *
 * Reads the authoritative daily counter out of Redis and reconciles it against
 * the per-run call records persisted in Mongo. Makes no API calls itself.
 *
 * Redis is the source of truth for "calls used today" — it is what the limiter
 * actually enforces against. Mongo's geminiCalls[] is the audit trail. They can
 * legitimately disagree: a call reserved in Redis but failing before it was
 * persisted counts against quota without appearing in run history, which is the
 * safe direction to be wrong.
 */
const path = require("path");

const SERVER = path.resolve(__dirname, "../server/src");

// Dependencies are resolved from server/node_modules explicitly. This file sits
// in scripts/, which has no node_modules of its own, and Node resolves by the
// requiring FILE's location — so a bare require("mongoose") here fails.
const fromServer = (name) => require(require.resolve(name, { paths: [SERVER] }));
const mongoose = fromServer("mongoose");
const IORedis = fromServer("ioredis");
const appConfig = require(`${SERVER}/config`);
const runnerConfig = require(`${SERVER}/agent-runner/config`);
const AgentRun = require(`${SERVER}/agent-runner/models/AgentRun`);
const { pacificDateKey, dailyKey } = require(`${SERVER}/agent-runner/quota/limiter`);

const pad = (value, width) => String(value).padEnd(width);

/**
 * Read today's counter from Redis.
 * @returns {Promise<{used: number, key: string, source: string}>} Counter state.
 */
async function readDailyCounter() {
  const key = dailyKey();

  if (!appConfig.redisUrl) {
    return { used: 0, key, source: "redis unavailable (REDIS_URL unset)" };
  }

  const redis = new IORedis(appConfig.redisUrl, {
    db: runnerConfig.redis.db,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true
  });

  try {
    await redis.connect();
    const value = await redis.get(key);
    return { used: Number(value) || 0, key, source: `redis db ${runnerConfig.redis.db}` };
  } catch (error) {
    return { used: 0, key, source: `redis error: ${error.message}` };
  } finally {
    redis.disconnect();
  }
}

/**
 * Print the report.
 * @returns {Promise<void>} Resolves when done.
 */
async function main() {
  const counter = await readDailyCounter();
  const cap = runnerConfig.gemini.dailyCap;
  const remaining = Math.max(0, cap - counter.used);

  console.log("");
  console.log("=".repeat(78));
  console.log("  AGENT RUNNER — GEMINI BUDGET REPORT");
  console.log("=".repeat(78));
  console.log("");
  console.log(`  pinned model        ${runnerConfig.gemini.model}`);
  console.log(`  rate limit          ${runnerConfig.gemini.requestsPerMinute} req/min (queues on limit)`);
  console.log(`  per-run budget      ${runnerConfig.gemini.callsPerRun} calls`);
  console.log(`  worker concurrency  ${runnerConfig.queue.concurrency}`);
  console.log(`  DEMO_CACHE          ${runnerConfig.gemini.demoCache}`);
  console.log("");
  console.log(`  pacific date        ${pacificDateKey()}`);
  console.log(`  counter key         ${counter.key}`);
  console.log(`  counter source      ${counter.source}`);
  console.log("");
  console.log("  ---------------------------------------------------------------");
  console.log(`  CALLS USED TODAY    ${counter.used} / ${cap}`);
  console.log(`  CALLS REMAINING     ${remaining}`);
  console.log("  ---------------------------------------------------------------");
  console.log("");

  await mongoose.connect(appConfig.mongoUri, { serverSelectionTimeoutMS: 5000 });

  // Only today's runs, in Pacific terms, so the breakdown lines up with the
  // counter rather than with UTC midnight.
  const startOfPacificDay = new Date(`${pacificDateKey()}T00:00:00-07:00`);
  const runs = await AgentRun.find({ createdAt: { $gte: startOfPacificDay } }).sort({ createdAt: 1 });

  console.log("  PER-RUN BREAKDOWN (today)");
  console.log("");

  if (!runs.length) {
    console.log("    (no runs today)");
  } else {
    console.log(
      `    ${pad("runId", 26)}${pad("status", 17)}${pad("model", 20)}${pad("calls", 7)}${pad("tokens", 8)}`
    );
    console.log(`    ${"-".repeat(78)}`);

    let totalCalls = 0;
    let totalTokens = 0;

    runs.forEach((run) => {
      const calls = run.geminiCalls || [];
      const tokens = calls.reduce((sum, call) => sum + (call.totalTokens || 0), 0);
      // A run replayed from cache has no calls; show the pinned model anyway so
      // the column is never blank and confusing.
      const model = calls.length ? calls[0].model : "-";
      totalCalls += calls.length;
      totalTokens += tokens;

      console.log(
        `    ${pad(run._id.toString(), 26)}${pad(run.status, 17)}${pad(model, 20)}${pad(calls.length, 7)}${pad(tokens, 8)}`
      );
    });

    console.log(`    ${"-".repeat(78)}`);
    console.log(
      `    ${pad("TOTAL", 26)}${pad(`${runs.length} runs`, 17)}${pad("", 20)}${pad(totalCalls, 7)}${pad(totalTokens, 8)}`
    );
    console.log("");

    if (totalCalls !== counter.used) {
      console.log(
        `    NOTE: Mongo audit shows ${totalCalls} calls, Redis counter shows ${counter.used}.`
      );
      console.log(
        "          Redis is authoritative — it is what the limiter enforces. A gap means"
      );
      console.log(
        "          calls were reserved but failed before being persisted, or runs predate"
      );
      console.log("          the counter. Counting toward quota is the safe direction.");
    }
  }

  console.log("");
  if (remaining === 0) {
    console.log("  *** DAILY CAP REACHED — new runs will be refused ***");
  } else if (counter.used >= cap * 0.75) {
    console.log(`  *** WARNING: ${counter.used}/${cap} used — approaching the cap ***`);
  }
  console.log("");

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("budget-report failed:", error.message);
  process.exit(1);
});
