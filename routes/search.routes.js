const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const Subject = require("../models/Subject");
const Lecture = require("../models/Lecture");
const Video = require("../models/Video");
const Assignment = require("../models/Assignment");
const Notification = require("../models/Notification");
const User = require("../models/User");
const PublicNews = require("../models/PublicNews");
const PublicGallery = require("../models/PublicGallery");
const { success, fail, serverError } = require("../utils/response");

// ========== بحث عام موحّد (شامل للمستخدمين، المواد، المحاضرات، الفيديوهات، الأخبار والواجبات) ==========
router.get("/", auth, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) {
      return fail(res, "يجب أن يكون طول البحث حرفين على الأقل");
    }

    const escapedQ = q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    const regex = new RegExp(escapedQ, "i"); // بحث غير حساس للحروف وآمن من الرموز الخاصة
    const limit = 5; // 5 نتائج لكل قسم

    // جلب بيانات المستخدم للتصفية
    const user = await User.findById(req.user.id).select("batch batches roles").lean();
    const batchId = user?.batch || (user?.batches && user.batches[0]);
    const isStaff = req.user.roles.some(r => ["dean", "doctor", "admin", "leader"].includes(r));
    const batchFilter = batchId && !isStaff ? { $or: [{ batch: batchId }, { batches: batchId }] } : {};

    const [subjects, lectures, videos, assignments, notifications, users, news, gallery] = await Promise.all([
      // 1. المواد الدراسية
      Subject.find({
        ...batchFilter,
        $or: [{ name: regex }, { description: regex }, { level: regex }]
      })
        .select("name description level")
        .limit(limit)
        .lean(),

      // 2. المحاضرات
      Lecture.find({
        $or: [{ title: regex }, { summary: regex }]
      })
        .select("title summary subject")
        .populate("subject", "name")
        .limit(limit)
        .lean(),

      // 3. الفيديوهات
      Video.find({
        $or: [{ title: regex }, { description: regex }]
      })
        .select("title description subject")
        .populate("subject", "name")
        .limit(limit)
        .lean(),

      // 4. الواجبات
      Assignment.find({
        ...batchFilter,
        $or: [{ title: regex }, { description: regex }]
      })
        .select("title description type dueDate subject")
        .populate("subject", "name")
        .limit(limit)
        .lean(),

      // 5. الإشعارات
      Notification.find({
        $or: [{ title: regex }, { message: regex }]
      })
        .select("title message type createdAt")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),

      // 6. المستخدمون والطلاب والمعلمون
      User.find({
        $or: [{ name: regex }, { email: regex }, { phone: regex }],
        deletedAt: null
      })
        .select("name email phone roles batch")
        .populate("batch", "name")
        .limit(limit)
        .lean(),

      // 7. الأخبار والفعاليات
      PublicNews.find({
        $or: [{ title: regex }, { content: regex }, { category: regex }]
      })
        .select("title category createdAt")
        .limit(limit)
        .lean(),

      // 8. ألبوم المعرض والصور
      PublicGallery.find({
        $or: [{ title: regex }, { description: regex }, { category: regex }]
      })
        .select("title category createdAt")
        .limit(limit)
        .lean()
    ]);

    const formattedResults = [
      ...subjects.map(s => ({
        type: "subject",
        icon: "ri-book-2-line",
        _id: s._id,
        title: s.name,
        subtitle: `مقرر دراسي · المستوى ${s.level || ""}`,
        url: `/subject.html?id=${s._id}`
      })),

      ...lectures.map(l => ({
        type: "lecture",
        icon: "ri-file-pdf-2-line",
        _id: l._id,
        title: l.title,
        subtitle: `محاضرة في: ${l.subject?.name || "المقرر"}`,
        url: `/subject.html?id=${l.subject?._id || l.subject}&lecture=${l._id}`
      })),

      ...videos.map(v => ({
        type: "video",
        icon: "ri-video-line",
        _id: v._id,
        title: v.title,
        subtitle: `فيديو تعليمي · ${v.subject?.name || ""}`,
        url: `/videos.html?id=${v._id}`
      })),

      ...assignments.map(a => ({
        type: "assignment",
        icon: "ri-task-line",
        _id: a._id,
        title: a.title,
        subtitle: `واجب دراسي · ${a.subject?.name || ""}`,
        url: `/assignments.html`
      })),

      ...users.map(u => {
        const roleLabel = u.roles?.includes("doctor") ? "دكتور" : u.roles?.includes("dean") ? "عميد" : u.roles?.includes("leader") ? "قائد دفعة" : "طالب";
        return {
          type: "student",
          icon: "ri-user-3-line",
          _id: u._id,
          title: u.name,
          subtitle: `${roleLabel}${u.batch?.name ? " · " + u.batch.name : ""}${u.email ? " (" + u.email + ")" : ""}`,
          url: isStaff ? `/manage-users.html` : `#`
        };
      }),

      ...news.map(n => ({
        type: "news",
        icon: "ri-newspaper-line",
        _id: n._id,
        title: n.title,
        subtitle: `خبر/حدث · ${n.category || "الكلية"}`,
        url: `/news.html?id=${n._id}`
      })),

      ...gallery.map(g => ({
        type: "gallery",
        icon: "ri-gallery-line",
        _id: g._id,
        title: g.title,
        subtitle: `المعرض · ${g.category || "الصور"}`,
        url: `/gallery.html`
      })),

      ...notifications.map(n => ({
        type: "notification",
        icon: n.type === "emergency" ? "ri-alarm-warning-line" : "ri-notification-3-line",
        _id: n._id,
        title: n.title,
        subtitle: n.message?.substring(0, 65) + (n.message?.length > 65 ? "..." : ""),
        url: `/notifications.html`
      }))
    ];

    success(res, {
      query: q,
      totalResults: formattedResults.length,
      results: formattedResults
    });
  } catch (err) {
    serverError(res, err, "البحث العام");
  }
});

module.exports = router;
