const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const normalizeEmail = require("../utils/normalizeEmail");

const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, "الاسم مطلوب"],
    trim: true
  },
  
  email: {
    type: String,
    required: [true, "البريد الإلكتروني مطلوب"],
    unique: true,
    trim: true,
    lowercase: true,
    // يزيل الأحرف الخفية (RTL/zero-width) التي تكسر تسجيل الدخول — يُطبّق على كل كتابة عبر mongoose
    set: normalizeEmail
  },
  
  password: { 
    type: String, 
    required: [true, "كلمة المرور مطلوبة"]
  },
  
  roles: {
    type: [String],
    enum: ["student", "leader", "doctor", "dean", "admin"],
    default: ["student"]
  },
  
  // ==== الحقول الجديدة ====
  
  // أول دخول للمستخدم (إجباري تغيير كلمة السر)
  firstLogin: {
    type: Boolean,
    default: true
  },
  
  // كود استعادة كلمة السر
  resetPasswordCode: {
    type: String,
    default: null
  },
  
  // تاريخ انتهاء صلاحية الكود (20 دقيقة)
  resetPasswordExpires: {
    type: Date,
    default: null
  },
  
  // تاريخ آخر تغيير لكلمة السر
  passwordChangedAt: {
    type: Date,
    default: null
  },
  
  // تاريخ آخر محاولة إرسال كود
  lastCodeSentAt: {
    type: Date,
    default: null
  },
  
  // حقول تفعيل تسجيل الدخول بالبصمة أو الوجه (WebAuthn/Passkeys)
  passkeys: [{
    credentialID: String,
    credentialPublicKey: Buffer,
    counter: Number,
    transports: [String],
    deviceType: String,
    backedUp: Boolean
  }],
  currentChallenge: {
    type: String,
    default: null
  },
  
  // لتقييد الجلسات النشطة (One Active Session)
  currentSessionId: {
    type: String,
    default: null
  },

  // Last successful login, shown in the profile and useful for account audits.
  lastLogin: {
    type: Date,
    default: null
  },
  
  // حالة الحساب (نشط/موقوف)
  isActive: {
    type: Boolean,
    default: true
  },
  
  // عدد محاولات تسجيل الدخول الفاشلة
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  
  // وقت قفل الحساب بسبب محاولات فاشلة
  lockUntil: {
    type: Date,
    default: null
  },

  // الدفعة المسجل فيها (للطلاب والليدر)
  batch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Batch",
    default: null
  },

  // الدفعات المرتبط بها (للدكاترة)
  batches: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Batch"
  }],

  // FCM Tokens للإشعارات (تطبيق أندرويد الأصلي)
  fcmTokens: [{
    type: String
  }],

  // اشتراكات Web Push (متصفح/آيفون PWA) — كل اشتراك كائن PushSubscription كامل
  webPushSubscriptions: [{
    endpoint: { type: String, required: true },
    keys: {
      p256dh: String,
      auth: String
    }
  }],

  // نقاط الولاء/الإنجاز (للـ Leaderboard)
  points: {
    type: Number,
    default: 0,
    min: 0
  },

  // رقم الهاتف / الواتساب
  phone: {
    type: String,
    default: ""
  },

  // هل التسجيل معلق وينتظر موافقة الإدارة
  isPendingRegistration: {
    type: Boolean,
    default: false
  },

  // Soft delete
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Helper للتحقق مما إذا كانت كلمة المرور مشفرة مسبقاً بنظام bcrypt
const isBcryptHash = (str) => typeof str === "string" && /^\$2[abxy]\$\d+\$/.test(str);

// ==== Middleware قبل الحفظ ====

// Soft delete: استبعاد المحذوفين تلقائياً
userSchema.pre('find', function() {
  this.where({ deletedAt: null });
});
userSchema.pre('findOne', function() {
  this.where({ deletedAt: null });
});

userSchema.pre('save', async function() {
  // فقط إذا تم تعديل كلمة السر وكانت كلمة سر عادية (غير مشفرة مسبقاً)
  if (!this.isModified('password')) return;
  
  if (isBcryptHash(this.password)) {
    // كلمة المرور مشفرة مسبقاً — لا تُعد تشفيرها لمنع إتلاف كلمة السر!
    return;
  }
  
  try {
    // تشفير كلمة السر
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    
    // تحديث وقت تغيير كلمة السر
    this.passwordChangedAt = Date.now();
    
    // إذا كان المستخدم جديداً، يتم تعيين firstLogin = true
    if (this.isNew && this.firstLogin === undefined) {
      this.firstLogin = true;
    }
  } catch (error) {
    throw error;
  }
});

// إصلاح middleware التحديث لمنع إعادة التشفير المزدوج وإعادة تعيين firstLogin عشوائياً
userSchema.pre('findOneAndUpdate', async function() {
  const update = this.getUpdate();
  
  // إذا تم تحديث كلمة السر في هذا التعديل
  if (update.password || (update.$set && update.$set.password)) {
    try {
      const passwordToHash = update.password || (update.$set && update.$set.password);
      
      // إذا كانت كلمة السر مشفرة مسبقاً، لا تُعد تشفيرها
      if (isBcryptHash(passwordToHash)) {
        return;
      }

      // تشفير كلمة السر الجديدة
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(passwordToHash, salt);
      
      // تحديث object التعديل
      if (update.password) {
        this.setUpdate({
          ...update,
          password: hashedPassword,
          passwordChangedAt: Date.now()
        });
      } else if (update.$set) {
        const newSet = {
          ...update.$set,
          password: hashedPassword,
          passwordChangedAt: Date.now()
        };
        this.setUpdate({
          ...update,
          $set: newSet
        });
      }
    } catch (error) {
      throw error;
    }
  }
});

// ==== Methods ====

// مقارنة كلمة السر المدخلة مع المشفرة
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// التحقق إذا انتهت صلاحية كود الاستعادة
userSchema.methods.isResetCodeExpired = function() {
  if (!this.resetPasswordExpires) return true;
  return Date.now() > this.resetPasswordExpires;
};

// التحقق إذا كان يمكن إعادة إرسال الكود (كل 30 ثانية)
userSchema.methods.canResendCode = function() {
  if (!this.lastCodeSentAt) return true;
  
  const now = Date.now();
  const lastSent = new Date(this.lastCodeSentAt).getTime();
  const thirtySeconds = 30 * 1000; // 30 ثانية
  
  return (now - lastSent) > thirtySeconds;
};

// إنشاء كود استعادة عشوائي (6 أرقام)
userSchema.methods.generateResetCode = function() {
  // إنشاء كود مكون من 6 أرقام
  const code = crypto.randomInt(100000, 999999).toString();
  
  this.resetPasswordCode = code;
  // صلاحية الكود 20 دقيقة
  this.resetPasswordExpires = new Date(Date.now() + 20 * 60 * 1000);
  this.lastCodeSentAt = new Date();
  
  return code;
};

// التحقق من صحة كود الاستعادة
userSchema.methods.verifyResetCode = function(code) {
  if (!this.resetPasswordCode || !this.resetPasswordExpires) {
    return false;
  }
  
  // التحقق من تطابق الكود وانتهاء الصلاحية
  const isCodeValid = this.resetPasswordCode === code;
  const isNotExpired = Date.now() < this.resetPasswordExpires;
  
  return isCodeValid && isNotExpired;
};

// إعادة تعيين كلمة السر
userSchema.methods.resetPassword = async function(newPassword) {
  this.password = newPassword;
  this.resetPasswordCode = null;
  this.resetPasswordExpires = null;
  this.firstLogin = false; // بعد إعادة التعيين، لم يعد أول دخول
  this.failedLoginAttempts = 0; // إعادة تعيين المحاولات الفاشلة
  this.lockUntil = null; // إلغاء قفل الحساب
  
  await this.save();
  return true;
};

// تغيير كلمة السر عند أول دخول
userSchema.methods.changePasswordFirstLogin = async function(newPassword) {
  this.password = newPassword;
  this.firstLogin = false;
  this.failedLoginAttempts = 0;
  this.lockUntil = null;
  
  await this.save();
  return true;
};

// زيادة عدد محاولات الدخول الفاشلة
// ملاحظة: تم إيقاف ميزة قفل الحساب بناءً على طلب المستخدم.
// الدالة تبقى للتوافق مع الكود القديم لكنها تُصفّر العداد بدلاً من رفعه.
// لإعادة تفعيل القفل: استبدل الكود بـ: this.failedLoginAttempts += 1; ...إلخ
userSchema.methods.incrementFailedAttempts = async function() {
  this.failedLoginAttempts = 0;
  this.lockUntil = null;
  await this.save();
  return this;
};

// ✅ تم التصحيح: تحسين دالة resetFailedAttempts لتجنب مشاكل middleware
userSchema.methods.resetFailedAttempts = async function() {
  try {
    // استخدم updateOne مباشرة لتجنب trigger middleware الحفظ
    await this.constructor.updateOne(
      { _id: this._id },
      { 
        $set: { 
          failedLoginAttempts: 0,
          lockUntil: null 
        } 
      }
    );
    
    // تحديث object الحالي
    this.failedLoginAttempts = 0;
    this.lockUntil = null;
    
    return this;
  } catch (error) {
    console.error('Error in resetFailedAttempts:', error);
    throw error;
  }
};

// التحقق إذا كان الحساب مقفولاً
userSchema.methods.isLocked = function() {
  // تم إيقاف ميزة قفل الحساب بناءً على طلب المستخدم
  return false;
};

// حساب الوقت المتبقي للقفل
userSchema.methods.getLockRemainingTime = function() {
  if (!this.lockUntil) return 0;
  
  const now = Date.now();
  const lockTime = new Date(this.lockUntil).getTime();
  
  return Math.max(0, Math.floor((lockTime - now) / 1000)); // بالثواني
};

// التحقق من صلاحية الحساب
userSchema.methods.isAccountActive = function() {
  return this.isActive && !this.isLocked();
};

// ==== Static Methods ====

// البحث عن مستخدم بالبريد الإلكتروني مع التحقق من النشاط
userSchema.statics.findActiveByEmail = async function(email) {
  return await this.findOne({ 
    email: normalizeEmail(email),
    isActive: true,
    deletedAt: null
  });
};

// البحث عن مستخدم بكود الاستعادة الصالح
userSchema.statics.findByValidResetCode = async function(code) {
  return await this.findOne({
    resetPasswordCode: code,
    resetPasswordExpires: { $gt: Date.now() },
    deletedAt: null
  });
};

// استعادة مستخدم محذوف (Soft delete)
userSchema.statics.restore = async function(userId) {
  return await this.findByIdAndUpdate(userId, { deletedAt: null }, { returnDocument: 'after' });
};

// إلغاء جميع أكواد الاستعادة القديمة
userSchema.statics.cleanupExpiredCodes = async function() {
  return await this.updateMany(
    {
      resetPasswordExpires: { $lt: Date.now() }
    },
    {
      $set: {
        resetPasswordCode: null,
        resetPasswordExpires: null
      }
    }
  );
};

userSchema.index({ roles: 1, isActive: 1 });
userSchema.index({ batch: 1 });

module.exports = mongoose.model("User", userSchema);
