const mongoose = require('mongoose');

const PastExamQuestionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctOption: { type: Number, required: true, default: 0 },
  explanation: { type: String, default: '' },
  points: { type: Number, default: 1 }
}, { _id: false });

const PastExamSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  year: { type: String, required: true, trim: true },
  semester: { type: Number, default: 1 },
  examType: { type: String, enum: ['final', 'midterm'], default: 'final' },
  pdfFile: { type: String, default: null },
  questions: [PastExamQuestionSchema],
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  downloadCount: { type: Number, default: 0 }
}, { timestamps: true });

PastExamSchema.index({ subject: 1, year: 1, examType: 1 });

module.exports = mongoose.model('PastExam', PastExamSchema);
