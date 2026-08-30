const mongoose = require("mongoose");

const QuizAttemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  answers: [{ questionIndex: Number, selectedOption: Number }],
  /* بدء المحاولة — بدونه كانت durationMinutes مخزّنة وغير مفروضة إطلاقاً:
     الفحص الوحيد أن التسليم داخل نافذة startsAt→endsAt، فاختبار مدته
     ٢٠ دقيقة في نافذة ثلاثة أيام يعني ثلاثة أيام فعلية للطالب. */
  startedAt: { type: Date, default: null },
  score: { type: Number, default: 0, min: 0 },
  maxScore: { type: Number, required: true, min: 1 },
  // يفصل المحاولة الجارية عن المسلَّمة — الفهرس الفريد يمنع محاولتين لطالب
  submitted: { type: Boolean, default: false },
  submittedAt: { type: Date, default: null }
}, { timestamps: true });

QuizAttemptSchema.index({ quiz: 1, student: 1 }, { unique: true });
module.exports = mongoose.model("QuizAttempt", QuizAttemptSchema);
