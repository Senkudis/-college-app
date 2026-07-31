const mongoose = require("mongoose");

// One source of truth for classes, exams, meetings, deadlines and holidays.
const AcademicEventSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, trim: true, maxlength: 1200, default: "" },
  type: {
    type: String,
    enum: ["lecture", "exam", "assignment", "meeting", "holiday", "announcement"],
    default: "lecture",
    index: true
  },
  startsAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, default: null },
  location: { type: String, trim: true, maxlength: 160, default: "" },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", default: null },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

AcademicEventSchema.index({ batch: 1, startsAt: 1 });

module.exports = mongoose.model("AcademicEvent", AcademicEventSchema);
