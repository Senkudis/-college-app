const mongoose = require("mongoose");

/* بلاغات المحتوى المسيء.
   متطلب إلزامي في App Store (بند 1.2 — محتوى ينشئه المستخدمون): يجب
   توفير وسيلة للإبلاغ عن المحتوى المسيء، ووسيلة لحظر المستخدم المسيء،
   والتزام بمراجعة البلاغات وإزالة المخالف خلال 24 ساعة. التطبيق يتيح
   تعليقات الفيديو ورفع صور المعرض ومهام غرف المذاكرة دون أي من ذلك. */
const ContentReportSchema = new mongoose.Schema(
  {
    // نوع المحتوى المُبلَّغ عنه
    targetType: {
      type: String,
      enum: ["comment", "gallery", "pod-task", "user"],
      required: true,
      index: true
    },

    /* معرّف المحتوى المُبلَّغ عنه — نصّي لا ObjectId.
       مهام غرف المذاكرة تحمل معرّفاً مولَّداً نصياً ("1788…-a3f2") لا
       ObjectId، فحصر النوع كان يجعل كل بلاغ على مهمة يُرفض بـ400. */
    targetId: {
      type: String,
      required: true,
      index: true
    },

    // صاحب المحتوى — يُحفظ وقت الإبلاغ كي يبقى معروفاً حتى بعد الحذف
    targetAuthor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    // نسخة من النص وقت الإبلاغ، ليراجعها المشرف بعد حذف الأصل
    snapshot: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ""
    },

    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    reason: {
      type: String,
      enum: ["spam", "harassment", "hate", "sexual", "violence", "cheating", "other"],
      required: true
    },

    details: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ""
    },

    status: {
      type: String,
      enum: ["pending", "removed", "dismissed"],
      default: "pending",
      index: true
    },

    // المشرف الذي بتّ في البلاغ ومتى
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    reviewNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    }
  },
  { timestamps: true }
);

// بلاغ واحد لكل مستخدم على نفس المحتوى — يمنع إغراق قائمة المراجعة
ContentReportSchema.index({ targetType: 1, targetId: 1, reportedBy: 1 }, { unique: true });
// ترتيب طابور المراجعة: المعلّق أولاً ثم الأحدث
ContentReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("ContentReport", ContentReportSchema);
