const mongoose = require("mongoose");

const QuizAttemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  answers: [{ questionIndex: Number, selectedOption: Number }],
  score: { type: Number, required: true, min: 0 },
  maxScore: { type: Number, required: true, min: 1 },
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

QuizAttemptSchema.index({ quiz: 1, student: 1 }, { unique: true });
module.exports = mongoose.model("QuizAttempt", QuizAttemptSchema);
