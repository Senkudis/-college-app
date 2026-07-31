const mongoose = require('mongoose');

const savedNoteSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  subject: {
    type: String, // يمكن أن يكون نصياً مثل 'رياضيات 1' لسهولة البحث
    default: 'عام'
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  content: {
    type: String, // HTML أو نص حسب الحاجة
    required: true
  },
  type: {
    type: String,
    enum: ['summary', 'flashcards', 'quiz', 'plan', 'other'],
    default: 'summary'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// لضمان جلب ملاحظات المستخدم بسرعة مرتبة حسب الأحدث
savedNoteSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SavedNote', savedNoteSchema);
