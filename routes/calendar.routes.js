const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const Assignment = require("../models/Assignment");
const Quiz = require("../models/Quiz");
const AcademicEvent = require("../models/AcademicEvent");
const User = require("../models/User");
const { success, serverError } = require("../utils/response");
const mongoose = require("mongoose");

// دالة مساعدة لجلب الأحداث حسب النطاق الزمني والمستخدم
async function fetchCalendarEvents(user, queryStart, queryEnd, headerBatchId) {
  const student = await User.findById(user.id).select("batch").lean();
  const batchId = student?.batch
    || (headerBatchId && mongoose.Types.ObjectId.isValid(headerBatchId)
        ? new mongoose.Types.ObjectId(headerBatchId)
        : null);

  // نطاق الوقت
  const startDate = queryStart ? new Date(queryStart) : (() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  })();
  const endDate = queryEnd ? new Date(queryEnd) : (() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(0); d.setHours(23, 59, 59, 999); return d;
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

  const canManage = Boolean(user.roles && (user.roles.includes("dean") || user.roles.includes("admin") || user.roles.includes("leader")));

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
        icon: "",
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
      icon: "",
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
      icon: e.type === "exam" ? "" : (e.type === "meeting" ? "" : (e.type === "holiday" ? "" : "")),
      title: e.title,
      subtitle: e.subject?.name || e.location || e.description || "",
      start: e.startsAt,
      end: e.endsAt || null,
      description: e.description || "",
      location: e.location || "",
      subjectId: e.subject?._id || null,
      subjectName: e.subject?.name || "",
      canEdit: canManage || (e.createdBy && String(e.createdBy) === String(user.id)),
      meta: {},
      url: null
    }))
  ];

  // ترتيب حسب الوقت
  events.sort((a, b) => new Date(a.start) - new Date(b.start));

  return {
    events,
    canManage,
    period: { start: startDate.toISOString(), end: endDate.toISOString() },
    counts: {
      assignments: assignments.length,
      quizzes: quizzes.length,
      academicEvents: academicEvents.length,
      total: events.length
    }
  };
}

// ========== تقويم موحّد: الواجبات + الاختبارات + الأحداث ==========
router.get("/events", auth, async (req, res) => {
  try {
    const result = await fetchCalendarEvents(req.user, req.query.start, req.query.end, req.headers["x-batch-id"]);
    success(res, result);
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

    const result = await fetchCalendarEvents(req.user, start.toISOString(), end.toISOString(), req.headers["x-batch-id"]);
    success(res, result);
  } catch (err) {
    serverError(res, err, "أحداث اليوم");
  }
});

module.exports = router;
