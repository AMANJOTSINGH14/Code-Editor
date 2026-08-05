const { z } = require("zod");
const appConfig = require("../config");

/**
 * Agent Runner configuration.
 *
 * Deliberately self-contained: this reads its own AGENT_RUNNER_* variables
 * instead of extending server/src/config/index.js, so the whole subsystem can be
 * deleted without touching shared config. `../config` is imported read-only for
 * values the runner shares with the host app (Redis URL, Gemini key), and
 * because requiring it guarantees dotenv has already run.
 *
 * Every value below is env-overridable; the defaults are the ones specified in
 * PLAN.md.
 */

const schema = z.object({
  // Master switch. When false the subsystem registers nothing at all: no routes,
  // no worker, no cron, no Redis clients, no Docker calls.
  AGENT_RUNNER_ENABLED: z.string().default("false").transform((v) => v === "true"),

  // --- Redis / queue isolation -------------------------------------------
  // The runner uses a DEDICATED Redis logical DB so BullMQ's keyspace can never
  // collide with the app's keys (which all live on DB 0 under the "collab:"
  // prefix) or with the sliding-window rate limiter. The BullMQ prefix is a
  // second, independent layer of separation.
  AGENT_RUNNER_REDIS_DB: z.coerce.number().int().min(0).max(15).default(3),
  AGENT_RUNNER_QUEUE_PREFIX: z.string().min(1).default("agentrunner"),
  AGENT_RUNNER_QUEUE_NAME: z.string().min(1).default("agent-runs"),
  AGENT_RUNNER_WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(1),

  // --- Trigger layer ------------------------------------------------------
  AGENT_RUNNER_WEBHOOK_SECRET: z.string().default(""),
  // Reject webhook deliveries whose signed timestamp is older than this, so a
  // captured request cannot be replayed indefinitely.
  AGENT_RUNNER_WEBHOOK_TOLERANCE_SEC: z.coerce.number().int().min(1).default(300),
  // How long an idempotency key is remembered.
  AGENT_RUNNER_IDEMPOTENCY_TTL_SEC: z.coerce.number().int().min(1).default(86400),
  AGENT_RUNNER_CRON_ENABLED: z.string().default("true").transform((v) => v === "true"),

  // --- Sandbox ------------------------------------------------------------
  AGENT_RUNNER_SANDBOX_IMAGE: z.string().min(1).default("agent-sandbox:node20"),
  AGENT_RUNNER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  // Hard cap on captured stdout+stderr. A log bomb must not be able to grow the
  // API process heap.
  AGENT_RUNNER_MAX_OUTPUT_BYTES: z.coerce.number().int().min(1024).default(1024 * 1024),
  AGENT_RUNNER_MEMORY_MB: z.coerce.number().int().min(16).default(512),
  AGENT_RUNNER_CPUS: z.coerce.number().min(0.1).default(0.5),
  AGENT_RUNNER_PIDS_LIMIT: z.coerce.number().int().min(1).default(128),
  AGENT_RUNNER_TMPFS_SIZE_MB: z.coerce.number().int().min(1).default(64),
  // Generated source is injected via the container Cmd (see executor.js for why
  // docker cp cannot work here). The binding limit is NOT the ~2MB total
  // ARG_MAX but MAX_ARG_STRLEN — 128KB for any SINGLE argument, and the whole
  // bootstrap script is one argument to `sh -c`. Base64 inflates by 4/3, so
  // 64KB of source leaves comfortable headroom under that ceiling.
  AGENT_RUNNER_CODE_MAX_BYTES: z.coerce.number().int().min(1024).default(64 * 1024),

  // --- Agent loop ---------------------------------------------------------
  AGENT_RUNNER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),

  // --- Gemini budget ------------------------------------------------------
  // PINNED model. There is deliberately NO fallback chain: silently escalating
  // to another model on a 429 can drain the daily cap through a tier nobody
  // chose, and a call-count budget cannot detect it. On 404, or on a 429 that
  // reports limit:0 (no allocation at all), the run fails loudly instead.
  AGENT_RUNNER_GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  AGENT_RUNNER_GEMINI_RPM: z.coerce.number().int().min(1).default(6),
  // MUST account for thinking tokens, not just the visible answer. Measured on
  // gemini-2.5-flash: a codegen prompt spends 4k-6.5k tokens on internal
  // reasoning before emitting a single visible character, and maxOutputTokens
  // covers BOTH. At 4096 the entire budget went to reasoning and responses were
  // truncated after "### PLAN", before the code fence.
  AGENT_RUNNER_GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1024).default(16384),
  AGENT_RUNNER_GEMINI_CALLS_PER_RUN: z.coerce.number().int().min(1).default(6),
  AGENT_RUNNER_GEMINI_DAILY_CAP: z.coerce.number().int().min(1).default(200),
  // Replays the last successful run from Mongo instead of calling the API, so a
  // live demo can never fail on a rate limit.
  DEMO_CACHE: z.string().default("false").transform((v) => v === "true"),

  // --- Artifacts ----------------------------------------------------------
  // Path as seen by THIS process.
  AGENT_RUNNER_ARTIFACTS_PATH: z.string().default("./artifacts"),
  // Path as seen by the DOCKER DAEMON. When the API runs inside a container but
  // drives the host daemon, sandbox containers are siblings, so a bind mount
  // source must be a host path — not a path inside this container. Empty means
  // "same as AGENT_RUNNER_ARTIFACTS_PATH" (correct when running on the host).
  AGENT_RUNNER_ARTIFACTS_HOST_PATH: z.string().default(""),
  // Comma-separated: filesystem | webhook | github. Filesystem is always the
  // system of record; the others are additional delivery.
  AGENT_RUNNER_ARTIFACT_SINKS: z.string().default("filesystem"),
  AGENT_RUNNER_ARTIFACT_WEBHOOK_URL: z.string().default(""),
  // Optional outbound HMAC so a receiver can verify the payload came from here.
  AGENT_RUNNER_ARTIFACT_WEBHOOK_SECRET: z.string().default(""),
  // GitHub PR sink. Skips cleanly when disabled or when the token/repo is unset
  // — never a hard failure, since it is explicitly optional.
  AGENT_RUNNER_GITHUB_ENABLED: z.string().default("false").transform((v) => v === "true"),
  AGENT_RUNNER_GITHUB_TOKEN: z.string().default(""),
  // owner/repo
  AGENT_RUNNER_GITHUB_REPO: z.string().default(""),
  AGENT_RUNNER_GITHUB_BASE_BRANCH: z.string().default("main")
});

const env = schema.parse(process.env);

const config = {
  enabled: env.AGENT_RUNNER_ENABLED,

  redis: {
    // Same Redis server as the host app, different logical DB.
    url: appConfig.redisUrl,
    db: env.AGENT_RUNNER_REDIS_DB
  },

  queue: {
    name: env.AGENT_RUNNER_QUEUE_NAME,
    prefix: env.AGENT_RUNNER_QUEUE_PREFIX,
    concurrency: env.AGENT_RUNNER_WORKER_CONCURRENCY
  },

  webhook: {
    secret: env.AGENT_RUNNER_WEBHOOK_SECRET,
    toleranceSec: env.AGENT_RUNNER_WEBHOOK_TOLERANCE_SEC,
    idempotencyTtlSec: env.AGENT_RUNNER_IDEMPOTENCY_TTL_SEC
  },

  cronEnabled: env.AGENT_RUNNER_CRON_ENABLED,

  sandbox: {
    image: env.AGENT_RUNNER_SANDBOX_IMAGE,
    timeoutMs: env.AGENT_RUNNER_TIMEOUT_MS,
    maxOutputBytes: env.AGENT_RUNNER_MAX_OUTPUT_BYTES,
    memoryBytes: env.AGENT_RUNNER_MEMORY_MB * 1024 * 1024,
    nanoCpus: Math.round(env.AGENT_RUNNER_CPUS * 1e9),
    pidsLimit: env.AGENT_RUNNER_PIDS_LIMIT,
    tmpfsSizeMb: env.AGENT_RUNNER_TMPFS_SIZE_MB,
    codeMaxBytes: env.AGENT_RUNNER_CODE_MAX_BYTES,
    // Every container the runner creates carries this label, so the boot reaper
    // can find orphans left behind by a hard crash.
    label: "codesync.agentrun"
  },

  agent: {
    maxAttempts: env.AGENT_RUNNER_MAX_ATTEMPTS
  },

  gemini: {
    apiKey: appConfig.gemini.apiKey,
    model: env.AGENT_RUNNER_GEMINI_MODEL,
    requestsPerMinute: env.AGENT_RUNNER_GEMINI_RPM,
    maxOutputTokens: env.AGENT_RUNNER_GEMINI_MAX_OUTPUT_TOKENS,
    callsPerRun: env.AGENT_RUNNER_GEMINI_CALLS_PER_RUN,
    dailyCap: env.AGENT_RUNNER_GEMINI_DAILY_CAP,
    demoCache: env.DEMO_CACHE
  },

  artifacts: {
    path: env.AGENT_RUNNER_ARTIFACTS_PATH,
    hostPath: env.AGENT_RUNNER_ARTIFACTS_HOST_PATH || env.AGENT_RUNNER_ARTIFACTS_PATH,
    sinks: env.AGENT_RUNNER_ARTIFACT_SINKS.split(",").map((s) => s.trim()).filter(Boolean),
    webhookUrl: env.AGENT_RUNNER_ARTIFACT_WEBHOOK_URL,
    webhookSecret: env.AGENT_RUNNER_ARTIFACT_WEBHOOK_SECRET,
    github: {
      enabled: env.AGENT_RUNNER_GITHUB_ENABLED,
      token: env.AGENT_RUNNER_GITHUB_TOKEN,
      repo: env.AGENT_RUNNER_GITHUB_REPO,
      baseBranch: env.AGENT_RUNNER_GITHUB_BASE_BRANCH
    }
  }
};

module.exports = config;
