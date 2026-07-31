const router = require("express").Router();
const User = require("../models/User");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");
const { success, fail, serverError } = require("../utils/response");
const normalizeEmail = require("../utils/normalizeEmail");

// إنشاء مستخدم جديد (للعميد فقط)
router.post("/", authMiddleware, roleMiddleware("dean", "admin"), async (req, res) => {
  try {
    const { name, email, password, roles } = req.body;

    // التحقق من البيانات
    if (!name || !email || !password || !roles) {
      return res.status(400).json({
        success: false,
        message: "جميع الحقول مطلوبة"
      });
    }

    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل"
      });
    }

    // التحقق من أن الأدوار صحيحة (roles قد تصل نصاً مفرداً وليس مصفوفة)
    const validRoles = ["student", "leader", "doctor", "dean"];
    const rolesArr = Array.isArray(roles) ? roles : [roles];
    const invalidRoles = rolesArr.filter(role => !validRoles.includes(role));

    if (invalidRoles.length > 0) {
      return res.status(400).json({
        success: false,
        message: `أدوار غير صحيحة: ${invalidRoles.join(", ")}`
      });
    }

    // التحقق من عدم وجود مستخدم بنفس البريد (شامل المحذوفين soft-delete)
    const existingUser = await User.collection.findOne({ email: normalizeEmail(email) });
    
    if (existingUser) {
      // إذا كان المستخدم محذوفاً (soft-deleted) نعيد تفعيله ببيانات جديدة
      if (existingUser.deletedAt !== null && existingUser.deletedAt !== undefined) {
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 12);
        await User.collection.updateOne(
          { _id: existingUser._id },
          { $set: {
            name: name.trim(),
            password: hashedPassword,
            roles: rolesArr,
            firstLogin: true,
            isActive: true,
            deletedAt: null,
            failedLoginAttempts: 0,
            lockUntil: null,
            batch: req.body.batch || null,
            batches: Array.isArray(req.body.batches) ? req.body.batches : [],
            updatedAt: new Date()
          }}
        );
        const restoredUser = await User.findById(existingUser._id).select('-password').lean();
        return res.status(201).json({
          success: true,
          message: "تم استعادة المستخدم وتفعيله بنجاح",
          user: restoredUser
        });
      }
      // مستخدم نشط بنفس البريد
      return res.status(400).json({
        success: false,
        message: "البريد الإلكتروني مسجل مسبقاً"
      });
    }

    // إنشاء المستخدم الجديد
    const user = new User({
      name: name.trim(),
      email: normalizeEmail(email),
      password: password, // سيتم تشفيرها تلقائياً في middleware
      roles: rolesArr,
      firstLogin: true, // إجبار تغيير كلمة السر عند أول دخول
      isActive: true,
      batch: req.body.batch || null,
      batches: Array.isArray(req.body.batches) ? req.body.batches : []
    });

    await user.save();

    // إرجاع بيانات المستخدم بدون كلمة السر
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({
      success: true,
      message: "تم إنشاء المستخدم بنجاح",
      user: userResponse
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل مسبقاً' });
    }
    console.error("Create user error:", error.message);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});

// جلب جميع الدكاترة (متاح للعمداء والدكاترة)
router.get("/doctors", authMiddleware, roleMiddleware("dean", "doctor"), async (req, res) => {
  try {
    const doctors = await User.find({ roles: "doctor", isActive: true, deletedAt: null })
      .select("name email")
      .sort({ name: 1 });
    
    res.json({
      success: true,
      doctors
    });
  } catch (error) {
    console.error("Fetch doctors error:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم أثناء جلب قائمة الدكاترة"
    });
  }
});

// طلب المستخدم حذف حسابه (Account Deletion)
router.post("/request-deletion", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "مستخدم غير موجود" });

    // تعطيل الحساب مبدئياً لحين مراجعته أو حذفه بشكل كامل لاحقاً (soft delete)
    user.isActive = false;
    user.deletedAt = new Date();
    await user.save();

    res.json({ success: true, message: "تم إرسال طلب حذف الحساب بنجاح" });
  } catch (error) {
    console.error("Delete request error:", error);
    res.status(500).json({ success: false, message: "خطأ في السيرفر" });
  }
});

// ==========================================
// إدارة طلبات التسجيل المعلقة (للعميد والمشرف والليدر)
// ==========================================

// 1. جلب قائمة الطلبات المعلقة
router.get("/pending-registrations", authMiddleware, roleMiddleware("dean", "admin", "leader"), async (req, res) => {
  try {
    const pendingUsers = await User.find({ isPendingRegistration: true })
      .populate("batch", "name code")
      .select("name email phone batch createdAt")
      .sort({ createdAt: -1 })
      .lean();
    return success(res, { pendingUsers }, "تم جلب طلبات التسجيل المعلقة بنجاح");
  } catch (err) {
    return serverError(res, err, "جلب طلبات التسجيل المعلقة");
  }
});

// 2. قبول طلبات التسجيل (فردي أو جماعي)
router.post("/approve-registrations", authMiddleware, roleMiddleware("dean", "admin", "leader"), async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || !userIds.length) {
      return fail(res, "يرجى تحديد مستخدم واحد على الأقل للقبول");
    }

    const result = await User.updateMany(
      { _id: { $in: userIds }, isPendingRegistration: true },
      { $set: { isActive: true, isPendingRegistration: false } }
    );

    return success(res, { modifiedCount: result.modifiedCount }, `تم قبول ${result.modifiedCount} طالب بنجاح`);
  } catch (err) {
    return serverError(res, err, "قبول طلبات التسجيل");
  }
});

// 3. رفض طلبات التسجيل (فردي أو جماعي)
router.post("/reject-registrations", authMiddleware, roleMiddleware("dean", "admin", "leader"), async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || !userIds.length) {
      return fail(res, "يرجى تحديد مستخدم واحد على الأقل للرفض");
    }

    const result = await User.deleteMany({ _id: { $in: userIds }, isPendingRegistration: true });
    return success(res, { deletedCount: result.deletedCount }, `تم رفض وحذف ${result.deletedCount} طالب بنجاح`);
  } catch (err) {
    return serverError(res, err, "رفض طلبات التسجيل");
  }
});

// جلب جميع المستخدمين (للعميد فقط) — مع Pagination
// router.get("/", authMiddleware, roleMiddleware("dean", "admin"), async (req, res) => {
router.get("/", authMiddleware, roleMiddleware("dean", "admin"), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 500));
    const skip = (page - 1) * limit;

    const filter = { isPendingRegistration: { $ne: true } };
    if (req.query.roles) {
      const requestedRoles = req.query.roles.split(',');
      if (requestedRoles.includes('student') && !requestedRoles.includes('leader')) {
        requestedRoles.push('leader'); // Leaders are also students
      }
      filter.roles = { $in: requestedRoles };
    }

    if (req.query.batch) {
      filter.$or = [
        { batch: req.query.batch },
        { batches: req.query.batch }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("-password -resetPasswordCode")
        .populate("batch", "name code")
        .populate("batches", "name code")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter)
    ]);

    res.json({
      success: true,
      count: users.length,
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: page * limit < total
      }
    });
  } catch (error) {
    serverError(res, error, "جلب المستخدمين");
  }
});

// جلب مستخدم محدد (للعميد فقط)
router.get("/:id", authMiddleware, roleMiddleware("dean", "admin"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password -resetPasswordCode");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود"
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});

// تحديث مستخدم (للعميد فقط)
router.put("/:id", authMiddleware, roleMiddleware("dean", "admin"), async (req, res) => {
  try {
    const { name, email, roles, isActive } = req.body;

    // التحقق من وجود المستخدم
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود"
      });
    }

    // التحقق من عدم تكرار البريد الإلكتروني
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ 
        email: normalizeEmail(email),
        _id: { $ne: req.params.id }
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "البريد الإلكتروني مسجل لمستخدم آخر"
        });
      }
    }

    // تحديث البيانات
    const updateData = {};
    
    if (name) updateData.name = name.trim();
    if (email) updateData.email = normalizeEmail(email);
    if (roles) {
      const validRoles = ["student", "leader", "doctor", "dean", "admin"];
      const rolesArr = Array.isArray(roles) ? roles : [roles];
      const invalidRoles = rolesArr.filter(role => !validRoles.includes(role));
      
      if (invalidRoles.length > 0) {
        return res.status(400).json({
          success: false,
          message: `أدوار غير صحيحة: ${invalidRoles.join(", ")}`
        });
      }
      
      updateData.roles = rolesArr;
    }
    
    if (isActive !== undefined) updateData.isActive = isActive;
    if (req.body.batch !== undefined) updateData.batch = req.body.batch || null;
    if (req.body.batches !== undefined) updateData.batches = Array.isArray(req.body.batches) ? req.body.batches : [];

    // تنفيذ التحديث
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { returnDocument: 'after', runValidators: true }
    ).select("-password -resetPasswordCode");

    res.json({
      success: true,
      message: "تم تحديث المستخدم بنجاح",
      user: updatedUser
    });

  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});

// إعادة تعيين كلمة مرور مستخدم (للعميد فقط)
router.post("/:id/reset-password", authMiddleware, roleMiddleware("dean", "admin"), async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور الجديدة مطلوبة"
      });
    }

    // التحقق من قوة كلمة المرور
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل"
      });
    }

    // البحث عن المستخدم
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود"
      });
    }

    // تحديث كلمة المرور
    user.password = newPassword;
    user.firstLogin = true; // إجبار تغيير كلمة السر عند أول دخول
    await user.save();

    res.json({
      success: true,
      message: "تم إعادة تعيين كلمة المرور بنجاح"
    });

  } catch (error) {
    console.error("Reset user password error:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});

// حذف مستخدم (Soft Delete للحفاظ على سلامة البيانات)
router.delete("/:id", authMiddleware, roleMiddleware("dean", "admin"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود"
      });
    }

    // لا يمكن حذف العميد الرئيسي
    if ((user.roles.includes("dean") || user.roles.includes("admin")) && user.email === "admin@university.edu") {
      return res.status(403).json({
        success: false,
        message: "لا يمكن حذف حساب العميد الرئيسي"
      });
    }

    // Soft delete بدلاً من deleteOne() للحفاظ على سلامة البيانات
    await User.findByIdAndUpdate(req.params.id, { deletedAt: new Date(), isActive: false });

    res.json({
      success: true,
      message: "تم حذف المستخدم بنجاح"
    });

  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم"
    });
  }
});


// تسجيل FCM Token للإشعارات
router.post('/fcm-token', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return fail(res, 'يجب توفير التوكن');
    await User.findByIdAndUpdate(req.user.id, { $addToSet: { fcmTokens: token } });
    return success(res, null, 'تم حفظ التوكن بنجاح');
  } catch (err) {
    return serverError(res, err, 'FCM token');
  }
});

module.exports = router;

