const mongoose = require("mongoose");

const VideoCommentSchema = new mongoose.Schema(
  {
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
      required: true,
      index: true
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    // Video timestamp in seconds — null for general (non-timestamped) comments
    timestamp: {
      type: Number,
      default: null
    },
    // Threading support — null for top-level comments
    parentComment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VideoComment",
      default: null
    }
  },
  { timestamps: true }
);

// Compound index for fetching all comments for a video sorted by timestamp
VideoCommentSchema.index({ video: 1, timestamp: 1 });
VideoCommentSchema.index({ video: 1, createdAt: -1 });

module.exports = mongoose.model("VideoComment", VideoCommentSchema);
