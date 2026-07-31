const mongoose = require("mongoose");

const VideoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    batches: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch"
    }],

    // ===== Chunked / Resumable Upload Tracking =====
    uploadId: { type: String, required: true, unique: true, index: true },
    originalFilename: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },        // expected total bytes
    totalChunks: { type: Number, default: 0 },
    uploadedChunks: { type: [Number], default: [] }, // indices of received chunks

    // ===== Processing Status =====
    status: {
      type: String,
      enum: ["uploading", "processing", "ready", "failed"],
      default: "uploading"
    },

    // ===== Transcoded Variants =====
    variants: {
      original: {
        path: { type: String, default: "" },
        size: { type: Number, default: 0 },
        resolution: { type: String, default: "" }
      },
      low: {
        path: { type: String, default: "" },
        size: { type: Number, default: 0 },
        resolution: { type: String, default: "360p" }
      },
      audioOnly: {
        path: { type: String, default: "" },
        size: { type: Number, default: 0 },
        format: { type: String, default: "mp3" }
      }
    },

    // ===== Metadata (populated by FFprobe after processing) =====
    duration: { type: Number, default: 0 },           // seconds
    thumbnailPath: { type: String, default: "" },
    mimeType: { type: String, default: "video/mp4" },

    // ===== Chapters (lecturer-defined markers) =====
    chapters: [{
      title: { type: String, required: true, trim: true },
      time: { type: Number, required: true }  // seconds
    }],

    // ===== Analytics =====
    views: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// Index for efficient subject-based queries
VideoSchema.index({ subject: 1, createdAt: -1 });
VideoSchema.index({ status: 1 });

module.exports = mongoose.model("Video", VideoSchema);
