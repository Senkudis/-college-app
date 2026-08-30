const router = require("express").Router();
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const crypto = require("crypto");
const { requiredFields, validEmail, minLength } = require("../middleware/validate.middleware");
const { success, fail, serverError } = require("../utils/response");
const normalizeEmail = require("../utils/normalizeEmail");
const { authLimiter: loginLimiter, passwordResetLimiter: forgotPasswordLimiter } = require("../middleware/rateLimiter");
const { sendResetCodeEmail } = require("../utils/emailService");
const { logActivity } = require("../utils/activityLogger");

// إعدادات JWT
const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;

if (!JWT_SECRET || !REFRESH_SECRET) {
  console.error(" JWT_SECRET و REFRESH_SECRET مطلوبان في متغيرات البيئة");
  process.exit(1);
}

// ========== تسجيل مستخدم جديد (للعميد فقط) ==========
router.post("/register",
  auth,
  role("dean", "admin"),
  requiredFields("name", "email", "password", "roles"),
  minLength("password", 6, "كلمة المرور"),
  async (req, res) => {
  try {
    const { name, email, password, roles, batches } = req.body;

    // sanitize batch — reject string 'null'
    const batch = (req.body.batch && req.body.batch !== 'null' && req.body.batch !== '') 
      ? req.body.batch : null;

    /* "admin" كان مفقوداً هنا بينما يقبله PUT /api/users/:id — مساران
       لنفس العملية بقائمتين مختلفتين، فيتعذّر إنشاء مسؤول عبر هذا المسار
       ثم يُمنح الدور نفسه عبر التعديل. */
    const validRoles = ["student", "leader", "doctor", "dean", "admin"];
    const invalidRoles = (Array.isArray(roles) ? roles : [roles]).filter(r => !validRoles.includes(r));
    if (invalidRoles.length) {
      return fail(res, `أدوار غير صحيحة: ${invalidRoles.join('، ')}`);
    }

    // التحقق من وجود دفعة للطالب والليدر
    const userRoles = Array.isArray(roles) ? roles : [roles];
    if (userRoles.includes("student") || userRoles.includes("leader")) {
      if (!batch) {
        return fail(res, "الدفعة مطلوبة للطالب والليدر");
      }
      const Batch = require("../models/Batch");
      const batchDoc = await Batch.findById(batch);
      if (!batchDoc) {
        return fail(res, "الدفعة المحددة غير موجودة");
      }
    }

    // التحقق من عدم تكرار البريد (شامل المحذوفين soft-delete)
    const existingUser = await User.collection.findOne({ email: normalizeEmail(email) });
    if (existingUser) {
      // مستخدم محذوف (soft-deleted) → نعيد تفعيله ببيانات جديدة
      if (existingUser.deletedAt !== null && existingUser.deletedAt !== undefined) {
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 12);
        const restoredData = {
          name: name.trim(),
          password: hashedPassword,
          roles: userRoles,
          firstLogin: true,
          isActive: true,
          deletedAt: null,
          failedLoginAttempts: 0,
          lockUntil: null,
          updatedAt: new Date()
        };
        if (batch && (userRoles.includes('student') || userRoles.includes('leader'))) restoredData.batch = batch;
        if (userRoles.includes('doctor') && Array.isArray(batches) && batches.length) restoredData.batches = batches;
        await User.collection.updateOne({ _id: existingUser._id }, { $set: restoredData });
        const restoredUser = await User.findById(existingUser._id).select('-password').lean();
        return success(res, { user: restoredUser }, 'تم استعادة المستخدم وتفعيله بنجاح', 201);
      }
      // مستخدم نشط بنفس البريد → رفض الإضافة
      return fail(res, 'البريد الإلكتروني مسجل مسبقاً');
    }

    // إنشاء المستخدم الجديد
    const userData = {
      name: name.trim(),
      email: normalizeEmail(email),
      password,
      roles: userRoles,
      firstLogin: true,
      isActive: true
    };

    // إضافة الدفعة للطالب والليدر
    if (batch && (userRoles.includes("student") || userRoles.includes("leader"))) {
      userData.batch = batch;
    }

    // إضافة الدفعات للدكتور إذا أُرسلت
    if (userRoles.includes("doctor") && Array.isArray(batches) && batches.length) {
      userData.batches = batches;
    }

    const user = await User.create(userData);

    const userResponse = user.toObject();
    delete userResponse.password;

    success(res, { user: userResponse }, "تم إنشاء المستخدم بنجاح", 201);
  } catch (err) {
    if (err.code === 11000) {
      return fail(res, 'البريد الإلكتروني مسجل مسبقاً');
    }
    console.error("[register error]", err.name, err.message);
    serverError(res, err, "تسجيل مستخدم");
  }
});


// ========== تسجيل طالب جديد عبر الكود الخاص (عام) ==========
router.post("/register-public",
  requiredFields("name", "email", "inviteCode"),
  async (req, res) => {
    try {
      const { name, email, phone, password, inviteCode } = req.body;
      const Setting = require("../models/Setting");
      const Batch = require("../models/Batch");

      const cleanCode = String(inviteCode).trim();
      let targetBatchId = null;

      /* 1. البحث عن دفعة طابقت كود الدعوة الخاص بها أو رمز الدفعة (code).
         الكود مطابقة نصية دقيقة لا نمطية: حقنه في RegExp كان يسمح بإرسال
         ".*" فيطابق كل دفعة ويلتقط أولها — أي تجاوز حاجز التسجيل بالكامل،
         ويفتح الباب لتعطيل الخدمة بنمط انفجاري مثل (a+)+$. */
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exactCode = new RegExp(`^${escapeRegex(cleanCode)}$`, 'i');
      const matchedBatch = await Batch.findOne({
        $or: [
          { inviteCode: exactCode },
          { code: exactCode }
        ],
        status: { $ne: "archived" }
      });

      if (matchedBatch) {
        targetBatchId = matchedBatch._id;
      } else {
        // Fallback: التحقق من الكود العام للشفرة وتأمين الدفعة المرسلة بديلة
        const inviteSetting = await Setting.findOne({ key: "registrationInviteCode" });
        const validGlobalCode = inviteSetting ? String(inviteSetting.value).trim() : "CBS2026";
        if (cleanCode.toUpperCase() === validGlobalCode.toUpperCase() && req.body.batch) {
          const bDoc = await Batch.findById(req.body.batch);
          if (bDoc) targetBatchId = bDoc._id;
        }
      }

      if (!targetBatchId) {
        return fail(res, "كود الدعوة غير صحيح أو لا ينتمي لأي دفعة أكاديمية نشطة");
      }

      // 2. التحقق من عدم تكرار البريد الإلكتروني
      const existingUser = await User.collection.findOne({ email: normalizeEmail(email) });
      if (existingUser) {
        return fail(res, "البريد الإلكتروني مسجل مسبقاً");
      }

      // 3. إنشاء طلب التسجيل (حساب معلق مع كلمة مرور أولية 123456 و firstLogin = true)
      const user = await User.create({
        name: name.trim(),
        email: normalizeEmail(email),
        phone: phone ? phone.trim() : "",
        /* كلمة مرور أولية عشوائية بدل "123456" الثابتة: تلك جعلت كل حساب
           جديد قابلاً للاختراق بمعرفة البريد وحده حتى يغيّرها صاحبه. */
        password: (password && String(password).trim())
          ? String(password).trim()
          : crypto.randomBytes(9).toString("base64url"),
        roles: ["student"],
        batch: targetBatchId,
        isPendingRegistration: true,
        isActive: false,
        firstLogin: true // إجبار الطالب على تغيير كلمة المرور عند أول تسجيل دخول
      });

      success(res, { userId: user._id, batchId: targetBatchId }, "تم تقديم طلب التسجيل بنجاح! حسابك قيد المراجعة والموافقة من الإدارة", 201);
    } catch (err) {
      if (err.code === 11000) {
        return fail(res, "البريد الإلكتروني مسجل مسبقاً");
      }
      console.error("[register-public error]", err);
      serverError(res, err, "تسجيل طالب جديد");
    }
  }
);

// ========== تسجيل الدخول ==========
router.post("/login",
  loginLimiter,
  requiredFields("email", "password"),
  validEmail(),
  async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: normalizeEmail(email) });

    if (!user) {
      return fail(res, "بيانات الدخول غير صحيحة", 401);
    }

    if (!user.isActive) {
      if (user.isPendingRegistration) {
        return fail(res, "حسابك قيد المراجعة والموافقة من إدارة الكلية", 403);
      }
      return fail(res, "الحساب غير نشط، يرجى التواصل مع الإدارة", 403);
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return fail(res, "بيانات الدخول غير صحيحة", 401);
    }

    const sessionId = crypto.randomUUID();
    user.currentSessionId = sessionId;
    user.lastLogin = new Date(); // تحديث تاريخ آخر دخول
    await user.save();

    const payload = {
      id: user._id,
      email: user.email,
      roles: user.roles,
      name: user.name,
      firstLogin: user.firstLogin,
      sessionId
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
    const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: "30d" });

    // تسجيل نشاط تسجيل الدخول وتحديث ستريك كيدي
    logActivity(user._id, "USER_LOGIN", { ip: req.ip, userAgent: req.headers["user-agent"] }, user.batch);
    try {
      const { recordActivity } = require("../services/kedySmartNotification.service");
      recordActivity(user._id);
    } catch(e) {}

    /* الكوكي تحمل توكن التجديد لا توكن الوصول — وكانت تُسمّى "token" فيقرأها
       auth.middleware ويتحقق منها بـ JWT_SECRET بينما هي موقّعة بـ
       REFRESH_SECRET، فتفشل دائماً بـ "التوقيع غير صحيح". الاسم الصريح
       يمنع الالتباس، ويقرأها /auth/refresh وحده. */
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 أيام
    });

    res.json({
      success: true,
      message: "تم تسجيل الدخول بنجاح",
      token,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        firstLogin: user.firstLogin
      }
    });
  } catch (err) {
    serverError(res, err, "تسجيل دخول");
  }
});

// ========== تجديد التوكن (Refresh Token) ==========
router.post("/refresh", async (req, res) => {
  // نبحث عن التوكن في الكوكيز أو الهيدر أو البودي
  let refreshToken = req.cookies?.refreshToken || req.headers["x-refresh-token"] || req.body?.refreshToken;
  if (!refreshToken && req.headers.authorization?.startsWith("Bearer ")) {
    refreshToken = req.headers.authorization.split(" ")[1];
  }

  if (!refreshToken) {
    return res.status(401).json({ success: false, message: "غير مصرح" });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);

    //  التحقق من أن الجلسة لا تزال صالحة في قاعدة البيانات
    const user = await User.findById(decoded.id).select("currentSessionId isActive").lean();
    if (!user) {
      return res.status(401).json({ success: false, message: "الحساب غير موجود" });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: "الحساب موقوف" });
    }
    if (user.currentSessionId && decoded.sessionId !== user.currentSessionId) {
      return res.status(401).json({
        success: false,
        message: "تم تسجيل الدخول من جهاز آخر. يرجى تسجيل الدخول مجدداً.",
        code: "SESSION_EXPIRED"
      });
    }

    const payload = {
      id: decoded.id,
      email: decoded.email,
      roles: decoded.roles,
      name: decoded.name,
      firstLogin: decoded.firstLogin,
      sessionId: decoded.sessionId
    };
    const newToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
    res.json({ success: true, accessToken: newToken, refreshToken });
  } catch (err) {
    res.status(401).json({ success: false, message: "جلسة منتهية، يرجى تسجيل الدخول مجدداً" });
  }
});

// ========== طلب إعادة تعيين كلمة المرور ==========
router.post(["/forgot-password", "/resend-reset-code"], forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "البريد الإلكتروني مطلوب"
      });
    }

    // البحث عن المستخدم
    const user = await User.findOne({ email: normalizeEmail(email) });

    // لأسباب أمنية، نعطي نفس الرسالة
    if (!user) {
      return res.json({
        success: true,
        message: "إذا كان البريد الإلكتروني مسجل لدينا، ستصلك رسالة بالتعليمات خلال دقائق"
      });
    }

    // التحقق من حالة الحساب
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "الحساب غير نشط"
      });
    }

    // إنشاء كود جديد (6 أرقام)
    const resetCode = crypto.randomInt(100000, 999999).toString();
    user.resetPasswordCode = resetCode;
    user.resetPasswordExpires = new Date(Date.now() + 20 * 60 * 1000); // 20 دقيقة
    
    await user.save();

    // إرسال كود إعادة التعيين عبر البريد الإلكتروني
    sendResetCodeEmail(user, resetCode).catch(err => 
      console.error("خطأ في إرسال بريد إعادة التعيين:", err.message)
    );

    res.json({
      success: true,
      message: "تم إرسال كود إعادة التعيين إلى بريدك الإلكتروني",
      email: user.email
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});

// ========== التحقق من كود إعادة التعيين ==========
router.post("/verify-reset-code", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "البريد الإلكتروني والكود مطلوبان"
      });
    }

    // البحث عن المستخدم
    const user = await User.findOne({ email: normalizeEmail(email) });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود"
      });
    }

    // التحقق من صحة الكود
    if (!user.resetPasswordCode || 
        user.resetPasswordCode !== code || 
        new Date() > user.resetPasswordExpires) {
      return res.status(400).json({
        success: false,
        message: "الكود غير صالح أو منتهي الصلاحية"
      });
    }

    // إنشاء توكن مؤقت (بدون كشف البريد الفعلي)
    const tempToken = jwt.sign(
      { 
        id: user._id,
        purpose: "password_reset",
        resetCode: code
      },
      JWT_SECRET,
      { expiresIn: "10m" }
    );

    res.json({
      success: true,
      message: "الكود صحيح",
      tempToken
      // لا نكشف البريد لأسباب أمنية (user enumeration)
    });
  } catch (err) {
    console.error("Verify code error:", err);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});

// ========== إعادة تعيين كلمة المرور بعد التحقق ==========
router.post("/reset-password", async (req, res) => {
  try {
    const { tempToken, newPassword, confirmPassword } = req.body;

    if (!tempToken || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "جميع الحقول مطلوبة"
      });
    }

    // التحقق من تطابق كلمتي المرور
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "كلمتا المرور غير متطابقتين"
      });
    }

    // التحقق من قوة كلمة المرور
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل"
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "رابط إعادة التعيين منتهي الصلاحية أو غير صالح"
      });
    }

    // التحقق من الغرض من التوكن
    if (decoded.purpose !== "password_reset") {
      return res.status(401).json({
        success: false,
        message: "توكن غير صالح"
      });
    }

    // البحث عن المستخدم عبر الـ ID المضمّن في التوكن
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود"
      });
    }

    // التحقق من أن الكود لا يزال صالحاً
    if (!user.resetPasswordCode || 
        user.resetPasswordCode !== decoded.resetCode || 
        new Date() > user.resetPasswordExpires) {
      return res.status(400).json({
        success: false,
        message: "الكود منتهي الصلاحية. يرجى طلب كود جديد"
      });
    }

    // تحديث كلمة المرور - تمرير كنص عادي فقط
    user.password = newPassword; // نص عادي - سيشفر في الـmodel
    user.resetPasswordCode = null;
    user.resetPasswordExpires = null;
    user.firstLogin = false;
    
    await user.save();

    res.json({
      success: true,
      message: "تم إعادة تعيين كلمة المرور بنجاح"
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});

// ========== تغيير كلمة المرور عند أول دخول ==========
router.post("/force-change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "جميع الحقول مطلوبة"
      });
    }

    // التحقق من تطابق كلمتي المرور الجديدتين
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "كلمتا المرور الجديدتين غير متطابقتين"
      });
    }

    // التحقق من قوة كلمة المرور الجديدة
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل"
      });
    }

    // البحث عن المستخدم الحالي
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود"
      });
    }

    // التحقق من أن هذا هو أول دخول
    if (!user.firstLogin) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور تم تغييرها مسبقاً"
      });
    }

    // التحقق من كلمة المرور الحالية باستخدام دالة النموذج
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);

    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "كلمة المرور الحالية غير صحيحة"
      });
    }

    // تحديث كلمة المرور - نص عادي فقط
    user.password = newPassword; // نص عادي - سيشفر في الـmodel
    user.firstLogin = false;
    user.passwordChangedAt = new Date();
    
    await user.save();

    // إنشاء access token قصير الصلاحية (يتجدد بواسطة refresh token)
    const newToken = jwt.sign(
      { 
        id: user._id,
        email: user.email,
        roles: user.roles,
        name: user.name,
        firstLogin: false,
        sessionId: user.currentSessionId
      },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    res.json({
      success: true,
      message: "تم تغيير كلمة المرور بنجاح",
      token: newToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        firstLogin: false
      }
    });
  } catch (err) {
    console.error("Force change password error:", err);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});

// ========== تغيير كلمة المرور العادية ==========
router.post("/change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "جميع الحقول مطلوبة"
      });
    }

    // التحقق من تطابق كلمتي المرور الجديدتين
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "كلمتا المرور الجديدتين غير متطابقتين"
      });
    }

    // التحقق من قوة كلمة المرور الجديدة
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل"
      });
    }

    // البحث عن المستخدم الحالي
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود"
      });
    }

    // التحقق من كلمة المرور الحالية باستخدام دالة النموذج
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);

    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "كلمة المرور الحالية غير صحيحة"
      });
    }

    // تحديث كلمة المرور - نص عادي فقط
    user.password = newPassword; // نص عادي - سيشفر في الـmodel
    user.firstLogin = false;
    user.passwordChangedAt = new Date();
    
    await user.save();

    res.json({
      success: true,
      message: "تم تغيير كلمة المرور بنجاح"
    });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});

// ========== إحصائيات ولوحة الشرف (للداشبورد) ==========
router.get("/stats", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return fail(res, "المستخدم غير موجود", 404);

    let subjects = 0;
    let upcomingAssignments = 0;
    let unreadNotifs = 0;

    // الليدر طالب أيضاً — كان استثناؤه هنا يُظهر له إحصاءات صفرية دائماً
    if (user.roles.includes("student") || user.roles.includes("leader")) {
      const Subject = require("../models/Subject");
      const Assignment = require("../models/Assignment");
      const Notification = require("../models/Notification");

      // المواد التي للطالب (حسب دفعته)
      const student = await User.findById(req.user.id).select("batch batches");
      if (student.batch) {
        subjects = await Subject.countDocuments({ batches: student.batch });
      }

      // الواجبات القادمة
      if (student.batch) {
        upcomingAssignments = await Assignment.countDocuments({ batches: student.batch, dueDate: { $gte: new Date() } });
      }

      // الإشعارات غير المقروءة — نفس منطق الرؤية الموحّد في نموذج الإشعارات
      /* تمرير [] بدل دفعات المستخدم كان يُسقط الإشعارات المقيّدة بدفعة من
         العدّ، فتُظهر شارة اللوحة رقماً أقل مما تعرضه صفحة الإشعارات. */
      unreadNotifs = await Notification.countUnreadForUser(
        req.user.id, user.roles, student.batch, student.batches || []
      );
    }

    success(res, {
      stats: { subjects, upcomingAssignments, unreadNotifs }
    });
  } catch (err) {
    serverError(res, err, "جلب الإحصائيات");
  }
});

router.get("/leaderboard", auth, async (req, res) => {
  try {
    const users = await User.find({ roles: "student" })
      .select("name points batch")
      .sort({ points: -1 })
      .limit(50)
      .populate("batch", "name code");

    success(res, { leaderboard: users });
  } catch (err) {
    serverError(res, err, "جلب لوحة الشرف");
  }
});

module.exports = router;

// ==========================================
// WebAuthn / Passkeys Routes
// ==========================================
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const rpName = 'نظام كلية النصر التقنية';

// 1. Generate Registration Options
router.get("/webauthn/register/generate", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return fail(res, "المستخدم غير موجود", 404);

    const rpID = req.hostname;
    const userPasskeys = user.passkeys || [];

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new Uint8Array(Buffer.from(user.email)),
      userName: user.email,
      attestationType: 'none',
      excludeCredentials: userPasskeys.map(key => ({
        id: key.credentialID,
        type: 'public-key',
        transports: key.transports,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    user.currentChallenge = options.challenge;
    await user.save();

    res.json(options);
  } catch (err) {
    serverError(res, err, "توليد خيارات البصمة");
  }
});

// 2. Verify Registration
router.post("/webauthn/register/verify", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.currentChallenge) return fail(res, "لا يوجد تحدي نشط", 400);

    const rpID = req.hostname;
    const origin = `${req.protocol}://${req.get('host')}`;
    const expectedOrigin = [origin, "http://localhost", "https://localhost", "capacitor://localhost"];
    const expectedChallenge = user.currentChallenge;

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
    });

    const { verified, registrationInfo } = verification;

    if (verified && registrationInfo) {
      // v13 shape: registrationInfo.credential contains id, publicKey, counter
      const credential = registrationInfo.credential;
      const newPasskey = {
        credentialID: credential ? credential.id : registrationInfo.credentialID,
        credentialPublicKey: Buffer.from(credential ? credential.publicKey : registrationInfo.credentialPublicKey),
        counter: credential ? credential.counter : registrationInfo.counter,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: registrationInfo.credentialBackedUp,
        transports: credential && credential.transports ? credential.transports : (req.body.response.transports || [])
      };

      if (!user.passkeys) user.passkeys = [];
      user.passkeys.push(newPasskey);
      user.currentChallenge = null;
      await user.save();

      return success(res, { verified: true }, "تم تسجيل البصمة بنجاح");
    }

    return fail(res, "فشل التحقق من البصمة", 400);
  } catch (err) {
    serverError(res, err, "تأكيد تسجيل البصمة");
  }
});

// 3. Generate Login Options
router.post("/webauthn/login/generate", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return fail(res, "البريد الإلكتروني مطلوب", 400);

    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user || !user.passkeys || user.passkeys.length === 0) {
      return fail(res, "لا توجد بصمات مسجلة لهذا الحساب", 404);
    }
    if (!user.isActive) {
      return fail(res, "الحساب غير نشط، يرجى التواصل مع الإدارة", 403);
    }

    const rpID = req.hostname;
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: user.passkeys.map(key => ({
        id: key.credentialID,
        type: 'public-key',
        transports: key.transports,
      })),
      userVerification: 'preferred',
    });

    user.currentChallenge = options.challenge;
    await user.save();

    res.json(options);
  } catch (err) {
    serverError(res, err, "توليد خيارات الدخول بالبصمة");
  }
});

// 4. Verify Login
router.post("/webauthn/login/verify", async (req, res) => {
  try {
    const { email, response } = req.body;
    const user = await User.findOne({ email: normalizeEmail(email) });

    if (!user || !user.currentChallenge) return fail(res, "فشل التحقق", 400);
    if (!user.isActive) return fail(res, "الحساب غير نشط، يرجى التواصل مع الإدارة", 403);

    const rpID = req.hostname;
    const origin = `${req.protocol}://${req.get('host')}`;
    const expectedOrigin = [origin, "http://localhost", "https://localhost", "capacitor://localhost"];
    const expectedChallenge = user.currentChallenge;

    let dbAuthenticator;
    for (const key of user.passkeys) {
      if (key.credentialID === response.id) {
        dbAuthenticator = key;
        break;
      }
    }

    if (!dbAuthenticator) return fail(res, "مفتاح البصمة غير صالح", 400);

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: dbAuthenticator.credentialID,
        publicKey: new Uint8Array(dbAuthenticator.credentialPublicKey),
        counter: dbAuthenticator.counter,
      },
    });

    const { verified, authenticationInfo } = verification;

    if (verified) {
      dbAuthenticator.counter = authenticationInfo.newCounter;
      const sessionId = crypto.randomUUID();
      user.currentChallenge = null;
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      user.lastLogin = new Date();
      user.currentSessionId = sessionId;
      await user.save();

      //  payload موحد مع تسجيل الدخول العادي
      const payload = {
        id: user.id,
        email: user.email,
        roles: user.roles,
        name: user.name,
        firstLogin: user.firstLogin,
        sessionId
      };

      //  access token قصير (15m) + refresh token طويل في cookie (30d) — متوافق مع /login العادي
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
      const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: "30d" });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 أيام
      });

      return success(res, { token, user: {
        id: user.id, name: user.name, email: user.email, roles: user.roles, firstLogin: user.firstLogin
      }}, "تم تسجيل الدخول بالبصمة بنجاح");
    }

    return fail(res, "فشل التحقق من البصمة", 400);
  } catch (err) {
    serverError(res, err, "تأكيد الدخول بالبصمة");
  }
});
