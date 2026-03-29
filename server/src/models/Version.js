const mongoose = require("mongoose");

const versionSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true
    },
    versionNumber: {
      type: Number,
      required: true
    },
    label: {
      type: String,
      required: true
    },
    content: {
      type: Buffer,
      required: true
    },
    snapshotText: {
      type: String,
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    isPublished: {
      type: Boolean,
      default: false
    },
    isAutoSave: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

versionSchema.index({ documentId: 1, versionNumber: -1 });

/**
 * Convert version to summary data.
 * @returns {Object} Version summary.
 */
versionSchema.methods.toSummary = function toSummary() {
  const isPopulated = this.populated("createdBy") || (this.createdBy && this.createdBy._id);
  return {
    id: this._id.toString(),
    documentId: this.documentId.toString(),
    versionNumber: this.versionNumber,
    label: this.label,
    snapshotText: this.snapshotText,
    createdBy: isPopulated ? this.createdBy._id.toString() : this.createdBy.toString(),
    createdByName: isPopulated ? this.createdBy.name || "" : "",
    createdAt: this.createdAt,
    isPublished: this.isPublished,
    isAutoSave: this.isAutoSave
  };
};

module.exports = mongoose.model("Version", versionSchema);
