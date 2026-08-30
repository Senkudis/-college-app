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

function searchId(value) {
  return value === null || value === undefined ? "" : String(value._id || value.id || value);
}

function buildSearchScope(user, userId) {
  const roles = Array.isArray(user?.roles) ? user.roles : [user?.roles];
  const global = roles.some(role => ["dean", "admin"].includes(role));
  const batchIds = [...new Set([
    user?.batch,
    ...(Array.isArray(user?.batches) ? user.batches : [])
  ].map(searchId).filter(Boolean))];
  if (global) return { global, batchIds, subjectFilter: {}, batchFilter: {}, userFilter: {} };
  if (roles.includes("doctor")) {
    const subjectFilter = { doctor: userId };
    if (batchIds.length) subjectFilter.batches = { $in: batchIds };
    return {
      global,
      batchIds,
      subjectFilter,
      batchFilter: batchIds.length ? { $or: [{ batch: { $in: batchIds } }, { batches: { $in: batchIds } }] } : { _id: null },
      userFilter: batchIds.length ? { $or: [{ batch: { $in: batchIds } }, { batches: { $in: batchIds } }] } : { _id: null }
    };
  }
  const scoped = batchIds.length ? { $or: [{ batch: { $in: batchIds } }, { batches: { $in: batchIds } }] } : { _id: null };
  return { global, batchIds, subjectFilter: batchIds.length ? { batches: { $in: batchIds } } : { _id: null }, batchFilter: scoped, userFilter: scoped };
}

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
    const roles = Array.isArray(req.user.roles) ? req.user.roles : [];
    const isStaff = roles.some(r => ["dean", "doctor", "admin", "leader"].includes(r));
    const scope = buildSearchScope(user, req.user.id);
    const accessibleSubjectIds = scope.global
      ? null
      : (await Subject.find(scope.subjectFilter).select("_id").lean()).map(subject => subject._id);
    const subjectAccessFilter = scope.global ? {} : (accessibleSubjectIds.length ? { subject: { $in: accessibleSubjectIds } } : { _id: null });
    /* كان هذا { target: { $in: roles } } — أي مقارنة "student" بـ "students"
       فلا يطابق شيئاً أبداً، والبحث لا يُظهر إلا إشعارات target:"all".
       الدالة الموحّدة في النموذج تُجري التحويل الصحيح وتراعي الدفعات. */
    const notificationVisibility = Notification.buildVisibilityQuery(
      req.user.id, roles, user?.batch, user?.batches || []
    );
    const userSearchFilter = {
      ...scope.userFilter,
      $or: [{ name: regex }, ...(isStaff ? [{ email: regex }, { phone: regex }] : [])],
      deletedAt: null,
      isActive: true,
      isPendingRegistration: { $ne: true }
    };

    const [subjects, lectures, videos, assignments, notifications, users, news, gallery] = await Promise.all([
      // 1. المواد الدراسية
      Subject.find({
        ...scope.subjectFilter,
        $or: [{ name: regex }, { level: regex }]
      })
        .select("name level")
        .limit(limit)
        .lean(),

      // 2. المحاضرات
      Lecture.find({
        ...subjectAccessFilter,
        $or: [{ title: regex }, { extractedText: regex }]
      })
        .select("title subject")
        .populate("subject", "name")
        .limit(limit)
        .lean(),

      // 3. الفيديوهات
      Video.find({
        status: "ready",
        ...scope.batchFilter,
        ...subjectAccessFilter,
        $or: [{ title: regex }, { description: regex }]
      })
        .select("title description subject")
        .populate("subject", "name")
        .limit(limit)
        .lean(),

      // 4. الواجبات
      Assignment.find({
        ...scope.batchFilter,
        ...subjectAccessFilter,
        $or: [{ title: regex }, { description: regex }]
      })
        .select("title description type dueDate subject")
        .populate("subject", "name")
        .limit(limit)
        .lean(),

      // 5. الإشعارات
      Notification.find({
        $and: [notificationVisibility, { $or: [{ title: regex }, { message: regex }] }]
      })
        .select("title message type createdAt")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),

      // 6. المستخدمون والطلاب والمعلمون
      User.find(userSearchFilter)
        .select(isStaff ? "name email phone roles batch" : "name roles batch")
        .populate("batch", "name")
        .limit(limit)
        .lean(),

      // 7. الأخبار والفعاليات
      PublicNews.find({
        isPublished: true,
        $or: [{ title: regex }, { summary: regex }, { body: regex }, { tags: regex }]
      })
        .select("title summary tags createdAt")
        .limit(limit)
        .lean(),

      // 8. ألبوم المعرض والصور
      PublicGallery.find({
        isVisible: true,
        $or: [{ caption: regex }, { category: regex }]
      })
        .select("caption category imageUrl createdAt")
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
        url: `/watch-video.html?id=${v._id}`
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
        const contactInfo = isStaff && u.email ? ` (${u.email})` : '';
        return {
          type: "student",
          icon: "ri-user-3-line",
          _id: u._id,
          title: u.name,
          subtitle: `${roleLabel}${u.batch?.name ? " · " + u.batch.name : ""}${contactInfo}`,
          url: isStaff ? `/manage-users.html` : `#`
        };
      }),

      ...news.map(n => ({
        type: "news",
        icon: "ri-newspaper-line",
        _id: n._id,
        title: n.title,
        subtitle: `خبر/حدث · ${n.summary ? n.summary.slice(0, 60) + '...' : "أخبار الكلية"}`,
        url: `/welcome.html?newsId=${n._id}`
      })),

      ...gallery.map(g => ({
        type: "gallery",
        icon: "ri-gallery-line",
        _id: g._id,
        title: g.caption ? (g.caption.slice(0, 50) + (g.caption.length > 50 ? '...' : '')) : 'صورة من المعرض',
        subtitle: `معرض الصور · ${g.category || "الصور"}`,
        url: `/welcome.html?imageId=${g._id}`
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
module.exports._internals = { buildSearchScope };
