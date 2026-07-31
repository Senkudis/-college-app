const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async (req, res, next) => {
  let token;

  // 1. التحقق أولاً من Authorization header (الأولوية)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }
  // 2. التحقق من الكوكيز (إذا لم يوجد في header)
  else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }
  // 3. التحقق من query parameter (للتطبيقات الخاصة)
  else if (req.baseUrl === '/api/videos' && req.query && req.query.token) {
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
    const user = await User.findById(userId).select("currentSessionId isActive roles name email firstLogin batch").lean();
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
      batch: user.batch
    };

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

    // خطأ غير متوقع
    return res.status(500).json({
      success: false,
      message: "حدث خطأ غير متوقع في المصادقة",
      action: "يرجى المحاولة مرة أخرى أو التواصل مع الدعم",
      code: "AUTH_ERROR"
    });
  }
};
