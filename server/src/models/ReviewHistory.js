const mongoose = require("mongoose");

const reviewHistorySchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    reviewText: {
      type: String,
      required: true
    },
    model: {
      type: String,
      required: true
    },
    notice: {
      type: String,
      default: ""
    },
    contextChunks: [
      {
        chunkId: String,
        content: String,
        score: Number
      }
    ]
  },
  {
    timestamps: true
  }
);

/**
 * Convert review to summary.
 * @returns {Object} Review summary.
 */
reviewHistorySchema.methods.toSummary = function toSummary() {
  return {
    id: this._id.toString(),
    documentId: this.documentId.toString(),
    userId: this.userId.toString(),
    reviewText: this.reviewText,
    model: this.model,
    notice: this.notice,
    contextChunks: this.contextChunks,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model("ReviewHistory", reviewHistorySchema);
