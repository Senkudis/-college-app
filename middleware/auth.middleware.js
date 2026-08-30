const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async (req, res, next) => {
  let token;

  // 1. التحقق أولاً من Authorization header (الأولوية)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }
  /* 2. لا نقرأ توكن الوصول من الكوكيز: الكوكي الوحيدة التي يضعها الخادم
     هي refreshToken الموقّعة بـ REFRESH_SECRET، وقراءتها هنا والتحقق منها
     بـ JWT_SECRET كانت تفشل دائماً بـ "التوقيع غير صحيح" فتطرد المستخدم.
     التجديد مسؤولية /api/auth/refresh وحده. */
  /* 3. التحقق من query parameter — للموارد التي يفتحها المتصفح بنفسه
     (<img src> و<a href> والفيديو) فلا يستطيع إرسال ترويسة Authorization.
     مقصور على هذه المسارات: التوكن في الرابط يتسرّب إلى السجلات وسجل
     التصفح، فلا يُقبل في مسارات الـ API العادية. */
  else if (req.query && req.query.token &&
           (req.baseUrl === '/api/videos' || req.baseUrl.startsWith('/uploads/'))) {
    token = req.query.token;
  }
  // 4. التحقق من body (نادر الاستخدام)

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "التوكن مطلوب للوصول إلى هذا المورد",
      hint: "يرجى تسجيل الدخول أولاً"
    });
  }

  try {
    // تنظيف التوكن من الأحرف الزائدة (بيانات خاطئة قد تصل)
    token = token.trim();
    
    // التحقق من أن التوكن ليس فارغاً بعد التنظيف
    if (!token || token === "null" || token === "undefined" || token === "Bearer") {
      return res.status(401).json({
        success: false,
        message: "توكن غير صالح أو فارغ",
        action: "يرجى تسجيل الدخول مرة أخرى"
      });
    }

    // التحقق من التوكن
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET,
      { ignoreExpiration: false } // إلغاء هذه السمة إذا كنت تريد التحقق من الصلاحية
    );

    // إضافة معلومات المستخدم إلى request
    const userId = decoded.id || decoded._id || decoded.userId || decoded.user?.id;
    
    // تأكيد أن userId موجود (ضروري للاستعلامات اللاحقة)
    if (!userId) {
      console.error("تحذير: التوكن لا يحتوي على معرف المستخدم:", decoded);
      return res.status(401).json({
        success: false,
        message: "توكن غير مكتمل",
        action: "يرجى تسجيل الدخول مرة أخرى"
      });
    }

    // تحميل بيانات المستخدم الحالية من قاعدة البيانات (للتحقق من الجلسة والنشاط)
    // .lean() لإرجاع كائن JavaScript عادي وتحسين الأداء
    /* "batches" كان مفقوداً من select بينما يُسند أدناه إلى req.user.batches —
       فالنتيجة [] أبداً، وهو فخّ صامت لأول مسار يعتمد عليه ظانّاً أنه معبّأ. */
    const user = await User.findById(userId)
      .select("currentSessionId isActive roles name email firstLogin batch batches")
      .lean();
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "الحساب غير موجود",
        action: "يرجى إنشاء حساب جديد"
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "الحساب موقوف. يرجى التواصل مع الإدارة.",
        code: "ACCOUNT_INACTIVE"
      });
    }

    // نتحقق من تطابق رقم الجلسة الموجود في التوكن مع ما هو في قاعدة البيانات
    if (user.currentSessionId && decoded.sessionId !== user.currentSessionId) {
      return res.status(401).json({
        success: false,
        message: "تم تسجيل الدخول من جهاز آخر. تم إنهاء جلستك الحالية.",
        action: "يرجى تسجيل الدخول مرة أخرى",
        code: "SESSION_EXPIRED"
      });
    }

    req.user = {
      id: userId,
      email: user.email,
      roles: user.roles || [],
      name: user.name,
      firstLogin: user.firstLogin || false,
      batch: user.batch,
      batches: user.batches || []
    };

    /* إجبار تغيير كلمة المرور كان في المتصفح وحده: صفحة تُعيد التوجيه
       يتخطّاها أي عميل يخاطب الـAPI مباشرة. وكل حساب يبدأ بكلمة معروفة
       ("123456" في التسجيل العام، وكذلك بعد إعادة التعيين) — فمن يعرف بريد
       طالب لم يغيّر كلمته كان يحصل على توكن كامل الصلاحيات سبعة أيام.
       نمنع هنا كل شيء عدا ما يلزم لإتمام التغيير أو الخروج. */
    if (req.user.firstLogin) {
      const path = `${req.baseUrl || ''}${req.path || ''}`;
      const allowedWhilePending = [
        '/api/auth/force-change-password',
        '/api/auth/change-password',
        '/api/auth/logout',
        '/api/auth/refresh',
        '/api/verify-token' // تعتمد عليه الواجهة للتحقق من الجلسة قبل التوجيه
      ];
      if (!allowedWhilePending.some(p => path.startsWith(p))) {
        return res.status(403).json({
          success: false,
          message: "يجب تغيير كلمة المرور قبل استخدام النظام",
          action: "يرجى تعيين كلمة مرور جديدة",
          code: "PASSWORD_CHANGE_REQUIRED"
        });
      }
    }

    next();
  } catch (err) {
    if (err.name !== "TokenExpiredError") {
      console.warn("تفاصيل التوكن غير الصالح:", {
        error: err.message,
        tokenLength: token ? token.length : 0,
        tokenPreview: token ? token.substring(0, 20) + "..." : "لا يوجد"
      });
    }

    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "انتهت صلاحية الجلسة",
        action: "يرجى تسجيل الدخول مرة أخرى",
        code: "TOKEN_EXPIRED"
      });
    }

    if (err.name === "JsonWebTokenError") {
      // تفاصيل أكثر عن سبب الخطأ
      let detailedMessage = "توكن غير صالح";
      
      if (err.message.includes("invalid signature")) {
        detailedMessage = "التوقيع غير صحيح - قد يكون السري مختلفاً";
      } else if (err.message.includes("jwt malformed")) {
        detailedMessage = "هيكل التوكن غير صحيح - قد يكون التوكن تالفاً";
      } else if (err.message.includes("Unexpected token")) {
        detailedMessage = "التوكن يحتوي على أحرف غير صالحة";
      }

      return res.status(401).json({
        success: false,
        message: detailedMessage,
        action: "يرجى تسجيل الخروج وإعادة تسجيل الدخول",
        code: "INVALID_TOKEN"
      });
    }

    /* تعذّر الوصول لقاعدة البيانات ليس خطأ مصادقة.
       كان هذا الفرع يبتلع أعطال القاعدة تحت رسالة "حدث خطأ غير متوقع في
       المصادقة"، فيظهر للمستخدم كخطأ عشوائي في أي صفحة يعمل فيها (حفظ خبر
       مثلاً) بينما السبب الحقيقي انقطاع الاتصال بـ MongoDB. نفصلها بـ 503
       ورسالة صريحة، ونسجّل التفاصيل كاملة للتشخيص. */
    const isDbFailure =
      err.name === 'MongooseError' ||
      err.name === 'MongoNetworkError' ||
      err.name === 'MongoServerSelectionError' ||
      /buffering timed out|failed to connect|topology|ECONNREFUSED|ETIMEDOUT/i.test(err.message || '');

    if (isDbFailure) {
      console.error('[AUTH] تعذّر الوصول لقاعدة البيانات:', err.message);
      return res.status(503).json({
        success: false,
        message: "الخدمة غير متاحة مؤقتاً — تعذّر الاتصال بقاعدة البيانات",
        action: "يرجى المحاولة بعد قليل",
        code: "DB_UNAVAILABLE"
      });
    }

    // خطأ غير متوقع فعلاً
    console.error('[AUTH] خطأ غير متوقع:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ غير متوقع في المصادقة",
      action: "يرجى المحاولة مرة أخرى أو التواصل مع الدعم",
      code: "AUTH_ERROR"
    });
  }
};
