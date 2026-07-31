const mongoose = require("mongoose");

const SubjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    level: {
      type: String,
      required: true
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    batches: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch"
    }]
  },
  { timestamps: true }
);

SubjectSchema.index({ doctor: 1 });
SubjectSchema.index({ batches: 1 });

module.exports = mongoose.model("Subject", SubjectSchema);
