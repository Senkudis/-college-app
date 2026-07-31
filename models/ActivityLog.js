const mongoose = require("mongoose");

const ActivityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    action: {
      type: String,
      required: true,
      enum: ["USER_LOGIN", "VIDEO_VIEWED", "QUIZ_ATTEMPTED", "ASSIGNMENT_SUBMITTED"]
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch"
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);
