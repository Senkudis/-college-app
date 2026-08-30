const mongoose = require('mongoose');

const CourseSurveySchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
  semester: { type: Number, default: 1 },
  academicYear: { type: String, required: true },
  ratings: {
    contentClarity: { type: Number, min: 1, max: 5, required: true },
    teachingMethod: { type: Number, min: 1, max: 5, required: true },
    labUsefulness: { type: Number, min: 1, max: 5, required: true },
    examFairness: { type: Number, min: 1, max: 5, required: true }
  },
  feedbackText: { type: String, trim: true, default: '' },
  submittedByHash: { type: String, required: true, unique: true }
}, { timestamps: true });

CourseSurveySchema.index({ subject: 1, academicYear: 1 });

module.exports = mongoose.model('CourseSurvey', CourseSurveySchema);
