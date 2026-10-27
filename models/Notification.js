const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "عنوان التنبيه مطلوب"],
      trim: true,
      maxlength: [100, "العنوان يجب أن يكون أقل من 100 حرف"]
    },
    
    message: {
      type: String,
      required: [true, "رسالة التنبيه مطلوبة"],
      trim: true,
      maxlength: [500, "الرسالة يجب أن تكون أقل من 500 حرف"]
    },

    type: {
      type: String,
      enum: ["normal", "emergency"],
      default: "normal",
      index: true // فهرسة لتحسين أداء الاستعلامات حسب النوع
    },

    /* "custom" = إشعار موجَّه لمستلمين محددين في recipients، لا لفئة أدوار.
       تستخدمه الإشعارات المولّدة آلياً (المالية، تحذير الغياب، كيدي). كان
       غيابه من القائمة يجعل Notification.create يرمي ValidationError تبتلعه
       كتل catch في تلك المسارات، فلا يصل الطالب أي إشعار مالي أو غيابي. */
    target: {
      type: String,
      enum: ["all", "students", "doctors", "leaders", "custom"],
      default: "all"
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      required: false,
      index: true
    },

    // الدفعات المستهدفة (للإشعارات المرتبطة بدفعة معينة)
    batches: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch"
    }],

    // المستلمون المباشرون (للإشعارات المحددة)
    recipients: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],

    seenBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],
    
    readBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],
    
    /* shownInDashboard كان يخزّن مستنداً فرعياً لكل مستخدم داخل الإشعار
       نفسه — أي أن إشعاراً عاماً لألفَي مستخدم يحمل ألفَي عنصر، ومعه
       readBy و seenBy، فيتضخّم المستند الواحد ويبطؤ كل عدّ للإشعارات غير
       المقروءة. لم يعد أي مسار يكتب فيه، ونُبقيه للتوافق مع البيانات
       القائمة فقط؛ التنظيف الدوري أدناه يحدّ من نموّ الباقي. */
    shownInDashboard: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      shownAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  { 
    timestamps: true
  }
);

NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ type: 1, createdAt: -1 });
NotificationSchema.index({ createdBy: 1, createdAt: -1 });

// Middleware قبل الحفظ لتنظيف البيانات
NotificationSchema.pre('save', function() {
  if (this.title) {
    this.title = this.title.trim();
  }
  if (this.message) {
    this.message = this.message.trim();
  }
});

// ===== استعلام الرؤية الموحّد =====
// من يرى الإشعار؟
//   1) المستلمون المحددون (recipients) يرونه دائماً.
//   2) وإلا: يجب أن يطابق دور المستخدم الهدف (target)،
//      وإن كان الإشعار مقيّداً بدفعات فيجب أن يكون المستخدم منتمياً لإحداها أيضاً.
// ملاحظة: قيم target جمع ("students") بينما الأدوار مفرد ("student") — التحويل هنا إلزامي.
NotificationSchema.statics.buildVisibilityQuery = function(userId, userRoles = [], userBatch = null, userBatches = []) {
  const pluralRole = { student: "students", doctor: "doctors", leader: "leaders" };
  const roleTargets = (userRoles || []).map(r => pluralRole[r]).filter(Boolean);
  // العميد والأدمن يريان الإشعارات الموجهة لأي فئة
  if ((userRoles || []).some(r => r === "dean" || r === "admin")) {
    roleTargets.push("students", "doctors", "leaders");
  }

  const roleMatch    = { $or: [{ target: "all" }, { target: { $in: roleTargets } }] };
  const noRecipients = { $or: [{ recipients: { $exists: false } }, { recipients: { $size: 0 } }] };
  const noBatches    = { $or: [{ batches: { $exists: false } }, { batches: { $size: 0 } }] };
  const myBatchIds   = [userBatch, ...(userBatches || [])].filter(Boolean);

  const visibility = [
    { recipients: userId },
    { $and: [noRecipients, noBatches, roleMatch] }
  ];
  if (myBatchIds.length > 0) {
    visibility.push({ $and: [noRecipients, { batches: { $in: myBatchIds } }, roleMatch] });
  }
  return { $or: visibility };
};

// دالة ستاتيكية لعد الإشعارات غير المقروءة لمستخدم معين (مع تصفية الصلاحية)
NotificationSchema.statics.countUnreadForUser = async function(userId, userRoles = [], userBatch = null, userBatches = []) {
  const query = {
    readBy: { $ne: userId },
    ...this.buildVisibilityQuery(userId, userRoles, userBatch, userBatches)
  };
  return await this.countDocuments(query);
};

// دالة ستاتيكية لجلب الإشعارات الطارئة الجديدة (مع تصفية الصلاحية)
NotificationSchema.statics.getNewEmergencies = async function(lastCheckTime, limit = 10, userId = null, userRoles = [], userBatch = null, userBatches = []) {
  const query = {
    type: "emergency",
    createdAt: { $gt: new Date(lastCheckTime) }
  };
  if (userId) {
    Object.assign(query, this.buildVisibilityQuery(userId, userRoles, userBatch, userBatches));
  }
  return await this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('createdBy', 'name roles email');
};

// دالة لحذف الإشعارات القديمة تلقائياً (يمكن تفعيلها بواسطة Cron Job)
NotificationSchema.statics.cleanupOldNotifications = async function(days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return await this.deleteMany({
    type: "normal", // حذف الإشعارات العادية فقط
    createdAt: { $lt: cutoffDate }
  });
};

// Virtual للحصول على عدد القراء
NotificationSchema.virtual('readCount').get(function() {
  return this.readBy.length;
});

// Virtual للحصول على عدد المشاهدين
NotificationSchema.virtual('seenCount').get(function() {
  return this.seenBy.length;
});

// Virtual للتحقق إذا كان الإشعار طارئ
NotificationSchema.virtual('isEmergency').get(function() {
  return this.type === "emergency";
});

// التحقق من أن المستخدم قد قرأ الإشعار
NotificationSchema.methods.hasRead = function(userId) {
  return this.readBy.some(id => id.toString() === userId.toString());
};

// التحقق من أن المستخدم قد شاهد الإشعار
NotificationSchema.methods.hasSeen = function(userId) {
  return this.seenBy.some(id => id.toString() === userId.toString());
};

// إضافة المستخدم إلى قائمة القراء (باستخدام $addToSet لمنع التكرار)
NotificationSchema.methods.markAsRead = function(userId) {
  if (!this.hasRead(userId)) {
    this.readBy.addToSet(userId);
  }
  return this.save();
};

// إضافة المستخدم إلى قائمة المشاهدين
NotificationSchema.methods.markAsSeen = function(userId) {
  if (!this.hasSeen(userId)) {
    this.seenBy.push(userId);
  }
  return this.save();
};

// تسجيل عرض الإشعار في dashboard لمستخدم معين (لمنع التكرار)
NotificationSchema.methods.markAsShownInDashboard = function(userId) {
  if (!userId) return Promise.resolve(this);
  const targetIdStr = String(userId);
  const alreadyShown = this.shownInDashboard.some(
    entry => entry.userId && String(entry.userId) === targetIdStr
  );
  
  if (!alreadyShown) {
    this.shownInDashboard.push({
      userId: userId,
      shownAt: new Date()
    });
  }
  
  return this.save();
};

// التحقق إذا تم عرض الإشعار في dashboard لمستخدم معين
NotificationSchema.methods.hasBeenShownInDashboard = function(userId) {
  if (!userId) return false;
  const targetIdStr = String(userId);
  return this.shownInDashboard.some(
    entry => entry.userId && String(entry.userId) === targetIdStr
  );
};

/* كل إشعار جديد يصل للهاتف أياً كان من أنشأه (انظر utils/pushDispatch).
   الحفظ اللاحق للمستند نفسه (تعليم كمقروء/معروض) لا يُعيد الإرسال.
   من يرسل بنفسه إشعاراً أغنى يضبط doc.$locals.skipPush قبل الحفظ. */
NotificationSchema.pre("save", function () {
  this.$locals.wasNew = this.isNew;
});
NotificationSchema.post("save", function (doc) {
  if (!doc.$locals?.wasNew || doc.$locals.skipPush || process.env.NODE_ENV === "test") return;
  setImmediate(() => require("../utils/pushDispatch").dispatchPush(doc));
});

module.exports = mongoose.model("Notification", NotificationSchema);
