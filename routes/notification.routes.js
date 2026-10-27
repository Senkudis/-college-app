const router = require("express").Router();
const Notification = require("../models/Notification");
const User = require("../models/User");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const { success, fail, notFound, serverError } = require("../utils/response");

/* إرسال إشعار الهاتف (FCM + Web Push) يتم في خطّاف الحفظ بنموذج الإشعار
   (utils/pushDispatch) فيشمل الإشعارات التلقائية أيضاً لا اليدوية وحدها. */

// إنشاء تنبيه (عميد أو دكتور أو ليدر فقط - الطلاب لا يمكنهم)
router.post("/", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    // الدفعة المستهدفة قد تصل عبر query (?batch=) أو الهيدر أو الجسم
    let batches = Array.isArray(req.body.batches) ? req.body.batches.filter(Boolean) : [];
    const singleBatch = req.query.batch || req.headers["x-batch-id"];
    if (!batches.length && singleBatch && singleBatch !== "null" && singleBatch !== "undefined") {
      batches = [singleBatch];
    }

    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");

    // الليدر يرسل لدفعته فقط — لا يمكنه البث لكل الجامعة أو لدفعات أخرى
    if (!isDeanOrAdmin && req.user.roles.includes("leader") && !req.user.roles.includes("doctor")) {
      const sender = await User.findById(req.user.id).select("batch").lean();
      if (!sender?.batch) {
        return fail(res, "حسابك غير مرتبط بأي دفعة", 403);
      }
      batches = [sender.batch];
    }

    // الدكتور يرسل فقط للدفعات المسندة إليه (أو لكل دفعه إذا ترك الخيار عاماً)
    if (!isDeanOrAdmin && req.user.roles.includes("doctor")) {
      const sender = await User.findById(req.user.id).select("batches").lean();
      const myBatches = (sender?.batches || []).map(b => b.toString());
      if (!batches.length) {
        batches = myBatches; // إذا ترك الخيار عاماً، يُرسل لكل دفعات الدكتور
      } else {
        const unauthorized = batches.some(b => !myBatches.includes(b.toString()));
        if (unauthorized) {
          return fail(res, "غير مصرح لك بإرسال تنبيهات لهذه الدفعة", 403);
        }
      }
    }

    /* المستلمون المباشرون يتخطّون كل قيود الدفعات أعلاه: قاعدة الرؤية تمنح
       recipients الأولوية المطلقة، فكان الليدر المقيَّد بدفعته يُرسل إلى أي
       مستخدم في الكلية بمجرد تمرير معرّفه. نحصر المستلمين في نطاق المرسل. */
    let recipients = Array.isArray(req.body.recipients) ? req.body.recipients.filter(Boolean) : [];
    if (recipients.length && !isDeanOrAdmin) {
      const allowedBatches = batches.filter(Boolean);
      if (!allowedBatches.length) {
        return fail(res, "لا يمكنك إرسال إشعار مباشر دون نطاق دفعة", 403);
      }
      const reachable = await User.find({
        _id: { $in: recipients },
        batch: { $in: allowedBatches }
      }).select("_id").lean();

      if (reachable.length !== recipients.length) {
        return fail(res, "بعض المستلمين خارج نطاق دفعاتك", 403);
      }
      recipients = reachable.map(u => u._id);
    }

    const notification = await Notification.create({
      title: req.body.title,
      message: req.body.message,
      type: req.body.type || "normal",
      target: req.body.target || "all",
      batches,
      recipients,
      createdBy: req.user.id
    });

    // جلب معلومات المرسل مع الدور
    const populatedNotification = await Notification.findById(notification._id)
      .populate({
        path: "createdBy",
        select: "name roles email",
        // تحويل الأدوار إلى نص مقروء للعربية
        transform: (doc) => {
          if (doc) {
            const userObj = doc.toObject();
            // إضافة اسم الدور بالعربية للاستخدام في الواجهة
            userObj.roleName = getRoleNameInArabic(userObj.roles[0]);
            return userObj;
          }
          return doc;
        }
      });

    // ===== Socket.io Emit =====
    const io = req.app.get('io');
    if (io) {
      const emitData = {
        title: notification.title,
        message: notification.message,
        type: notification.type,
        target: notification.target // يستخدمه العميل لتجاهل الإشعارات الموجهة لدور آخر
      };

      // الأولوية: مستلمون محددون ← دفعات محددة ← بث عام
      if (notification.recipients.length > 0) {
        notification.recipients.forEach(rId => io.to(`user:${rId}`).emit('notification:new', emitData));
      } else if (notification.batches.length > 0) {
        notification.batches.forEach(bId => io.to(`batch:${bId}`).emit('notification:new', emitData));
      } else {
        io.emit('notification:new', emitData);
      }
    }

    success(res, { notification: populatedNotification }, "تم إنشاء الإشعار بنجاح");
  } catch (err) {
    serverError(res, err, "إنشاء الإشعار");
  }
});

// جلب الإشعارات الخاصة بالإدارة (المرسلة بواسطة المستخدم أو حسب صلاحيته)
router.get("/manage", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    let query = {};
    // إذا كان الأدمن العام، اترك الاستعلام فارغاً لجلب كل التنبيهات
    if (!req.user.roles.includes("admin")) {
      if (req.user.roles.includes("dean")) {
        // العميد يرى التنبيهات التي أنشأها، أو التي تخص دفعته
        const user = await User.findById(req.user.id).select("batch batches").lean();
        if (user) {
          query = { $or: [{ createdBy: req.user.id }] };
          if (user.batch) query.$or.push({ batches: user.batch });
          if (user.batches && user.batches.length > 0) query.$or.push({ batches: { $in: user.batches } });
        } else {
          query.createdBy = req.user.id;
        }
      } else {
        // أي حد تاني (دكتور/ليدر) يرى التنبيهات التي أرسلها هو فقط
        query.createdBy = req.user.id;
      }
    }

    // بلا حد كان العميد/الأدمن يُحمّل كل إشعارات الكلية منذ التأسيس في كل فتح للصفحة
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("createdBy", "name")
      .lean();

    res.json({ success: true, data: notifications });
  } catch (err) {
    serverError(res, err, "فشل جلب إشعارات الإدارة");
  }
});

// جلب جميع التنبيهات (مع Pagination)
router.get("/", auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const user = await User.findById(req.user.id).select("batch batches").lean();
    const query = Notification.buildVisibilityQuery(
      req.user.id, req.user.roles, user?.batch, user?.batches || []
    );

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        /* كان { type: -1 } أولاً: "normal" > "emergency" أبجدياً، فتنزل الإشعارات
           الطارئة تحت كل العادية — عكس المقصود تماماً. الأحدث أولاً. */
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: "createdBy",
          select: "name roles email profileImage",
          transform: (doc) => {
            if (doc) {
              const userObj = doc.toObject();
              userObj.roleName = getRoleNameInArabic(userObj.roles[0]);
              return userObj;
            }
            return doc;
          }
        }),
      Notification.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: page * limit < total
      }
    });
  } catch (err) {
    serverError(res, err, "جلب الإشعارات");
  }
});

// جلب عدد التنبيهات غير المقروءة للمستخدم الحالي
router.get("/unread-count", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("batch batches").lean();
    const count = await Notification.countUnreadForUser(
      req.user.id, req.user.roles, user?.batch, user?.batches || []
    );
    res.json({ success: true, count });
  } catch (err) {
    serverError(res, err, "جلب عدد الإشعارات غير المقروءة");
  }
});

// جلب التنبيهات الجديدة بعد تاريخ محدد
router.get("/new", auth, async (req, res) => {
  try {
    const lastCheckTime = parseInt(req.query.lastCheck) || 0;
    
    const user = await User.findById(req.user.id).select("batch batches").lean();
    const query = {
      createdAt: { $gt: new Date(lastCheckTime) },
      ...Notification.buildVisibilityQuery(req.user.id, req.user.roles, user?.batch, user?.batches || [])
    };

    // lastCheck=0 (أول فتح أو مسح التخزين) كان يُرجع كل الإشعارات المرئية دفعة واحدة
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(20)
      .populate({
        path: "createdBy",
        select: "name roles email profileImage",
        transform: (doc) => {
          if (doc) {
            const userObj = doc.toObject();
            userObj.roleName = getRoleNameInArabic(userObj.roles[0]);
            return userObj;
          }
          return doc;
        }
      });

    res.json({ success: true, data: notifications });
  } catch (err) {
    serverError(res, err, "جلب الإشعارات الجديدة");
  }
});

// جلب الإشعارات الطارئة الجديدة فقط (لمنع التكرار في dashboard)
router.get("/emergency/new", auth, async (req, res) => {
  try {
    const lastCheckTime = parseInt(req.query.lastCheck) || 0;

    // تصفية حسب صلاحية المستخدم (مثل سائر مسارات الإشعارات)
    const user = await User.findById(req.user.id).select("batch batches").lean();
    const query = {
      type: "emergency",
      createdAt: { $gt: new Date(lastCheckTime) },
      ...Notification.buildVisibilityQuery(req.user.id, req.user.roles, user?.batch, user?.batches || [])
    };

    const emergencyNotifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .populate({
      path: "createdBy",
      select: "name roles",
      transform: (doc) => {
        if (doc) {
          const userObj = doc.toObject();
          userObj.roleName = getRoleNameInArabic(userObj.roles[0]);
          return userObj;
        }
        return doc;
      }
    })
    .limit(10); // الحد الأقصى 10 إشعارات طارئة

    res.json(emergencyNotifications);
  } catch (err) {
    serverError(res, err, "جلب الإشعارات الطارئة الجديدة");
  }
});

// تحديد تنبيه كمقروء للمستخدم الحالي
router.post("/read/:id", auth, async (req, res) => {
    try {
    const user = await User.findById(req.user.id).select("batch batches").lean();
    const visibilityQuery = Notification.buildVisibilityQuery(
      req.user.id, req.user.roles, user?.batch, user?.batches || []
    );
    const visibleNotification = await Notification.findOne({
      $and: [{ _id: req.params.id }, visibilityQuery]
    }).lean();
    if (!visibleNotification) {
      return notFound(res, "التنبيه");
    }

    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { readBy: req.user.id } },
      { returnDocument: 'after' }
    );

    res.json({ 
 
      success: true,
      message: "تم تحديد التنبيه كمقروء",
      readBy: notification.readBy.length
    });
  } catch (err) {
    serverError(res, err, "تحديد الإشعار كمقروء");
  }
});

// تحديد جميع التنبيهات كمقروءة للمستخدم الحالي
router.post("/read-all", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("batch batches").lean();
    const visibilityQuery = Notification.buildVisibilityQuery(
      req.user.id, req.user.roles, user?.batch, user?.batches || []
    );
    // ملاحظة: لا نضيف المستخدم إلا إلى التنبيهات الظاهرة له فعلياً.
    const result = await Notification.updateMany(
      { $and: [visibilityQuery, { readBy: { $ne: req.user.id } }] },
      { $addToSet: { readBy: req.user.id } }
    );

    res.json({ 
      success: true,
      message: "تم تحديد جميع التنبيهات كمقروءة",
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    serverError(res, err, "تحديد جميع الإشعارات كمقروءة");
  }
});

// حذف تنبيه (عميد أو دكتور أو ليدر فقط)
router.delete("/:id", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    
    if (!notification) {
      return notFound(res, "التنبيه");
    }

    // فقط منشئ الإشعار أو العميد/المسؤول يمكنه حذفه
    const isStaff = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    const isCreator = notification.createdBy && notification.createdBy.toString() === req.user.id;
    if (!isStaff && !isCreator) {
      return fail(res, "ليس لديك صلاحية لحذف هذا التنبيه", 403);
    }

    await notification.deleteOne();
    
    res.json({ 
      success: true,
      message: "تم حذف التنبيه بنجاح",
      deletedId: req.params.id
    });
  } catch (err) {
    serverError(res, err, "حذف الإشعار");
  }
});

// دالة مساعدة: تحويل اسم الدور إلى العربية
function getRoleNameInArabic(role) {
  const roleMap = {
    "dean": "العميد",
    "doctor": "الدكتور",
    "leader": "الليدر", 
    "student": "الطالب",
    "admin": "المسؤول",
    "system": "النظام"
  };
  
  return roleMap[role] || role;
}

// دالة مساعدة: تنظيف الإشعارات القديمة (يمكن تفعيلها بواسطة Cron Job)
router.post("/cleanup-old", auth, role("dean"), async (req, res) => {
  try {
    const days = Number(req.body.days ?? 30); // حذف الإشعارات الأقدم من 30 يوم افتراضياً
    if (!Number.isInteger(days) || days < 7 || days > 3650) {
      return fail(res, "عدد الأيام يجب أن يكون رقماً صحيحاً بين 7 و3650");
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const result = await Notification.deleteMany({
      type: "normal", // فقط الإشعارات العادية
      createdAt: { $lt: cutoffDate }
    });
    
    res.json({
      success: true,
      message: `تم تنظيف الإشعارات القديمة`,
      deletedCount: result.deletedCount,
      cutoffDate: cutoffDate.toISOString()
    });
  } catch (err) {
    serverError(res, err, "تنظيف الإشعارات القديمة");
  }
});

module.exports = router;
