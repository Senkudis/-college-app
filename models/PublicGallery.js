const mongoose = require('mongoose');

const publicGallerySchema = new mongoose.Schema(
  {
    imageUrl: {
      type: String,
      required: [true, 'رابط الصورة مطلوب']
    },
    caption: {
      type: String,
      trim: true,
      maxlength: [2000, 'الوصف لا يتجاوز 2000 حرف'],
      default: ''
    },
    category: {
      type: String,
      enum: ['نشاط', 'مبنى', 'تخرج', 'أخرى'],
      default: 'أخرى'
    },
    order: {
      type: Number,
      default: 0
    },
    isVisible: {
      type: Boolean,
      default: true
    },
    likesCount: {
      type: Number,
      default: 0
    },
    // null-safe: إذا تم حذف الأدمن تبقى الصور ولا تُكسر
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Index للترتيب والفلترة
publicGallerySchema.index({ isVisible: 1, order: 1 });
publicGallerySchema.index({ category: 1 });

module.exports = mongoose.model('PublicGallery', publicGallerySchema);
