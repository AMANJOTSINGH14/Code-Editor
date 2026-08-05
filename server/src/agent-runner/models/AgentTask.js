const mongoose = require("mongoose");

/**
 * A task specification the agent can be asked to carry out.
 *
 * Referenced by all three triggers: the webhook resolves `:taskId`, the manual
 * endpoint takes a task id in the body, and the cron scheduler enqueues every
 * enabled task that carries a `cronExpression`.
 */
const agentTaskSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    // Stable human-readable id used by the demo script so it does not have to
    // parse an ObjectId out of the seed output.
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    description: {
      type: String,
      default: ""
    },
    // The natural-language spec handed to the model.
    prompt: {
      type: String,
      required: true
    },
    // Files written into the sandbox workspace alongside the generated program.
    // This is what makes the self-correction demo genuine rather than scripted:
    // the fixture really is malformed, so a naive first attempt really does exit
    // non-zero.
    fixtures: [
      {
        _id: false,
        name: { type: String, required: true },
        content: { type: String, required: true }
      }
    ],
    // Artifact filenames the program is expected to produce in /workspace/out.
    expectedArtifacts: [{ type: String }],
    // Exact-value assertions checked against the artifact after a zero exit.
    // Without this, "exit 0" is the only success signal — and a program can
    // exit 0 while emitting confidently wrong numbers. Optional: tasks with no
    // validator keep the old exit-code-only behaviour.
    validator: {
      artifactName: { type: String, default: "" },
      assertions: [
        {
          _id: false,
          label: { type: String, default: "" },
          path: { type: String, required: true },
          // Mixed so a single assertion can target a number, string or boolean.
          equals: { type: mongoose.Schema.Types.Mixed }
        }
      ]
    },
    cronExpression: {
      type: String,
      default: ""
    },
    enabled: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

/**
 * Convert a task into API-facing metadata.
 * @returns {Object} Task metadata.
 */
agentTaskSchema.methods.toMeta = function toMeta() {
  return {
    id: this._id.toString(),
    name: this.name,
    slug: this.slug,
    description: this.description,
    cronExpression: this.cronExpression,
    enabled: this.enabled,
    expectedArtifacts: this.expectedArtifacts,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model("AgentTask", agentTaskSchema);
