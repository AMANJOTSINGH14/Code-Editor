const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    language: {
      type: String,
      default: "javascript"
    },
    roomId: {
      type: String,
      required: true,
      unique: true
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    collaborators: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],
    isPublic: {
      type: Boolean,
      default: false
    },
    content: {
      type: Buffer,
      default: null
    },
    snapshotText: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

/**
 * Convert a document into metadata for dashboards.
 * @returns {Object} Metadata object.
 */
documentSchema.methods.toMeta = function toMeta() {
  return {
    id: this._id.toString(),
    title: this.title,
    language: this.language,
    roomId: this.roomId,
    owner: this.owner.toString(),
    isPublic: this.isPublic,
    updatedAt: this.updatedAt
  };
};

module.exports = mongoose.model("Document", documentSchema);
