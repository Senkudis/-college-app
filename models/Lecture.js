const mongoose = require("mongoose");

const LectureSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true
    },
    file: String, // ← ملف المحاضرة
    videoUrl: String,
    fileHash: { type: String, select: false }, // ← بصمة الملف لمنع التكرار
    extractedText: { type: String, default: '' }, // نص الـ PDF المستخرج تلقائياً للمساعد الذكي
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lecture", LectureSchema);
