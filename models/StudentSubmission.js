const mongoose = require("mongoose");

const StudentSubmissionSchema = new mongoose.Schema(
  {
    // معرف التكليف الذي يتم تسليمه
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assignment",
      required: [true, "التكليف مطلوب"]
    },
    
    // الطالب الذي يسلم التكليف
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "الطالب مطلوب"]
    },
    
    // نوع التكليف (تمرين/بحث/مشروع)
    submissionType: {
      type: String,
      enum: ["exercise", "research", "project"],
      required: [true, "نوع التسليم مطلوب"]
    },
    
    // الملف المرفوع
    file: {
      type: String,
      required: [true, "يجب رفع ملف التسليم"]
    },
    
    // نوع الملف (pdf, image, etc)
    fileType: {
      type: String,
      enum: ["pdf", "image", "document"],
      required: true
    },
    
    // تاريخ ووقت التسليم
    submissionDate: {
      type: Date,
      default: Date.now
    },
    
    // هل التسليم متأخر؟
    isLate: {
      type: Boolean,
      default: false
    },
    
    // ملاحظات الطالب (اختياري)
    notes: {
      type: String,
      trim: true
    },
    
    // حالة التسليم
    status: {
      type: String,
      enum: ["pending", "reviewed", "graded"],
      default: "pending"
    },
    
    // التقييم (من 0 إلى 100)
    grade: {
      type: Number,
      min: 0,
      max: 100
    },
    
    // تعليقات المقيم
    feedback: {
      type: String,
      trim: true
    },
    
    // معرف المقيم (الدكتور أو العميد)
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    
    // تاريخ التقييم
    reviewDate: {
      type: Date
    }
  },
  { timestamps: true }
);

// فهرس مركب لضمان عدم تسليم نفس الطالب للتكليف مرتين
StudentSubmissionSchema.index({ assignment: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("StudentSubmission", StudentSubmissionSchema);
