const mongoose = require('mongoose');

const publicNewsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'عنوان الخبر مطلوب'],
      trim: true,
      maxlength: [500, 'العنوان لا يتجاوز 500 حرف']
    },
    summary: {
      type: String,
      required: [true, 'ملخص الخبر مطلوب'],
      trim: true,
      maxlength: [2500, 'الملخص لا يتجاوز 2500 حرف']
    },
    body: {
      type: String,
      required: [true, 'محتوى الخبر مطلوب']
    },
    imageUrl: {
      type: String,
      default: null
    },
    tags: {
      type: [String],
      default: []
    },
    viewsCount: {
      type: Number,
      default: 0
    },
    likesCount: {
      type: Number,
      default: 0
    },
    isPublished: {
      type: Boolean,
      default: true
    },
    publishedAt: {
      type: Date,
      default: Date.now
    },
    // null-safe: إذا تم حذف الأدمن تبقى الأخبار ولا تُكسر
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Index للبحث والترتيب
publicNewsSchema.index({ isPublished: 1, publishedAt: -1 });
publicNewsSchema.index({ tags: 1 });

module.exports = mongoose.model('PublicNews', publicNewsSchema);
