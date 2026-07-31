const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const Assignment = require("../models/Assignment");
const Quiz = require("../models/Quiz");
const AcademicEvent = require("../models/AcademicEvent");
const User = require("../models/User");
const { success, serverError } = require("../utils/response");
const mongoose = require("mongoose");

// ========== تقويم موحّد: الواجبات + الاختبارات + الأحداث ==========
router.get("/events", auth, async (req, res) => {
  try {
    const student = await User.findById(req.user.id).select("batch").lean();
    const batchId = student?.batch
      || (req.headers["x-batch-id"] && mongoose.Types.ObjectId.isValid(req.headers["x-batch-id"])
          ? new mongoose.Types.ObjectId(req.headers["x-batch-id"])
          : null);

    // نطاق الوقت (الشهر الحالي افتراضياً، أو المحدد من query)
    const startDate = req.query.start ? new Date(req.query.start) : (() => {
      const d = new Date(); d.setDate(1); return d;
    })();
    const endDate = req.query.end ? new Date(req.query.end) : (() => {
      const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(0); return d;
    })();

    const batchFilter = batchId ? { batches: batchId } : {};

    const [assignments, quizzes, academicEvents] = await Promise.all([
      // الواجبات في النطاق الزمني
      Assignment.find({
        ...batchFilter,
        dueDate: { $gte: startDate, $lte: endDate }
      })
        .select("title type dueDate dueTime subject batches")
        .populate("subject", "name")
        .lean(),

      // الاختبارات
      batchId
        ? Quiz.find({
            batch: batchId,
            published: true,
            $or: [
              { startsAt: { $gte: startDate, $lte: endDate } },
              { endsAt: { $gte: startDate, $lte: endDate } }
            ]
          })
            .select("title startsAt endsAt durationMinutes subject")
            .populate("subject", "name")
            .lean()
        : [],

      // الأحداث الأكاديمية
      AcademicEvent.find({
        ...(batchId ? { batch: batchId } : {}),
        startsAt: { $gte: startDate, $lte: endDate }
      })
        .select("title type startsAt endsAt description location subject createdBy")
        .populate("subject", "name")
        .lean()
    ]);

    const canManage = Boolean(req.user.roles && (req.user.roles.includes("dean") || req.user.roles.includes("admin") || req.user.roles.includes("leader")));

    // تحويل كل الأحداث لصيغة موحدة غنية بالبيانات
    const events = [
      // الواجبات — لون برتقالي
      ...assignments.map(a => {
        const due = new Date(a.dueDate);
        if (a.dueTime) {
          const [h, m] = a.dueTime.split(":").map(Number);
          due.setHours(h, m, 0, 0);
        }
        return {
          id: `assignment-${a._id}`,
          rawId: a._id,
          rawType: "assignment",
          type: "assignment",
          color: "#f59e0b",
          icon: "📝",
          title: a.title,
          subtitle: a.subject?.name || "",
          start: due.toISOString(),
          end: null,
          meta: { assignmentType: a.type },
          url: `/assignments.html`
        };
      }),

      // الاختبارات — لون أحمر
      ...quizzes.map(q => ({
        id: `quiz-${q._id}`,
        rawId: q._id,
        rawType: "quiz",
        type: "quiz",
        color: "#ef4444",
        icon: "📊",
        title: q.title,
        subtitle: q.subject?.name || "",
        start: q.startsAt,
        end: q.endsAt,
        meta: { durationMinutes: q.durationMinutes },
        url: `/quizzes.html`
      })),

      // الأحداث الأكاديمية — لون أخضر/حسب النوع
      ...academicEvents.map(e => ({
        id: `event-${e._id}`,
        rawId: e._id,
        rawType: "academicEvent",
        type: e.type || "event",
        color: e.type === "exam" ? "#ef4444" : (e.type === "holiday" ? "#3b82f6" : "#10b981"),
        icon: e.type === "exam" ? "📝" : (e.type === "meeting" ? "👥" : (e.type === "holiday" ? "🌴" : "📅")),
        title: e.title,
        subtitle: e.subject?.name || e.location || e.description || "",
        start: e.startsAt,
        end: e.endsAt || null,
        description: e.description || "",
        location: e.location || "",
        subjectId: e.subject?._id || null,
        subjectName: e.subject?.name || "",
        canEdit: canManage || (e.createdBy && String(e.createdBy) === String(req.user.id)),
        meta: {},
        url: null
      }))
    ];

    // ترتيب حسب الوقت
    events.sort((a, b) => new Date(a.start) - new Date(b.start));

    success(res, {
      events,
      canManage,
      period: { start: startDate.toISOString(), end: endDate.toISOString() },
      counts: {
        assignments: assignments.length,
        quizzes: quizzes.length,
        academicEvents: academicEvents.length,
        total: events.length
      }
    });
  } catch (err) {
    serverError(res, err, "تقويم الأحداث");
  }
});

// ========== أحداث اليوم فقط ==========
router.get("/today", auth, async (req, res) => {
  try {
    const today = new Date();
    const start = new Date(today.setHours(0, 0, 0, 0));
    const end = new Date(today.setHours(23, 59, 59, 999));

    req.query.start = start.toISOString();
    req.query.end = end.toISOString();

    // إعادة استخدام نفس المنطق
    return router.handle({ ...req, url: "/events" }, res, () => {});
  } catch (err) {
    serverError(res, err, "أحداث اليوم");
  }
});

module.exports = router;
