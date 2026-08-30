const mongoose = require('mongoose');

const StudyPodTaskSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  completed: { type: Boolean, default: false },
  completedBy: { type: String, default: null }
}, { _id: false });

const StudyPodSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
  activeUsers: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String },
    joinedAt: { type: Date, default: Date.now }
  }],
  timerState: {
    status: { type: String, enum: ['stopped', 'running', 'break'], default: 'stopped' },
    remainingSeconds: { type: Number, default: 1500 }, // 25 minutes
    startedAt: { type: Date, default: null }
  },
  tasks: [StudyPodTaskSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

StudyPodSchema.index({ batch: 1, subject: 1 });

module.exports = mongoose.model('StudyPod', StudyPodSchema);
