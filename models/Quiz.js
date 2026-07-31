const mongoose = require("mongoose");

const QuestionSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 700 },
  options: [{ type: String, required: true, trim: true, maxlength: 300 }],
  correctOption: { type: Number, required: true, min: 0 },
  points: { type: Number, default: 1, min: 1, max: 100 }
}, { _id: false });

const QuizSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1500, default: "" },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", required: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
  startsAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, required: true, index: true },
  durationMinutes: { type: Number, required: true, min: 1, max: 300 },
  published: { type: Boolean, default: false, index: true },
  questions: { type: [QuestionSchema], validate: v => v.length > 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

QuizSchema.index({ batch: 1, published: 1, startsAt: 1 });
module.exports = mongoose.model("Quiz", QuizSchema);
