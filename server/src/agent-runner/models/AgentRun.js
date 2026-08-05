const mongoose = require("mongoose");

const RUN_STATUSES = [
  "queued",
  "planning",
  "executing",
  "retrying",
  "succeeded",
  "failed",
  "timeout",
  // Terminal: the run hit its per-run Gemini call budget. Never retried — the
  // whole point is to stop consuming quota shared with the RAG reviewer.
  "budget_exceeded"
];

const TRIGGER_SOURCES = ["webhook", "manual", "cron"];

/**
 * One attempt of the agent loop. Attempts are only ever appended, never
 * overwritten: the attempt-by-attempt history is the artifact that demonstrates
 * self-correction, so losing attempt N when attempt N+1 succeeds would destroy
 * the thing worth showing.
 */
const attemptSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    generatedCode: { type: String, default: "" },
    plan: { type: String, default: "" },
    stdout: { type: String, default: "" },
    stderr: { type: String, default: "" },
    exitCode: { type: Number, default: null },
    durationMs: { type: Number, default: 0 },
    timedOut: { type: Boolean, default: false },
    outputTruncated: { type: Boolean, default: false },
    // Populated when an attempt exited 0 but its artifact failed validation —
    // the record of WHY a zero-exit attempt was still rejected.
    validationFailures: [
      {
        _id: false,
        label: String,
        path: String,
        expected: mongoose.Schema.Types.Mixed,
        actual: mongoose.Schema.Types.Mixed
      }
    ],
    // Stamped so an old run stays interpretable after the prompt template changes.
    promptVersion: { type: String, default: "" },
    model: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null }
  },
  { _id: false }
);

/**
 * A single Gemini call, recorded for quota auditing. Every call the runner makes
 * lands here with its timestamp, model and token count, so consumption can be
 * reconstructed from run history alone.
 */
const geminiCallSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    model: { type: String, required: true },
    attemptIndex: { type: Number, default: null },
    promptTokens: { type: Number, default: 0 },
    responseTokens: { type: Number, default: 0 },
    // Reasoning tokens on thinking models. Billed, but never visible in the
    // response — and usually the bulk of the spend, so quota auditing that
    // ignores them badly understates consumption.
    thoughtTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    finishReason: { type: String, default: "" },
    latencyMs: { type: Number, default: 0 },
    // Number of 429 backoff retries this call needed before succeeding.
    retries: { type: Number, default: 0 }
  },
  { _id: false }
);

const artifactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    sizeBytes: { type: Number, default: 0 },
    sha256: { type: String, default: "" },
    // Which sink produced it: filesystem | webhook | github
    sink: { type: String, default: "filesystem" },
    // Filesystem path relative to the artifacts root, or the sink's target URL.
    location: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const agentRunSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AgentTask",
      required: true
    },
    triggerSource: {
      type: String,
      enum: TRIGGER_SOURCES,
      required: true
    },
    // Set for manual runs; absent for webhook and cron.
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    status: {
      type: String,
      enum: RUN_STATUSES,
      default: "queued",
      index: true
    },
    attempts: [attemptSchema],
    artifacts: [artifactSchema],
    geminiCalls: [geminiCallSchema],
    // Tri-state and deliberately distinct from `status`:
    //   true  — artifact was checked against exact expected values and matched
    //   false — checked and did NOT match (the run did not reach succeeded)
    //   null  — no validator on this task, so correctness was never established
    // `succeeded` alone only ever meant "exited 0", which three live runs proved
    // is compatible with badly wrong output.
    validated: { type: Boolean, default: null },
    validationSummary: { type: String, default: "" },
    totalDurationMs: { type: Number, default: 0 },
    // Populated on any terminal failure, including budget_exceeded, so the
    // reason survives in run history rather than only in logs.
    error: {
      message: { type: String, default: "" },
      code: { type: String, default: "" }
    },
    // Webhook replay protection. Sparse so the many runs without a key do not
    // collide on null under the unique index.
    idempotencyKey: {
      type: String,
      default: null
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null }
  },
  {
    timestamps: true
  }
);

// Enforces webhook idempotency at the database level, so two concurrent
// deliveries of the same event cannot both create a run even if they race past
// the Redis check.
agentRunSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

agentRunSchema.index({ createdAt: -1 });

/**
 * Compact representation for run lists — deliberately omits attempt bodies,
 * which can be hundreds of kilobytes each.
 * @returns {Object} Run summary.
 */
agentRunSchema.methods.toSummary = function toSummary() {
  return {
    id: this._id.toString(),
    taskId: this.taskId ? this.taskId.toString() : null,
    triggerSource: this.triggerSource,
    status: this.status,
    attemptCount: this.attempts.length,
    artifactCount: this.artifacts.length,
    geminiCallCount: this.geminiCalls.length,
    validated: this.validated,
    validationSummary: this.validationSummary,
    totalDurationMs: this.totalDurationMs,
    error: this.error && this.error.message ? this.error : null,
    createdAt: this.createdAt,
    finishedAt: this.finishedAt
  };
};

/**
 * Full representation for the run detail view, including every attempt.
 * @returns {Object} Run detail.
 */
agentRunSchema.methods.toDetail = function toDetail() {
  return {
    ...this.toSummary(),
    attempts: this.attempts.map((attempt) => ({
      index: attempt.index,
      plan: attempt.plan,
      generatedCode: attempt.generatedCode,
      stdout: attempt.stdout,
      stderr: attempt.stderr,
      exitCode: attempt.exitCode,
      durationMs: attempt.durationMs,
      timedOut: attempt.timedOut,
      outputTruncated: attempt.outputTruncated,
      validationFailures: attempt.validationFailures || [],
      promptVersion: attempt.promptVersion,
      model: attempt.model,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt
    })),
    artifacts: this.artifacts.map((artifact) => ({
      name: artifact.name,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      sink: artifact.sink,
      createdAt: artifact.createdAt
    })),
    geminiCalls: this.geminiCalls
  };
};

module.exports = mongoose.model("AgentRun", agentRunSchema);
module.exports.RUN_STATUSES = RUN_STATUSES;
module.exports.TRIGGER_SOURCES = TRIGGER_SOURCES;
