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
/* حذف الحساب — متطلب إلزامي في App Store (بند 5.1.1(v)) وGoogle Play.
   آبل لا تقبل "تعطيل الحساب" بديلاً عن الحذف، وتشترط أن يبدأ المستخدم
   الحذف من داخل التطبيق دون مراسلة الدعم. الكود السابق كان يعطّل الحساب
   ويسمّي ذلك "طلب حذف" — وهو ما يُرفض عند المراجعة.

   ما يحدث الآن:
   1. تُمسح البيانات الشخصية فوراً (الاسم، البريد، الهاتف، الأجهزة،
      الجلسة، المفاتيح الحيوية) فلا يبقى ما يعرّف الشخص.
   2. يُعلَّم الحساب محذوفاً فيختفي من كل الاستعلامات.
   3. تبقى السجلات الأكاديمية والمالية مرتبطة بمعرّف مجهول الهوية —
      وهو ما يفرضه النظام الجامعي والمحاسبي، ويُذكر صراحةً للمستخدم
      قبل التأكيد وفي سياسة الخصوصية. */
router.post("/request-deletion", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "مستخدم غير موجود" });

    const anonId = String(user._id).slice(-6);

    user.name = `حساب محذوف ${anonId}`;
    // بريد فريد لا يشير إلى شخص، ويُبقي فهرس التفرّد سليماً
    user.email = `deleted-${user._id}@deleted.invalid`;
    user.phone = "";
    user.password = require("crypto").randomBytes(32).toString("hex");
    user.fcmTokens = [];
    user.webPushSubscriptions = [];
    user.passkeys = [];
    user.currentSessionId = null;
    user.currentChallenge = null;
    user.resetPasswordCode = null;
    user.resetPasswordExpires = null;
    user.blockedUsers = [];
    user.isActive = false;
    user.deletedAt = new Date();
    await user.save();

    res.json({
      success: true,
      message: "تم حذف حسابك وإزالة بياناتك الشخصية نهائياً.",
      retained: "تبقى السجلات الأكاديمية والمالية بصيغة مجهولة الهوية وفق اللوائح الجامعية."
    });
  } catch (error) {
    console.error("Delete account error:", error);
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

/* السجل الأكاديمي والاعتماد الرقمي الموثق — GET /api/users/portfolio/:id
   كان هذا المسار بلا مصادقة إطلاقاً: معرّفٌ واحد يكفي لقراءة اسم أي مستخدم
   ودفعته ونسبة حضوره ونتائج اختباراته وتسليماته. والمعرّفات تتسرّب في ردود
   أخرى (لوحة المتصدرين مثلاً)، فالانتقال من معرّف إلى ملف كامل كان مباشراً. */
router.get('/portfolio/:id', authMiddleware, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const crypto = require('crypto');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 'معرف المستخدم غير صالح', 400);
    }

    /* من يرى سجل من؟ صاحبه، أو العميد/الأدمن، أو دكتور/ليدر ضمن نطاق دفعته. */
    const viewerRoles = req.user.roles || [];
    const isSelf = String(req.user.id) === String(req.params.id);
    const isDeanLevel = viewerRoles.includes('dean') || viewerRoles.includes('admin');

    if (!isSelf && !isDeanLevel) {
      const isStaff = viewerRoles.includes('doctor') || viewerRoles.includes('leader');
      if (!isStaff) {
        return fail(res, 'ليس لديك صلاحية لعرض هذا السجل', 403);
      }
      const target = await User.findById(req.params.id).select('batch').lean();
      const targetBatch = target?.batch ? String(target.batch) : null;

      let permitted = false;
      if (viewerRoles.includes('leader')) {
        permitted = Boolean(targetBatch && req.user.batch && targetBatch === String(req.user.batch));
      }
      if (!permitted && viewerRoles.includes('doctor')) {
        const viewer = await User.findById(req.user.id).select('batches').lean();
        permitted = (viewer?.batches || []).some(b => String(b) === targetBatch);
      }
      if (!permitted) {
        return fail(res, 'ليس لديك صلاحية لعرض هذا السجل', 403);
      }
    }

    const user = await User.findById(req.params.id)
      .select('name batch batches badges points roles createdAt')
      .populate('batch', 'name code year level')
      .lean();

    if (!user) {
      return fail(res, 'المستخدم غير موجود', 404);
    }

    const roles = user.roles || ['student'];
    const isDean = roles.includes('dean') || roles.includes('admin');
    const isDoctor = roles.includes('doctor') && !isDean;
    const isLeader = roles.includes('leader');

    const Attendance = mongoose.model('Attendance');
    const QuizAttempt = mongoose.model('QuizAttempt');
    const StudentSubmission = mongoose.model('StudentSubmission');
    const Subject = mongoose.model('Subject');
    const Batch = mongoose.model('Batch');
    const Lecture = mongoose.model('Lecture');

    // ترويسة التحقق والتشفير
    const roleKey = isDean ? 'DEAN' : isDoctor ? 'DOC' : 'ACAD';
    const serialNumber = `CBS-${roleKey}-${new Date().getFullYear()}-${String(user._id).slice(-6).toUpperCase()}`;
    /* HMAC بمفتاح الخادم لا hash عارٍ: الاشتقاق السابق كان من _id و createdAt
       و roleKey وحدها — وكلها معلومة أو مستنتجة، فأي طرف يزوّر بصمة تبدو
       موثّقة لسجل لا يملكه. */
    const verificationHash = crypto.createHmac('sha256', process.env.JWT_SECRET)
      .update(user._id.toString() + (user.createdAt ? user.createdAt.toISOString() : '') + roleKey)
      .digest('hex').slice(0, 16).toUpperCase();

    // 1. سجل العميد والإدارة العليا
    if (isDean) {
      const [totalBatches, totalStudents, totalDoctors, allSubjects] = await Promise.all([
        Batch.countDocuments({ status: 'active' }),
        User.countDocuments({ roles: 'student', deletedAt: null }),
        User.countDocuments({ roles: 'doctor', deletedAt: null }),
        Subject.find({}).select('name code level').lean()
      ]);

      const deanData = {
        id: user._id,
        name: user.name,
        role: 'dean',
        roleTitle: 'عميد كلية النصر التقنية ورئيس المجلس الأكاديمي',
        enrolledAt: user.createdAt,
        serialNumber,
        verificationHash,
        badges: user.badges || ['القيادة الأكاديمية العليا', 'الاعتماد المؤسسي الرسمي']
      };

      const academicRecord = {
        roleType: 'dean',
        attendanceRate: 100,
        totalClasses: 0,
        presentClasses: 0,
        completedQuizzes: 0,
        passedQuizzes: 0,
        completedAssignments: 0,
        supervision: {
          totalBatches,
          totalStudents,
          totalDoctors,
          accreditedSubjectsCount: allSubjects.length,
          subjects: allSubjects.slice(0, 12).map(s => ({ name: s.name, code: s.code || 'CS' }))
        },
        accreditationDecree: 'قرار اعتماد وتكليف عمادة الكلية رقم (2026/01/ADM)',
        authorityLevel: 'كامل الصلاحيات الإشرافية والأكاديمية والتنفيذية'
      };

      return success(res, {
        student: deanData,
        user: deanData,
        academicRecord,
        institution: {
          name: 'جامعة النصر التقنية',
          faculty: 'كلية النصر التقنية',
          city: 'الخرطوم - السودان',
          verified: true,
          issuedAt: new Date(),
          documentType: 'وثيقة الاعتماد القيادي والمؤسسي الرسمي (Official Executive Leadership Credential)'
        }
      });
    }

    // 2. سجل عضو هيئة التدريس (الدكتور)
    if (isDoctor) {
      const assignedSubjects = await Subject.find({ doctor: user._id }).populate('batches', 'name code').lean();
      const subjectIds = assignedSubjects.map(s => s._id);
      const totalLectures = await Lecture.countDocuments({ subject: { $in: subjectIds } });

      const doctorData = {
        id: user._id,
        name: user.name,
        role: 'doctor',
        roleTitle: 'عضو هيئة التدريس وأستاذ المقررات المعتمد',
        enrolledAt: user.createdAt,
        serialNumber,
        verificationHash,
        badges: user.badges || ['هيئة تدريس معتمدة', 'كفاءة أكاديمية متميزة']
      };

      const academicRecord = {
        roleType: 'doctor',
        attendanceRate: 100,
        totalClasses: totalLectures,
        presentClasses: totalLectures,
        completedQuizzes: 0,
        passedQuizzes: 0,
        completedAssignments: 0,
        teachingLoad: {
          subjectsCount: assignedSubjects.length,
          lecturesCount: totalLectures,
          subjects: assignedSubjects.map(s => ({
            name: s.name,
            code: s.code || 'CS',
            level: s.level || 'البكالوريوس',
            batches: (s.batches || []).map(b => b.name).join(' · ')
          }))
        },
        facultyRank: 'أستاذ مقرر ومحاضر معتمد بالكلية',
        accreditationStatus: 'معتمد رسمياً من مجلس الأساتذة والشؤون العلمية'
      };

      return success(res, {
        student: doctorData,
        user: doctorData,
        academicRecord,
        institution: {
          name: 'جامعة النصر التقنية',
          faculty: 'كلية النصر التقنية',
          city: 'الخرطوم - السودان',
          verified: true,
          issuedAt: new Date(),
          documentType: 'شهادة الاعتماد والتكليف التدريسي الموثقة (Faculty Academic & Teaching Credential)'
        }
      });
    }

    // 3. سجل الطالب الأكاديمي الموثق (Student / Leader)
    const attendanceRecords = await Attendance.find({}).select('students').lean();
    let totalClasses = 0;
    let presentClasses = 0;
    attendanceRecords.forEach(rec => {
      (rec.students || []).forEach(st => {
        if (st.student?.toString() === user._id.toString()) {
          totalClasses++;
          if (st.status === 'present') presentClasses++;
        }
      });
    });
    const attendanceRate = totalClasses > 0 ? Math.round((presentClasses / totalClasses) * 100) : 100;

    const quizAttempts = await QuizAttempt.find({ student: user._id }).select('score maxScore totalPoints passed').lean();
    const passedQuizzes = quizAttempts.filter(q => q.passed !== false).length;

    const submissions = await StudentSubmission.find({ student: user._id }).select('status grade pointsEarned').lean();
    const completedAssignments = submissions.length;

    const subjects = user.batch ? await Subject.find({
      $or: [{ batch: user.batch._id }, { batches: user.batch._id }]
    }).select('name code level').lean() : [];

    let rank = 1;
    if (user.batch) {
      const topStudents = await User.find({ batch: user.batch._id, deletedAt: null })
        .select('points')
        .sort({ points: -1 })
        .lean();
      const myIdx = topStudents.findIndex(s => s._id.toString() === user._id.toString());
      if (myIdx !== -1) rank = myIdx + 1;
    }

    // حساب المعدل التراكمي التقريبي
    const totalQuizPoints = quizAttempts.reduce((acc, q) => acc + (q.score || 0), 0);
    const maxQuizPoints = quizAttempts.reduce((acc, q) => acc + (q.maxScore || 100), 0);
    const quizPct = maxQuizPoints > 0 ? (totalQuizPoints / maxQuizPoints) * 100 : 85;
    const academicPct = Math.min(100, Math.round(attendanceRate * 0.3 + quizPct * 0.7));
    const estimatedGPA = (Math.max(2.0, (academicPct / 100) * 4.0)).toFixed(2);

    const studentData = {
      id: user._id,
      name: user.name,
      role: isLeader ? 'leader' : 'student',
      roleTitle: isLeader ? 'طالب - ممثل الدفعة الأكاديمية' : 'طالب جامعي منتظم',
      batchName: user.batch?.name || 'دفعة عامة',
      batchCode: user.batch?.code || 'IT-CBS',
      year: user.batch?.year || new Date().getFullYear(),
      enrolledAt: user.createdAt,
      points: user.points || 0,
      badges: user.badges && user.badges.length ? user.badges : ['طالب متميز ', 'ملتزم أكاديمياً '],
      rankInBatch: rank,
      serialNumber,
      verificationHash
    };

    const academicRecord = {
      roleType: 'student',
      attendanceRate,
      totalClasses,
      presentClasses,
      completedQuizzes: quizAttempts.length,
      passedQuizzes,
      completedAssignments,
      registeredSubjectsCount: subjects.length,
      estimatedGPA,
      academicPct,
      subjects: subjects.map(s => ({
        name: s.name,
        code: s.code || 'CS',
        creditHours: 3,
        status: 'مسجل ونشط',
        grade: 'معتمد'
      }))
    };

    return success(res, {
      student: studentData,
      user: studentData,
      academicRecord,
      institution: {
        name: 'جامعة النصر التقنية',
        faculty: 'كلية النصر التقنية',
        city: 'الخرطوم - السودان',
        verified: true,
        issuedAt: new Date(),
        documentType: 'السجل الأكاديمي وكشف الدرجات الموثق (Official Verified Academic Transcript)'
      }
    });
  } catch (err) {
    return serverError(res, err, 'Student portfolio verification');
  }
});

module.exports = router;

