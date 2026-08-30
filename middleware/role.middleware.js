module.exports = (...allowedRoles) => {
  // الاستدعاء الصحيح متغيّر الوسائط: role('admin','dean').
  // لكن تمرير مصفوفة role(['admin','dean']) كان ينتج [['admin','dean']]
  // فيفشل التطابق ويُحجب المسار عن الجميع بلا أي أثر في السجل —
  // لذلك نبسّط المصفوفات المتداخلة بدل الاعتماد على شكل الاستدعاء.
  allowedRoles = allowedRoles.flat(Infinity).filter(Boolean);

  return (req, res, next) => {
    // التحقق من وجود معلومات المستخدم
    if (!req.user || !req.user.roles) {
      return res.status(401).json({
        success: false,
        message: "المستخدم غير مصدق، يرجى تسجيل الدخول"
      });
    }

    const userRoles = req.user.roles;
    
    // التحقق مما إذا كانت صلاحيات المستخدم تحتوي على أي من الأدوار المسموح بها
    const hasPermission = allowedRoles.some(role =>
      userRoles.includes(role)
    );

    // إذا لم يكن للمستخدم أي من الأدوار المسموح بها، قم برفض الوصول
    if (!hasPermission) {
      // تسجيل محاولة الوصول غير المصرح بها (فقط في وضع التطوير)
      if (process.env.NODE_ENV === 'development') {
        console.log("محاولة وصول غير مصرح بها:", {
          userId: req.user.id,
          userRoles: userRoles,
          allowedRoles: allowedRoles,
          path: req.path,
          method: req.method
        });
      }
      
      return res.status(403).json({
        success: false,
        message: "ليس لديك صلاحية للوصول إلى هذا المورد"
        // ✅ لا نُرسل userRoles أو requiredRoles — معلومات حساسة
      });
    }

    next(); // المتابعة في المسار إذا كان لدى المستخدم الصلاحيات
  };
};
