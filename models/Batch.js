const mongoose = require("mongoose");

const BatchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    themeColor: {
      type: String,
      default: "#6366f1", // Default primary color
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
    inviteCode: {
      type: String,
      trim: true,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Batch", BatchSchema);
