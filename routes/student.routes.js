const router = require("express").Router();
const mongoose = require("mongoose");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const User = require("../models/User");
const Subject = require("../models/Subject");
const Assignment = require("../models/Assignment");
const StudentSubmission = require("../models/StudentSubmission");
const Attendance = require("../models/Attendance");
const Notification = require("../models/Notification");
const QuizAttempt = require("../models/QuizAttempt");
const Quiz = require("../models/Quiz");
const { success, serverError } = require("../utils/response");

function buildStudentStudyPlan(assignments = [], quizzes = [], now = new Date()) {
  const current = new Date(now).getTime();
  const tasks = [
    ...assignments.filter(item => item?.dueDate).map(item => ({
      type: "assignment",
      id: item._id,
      title: item.title || "واجب دراسي",
      subject: item.subject?.name || "مادة دراسية",
      dueAt: new Date(item.dueDate),
      action: "راجع المطلوب وأرسل التسليم قبل الموعد"
    })),
    ...quizzes.filter(item => item?.startsAt || item?.endsAt).map(item => ({
      type: "quiz",
      id: item._id,
      title: item.title || "اختبار قادم",
      subject: item.subject?.name || "مادة دراسية",
      dueAt: new Date(item.startsAt || item.endsAt),
      action: "راجع المحاضرات وحل اختباراً تجريبياً"
    }))
  ]
    .filter(item => !Number.isNaN(item.dueAt.getTime()) && item.dueAt.getTime() >= current)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 8);

  return tasks.map(item => ({
    ...item,
    dueAt: item.dueAt.toISOString(),
    urgency: item.dueAt.getTime() - current <= 3 * 86400000 ? "high" : "normal"
  }));
}

function buildStudentSmartAlerts({ assignments = [], quizzes = [], attendanceRate, now = new Date() }) {
  const current = new Date(now).getTime();
  const alerts = [];
  for (const item of assignments) {
    const due = new Date(item.dueDate).getTime();
    if (!Number.isNaN(due) && due >= current && due - current <= 48 * 3600000) {
      alerts.push({ type: "assignment_due", severity: "high", title: "موعد تسليم قريب", message: `تبقى أقل من 48 ساعة على تسليم ${item.title || "واجبك"}.`, actionUrl: "/assignments.html" });
    }
  }
  for (const item of quizzes) {
    const start = new Date(item.startsAt || item.endsAt).getTime();
    if (!Number.isNaN(start) && start >= current && start - current <= 72 * 3600000) {
      alerts.push({ type: "quiz_due", severity: "medium", title: "اختبار قريب", message: `استعد لاختبار ${item.title || "قادم"} وراجع محاضرات المادة.`, actionUrl: "/quizzes.html" });
    }
  }
  if (attendanceRate !== null && attendanceRate !== undefined && attendanceRate < 75) {
    alerts.push({ type: "attendance_risk", severity: "high", title: "تنبيه الحضور", message: `نسبة حضورك الحالية ${attendanceRate}% وتحتاج إلى متابعة.`, actionUrl: "/attendance-history.html" });
  }
  return alerts.slice(0, 6);
}

function calculateStudentRisk({ attendanceRate, pendingAssignments = 0, totalAssignments = 0, avgGrade, avgQuizScore }) {
  const reasons = [];
  if (attendanceRate !== null && attendanceRate !== undefined && attendanceRate < 75) reasons.push("الحضور أقل من 75%");
  if (totalAssignments > 0 && pendingAssignments >= Math.max(2, Math.ceil(totalAssignments * 0.4))) reasons.push("تراكم واجبات غير مسلّمة");
  if (avgGrade !== null && avgGrade !== undefined && avgGrade < 60) reasons.push("متوسط درجات الواجبات منخفض");
  if (avgQuizScore !== null && avgQuizScore !== undefined && avgQuizScore < 60) reasons.push("نتائج الاختبارات تحتاج مراجعة");
  const level = reasons.length >= 2 ? "high" : reasons.length === 1 ? "medium" : "low";
  return { level, reasons };
}

// ========== لوحة تحكم الطالب (كل البيانات في طلب واحد) ==========
router.get("/dashboard", auth, async (req, res) => {
  try {
    // جلب بيانات المستخدم الكاملة (batch قد لا يكون في التوكن)
    const student = await User.findById(req.user.id)
      .select("batch batches points name")
      .lean();

    const batchId = student?.batch;

    // استعلامات متوازية لأقصى سرعة
    const [
      subjectsCount,
      allAssignments,
      mySubmissions,
      attendanceStats,
      recentNotifs,
      upcomingQuizzes,
      quizAttempts
    ] = await Promise.all([
      // عدد المواد في الدفعة
      batchId
        ? Subject.countDocuments({ batches: batchId })
        : 0,

      // الواجبات المفتوحة (غير منتهية الموعد)
      batchId
        ? Assignment.find({ batches: batchId })
            .select("_id title dueDate dueTime subject")
            .populate("subject", "name")
            .lean()
        : [],

      // تسليماتي
      StudentSubmission.find({ student: req.user.id })
        .select("assignment status grade")
        .lean(),

      // إحصائيات الحضور عبر aggregate
      Attendance.aggregate([
        { $match: { "students.student": new mongoose.Types.ObjectId(req.user.id) } },
        { $unwind: "$students" },
        { $match: { "students.student": new mongoose.Types.ObjectId(req.user.id) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            present: {
              $sum: {
                $cond: [{ $eq: ["$students.status", "present"] }, 1, 0]
              }
            }
          }
        }
      ]),

      // آخر 3 إشعارات
      /* كان { target: { $in: req.user.roles } } — "student" لا يطابق
         "students" أبداً، فلوحة الطالب لا تعرض إلا إشعارات "all" بينما
         صفحة الإشعارات تعرض الكل: رقمان متضاربان أمام المستخدم نفسه. */
      Notification.find(
        Notification.buildVisibilityQuery(req.user.id, req.user.roles, batchId, [])
      )
        .sort({ createdAt: -1 })
        .limit(3)
        .select("title message type createdAt")
        .lean(),

      // الاختبارات القادمة للدفعة
      batchId
        ? Quiz.find({ batch: batchId, published: true, endsAt: { $gte: new Date() } })
            .select("_id title startsAt endsAt subject")
            .populate("subject", "name")
            .sort({ startsAt: 1 })
            .limit(8)
            .lean()
        : [],

      // محاولات الاختبارات
      QuizAttempt.find({ student: req.user.id })
        .select("score maxScore")
        .lean()
    ]);

    // حساب الواجبات المعلّقة (لم يُسلَّم)
    const submittedAssignmentIds = new Set(
      mySubmissions
        .map(s => (s.assignment ? s.assignment.toString() : null))
        .filter(Boolean)
    );
    const now = new Date();
    const pendingAssignments = allAssignments.filter(a => {
      const due = new Date(a.dueDate);
      if (a.dueTime) {
        const [h, m] = a.dueTime.split(":").map(Number);
        due.setHours(h, m, 0, 0);
      }
      return due > now && !submittedAssignmentIds.has(a._id.toString());
    });

    // حساب متوسط الدرجات
    const gradedSubmissions = mySubmissions.filter(s => s.grade !== undefined);
    const avgGrade = gradedSubmissions.length
      ? Math.round(gradedSubmissions.reduce((sum, s) => sum + s.grade, 0) / gradedSubmissions.length)
      : null;

    // نسبة الحضور
    const attData = attendanceStats[0] || { total: 0, present: 0 };
    const attendanceRate = attData.total > 0
      ? Math.round((attData.present / attData.total) * 100)
      : null;

    // متوسط نتائج الاختبارات
    const avgQuizScore = quizAttempts.length
      ? Math.round(
          quizAttempts.reduce((sum, q) => sum + (q.maxScore > 0 ? (q.score / q.maxScore) * 100 : 0), 0) / quizAttempts.length
        )
      : null;

    const submittedCount = allAssignments.filter(a => submittedAssignmentIds.has(a._id.toString())).length;
    const assignmentCompletion = allAssignments.length
      ? Math.round((submittedCount / allAssignments.length) * 100)
      : null;
    const progressSignals = [assignmentCompletion, attendanceRate, avgGrade, avgQuizScore]
      .filter(value => value !== null && value !== undefined);
    const overallProgress = progressSignals.length
      ? Math.round(progressSignals.reduce((sum, value) => sum + value, 0) / progressSignals.length)
      : null;
    const studyPlan = buildStudentStudyPlan(
      allAssignments.filter(a => !submittedAssignmentIds.has(a._id.toString())),
      upcomingQuizzes,
      now
    );
    const risk = calculateStudentRisk({
      attendanceRate,
      pendingAssignments: pendingAssignments.length,
      totalAssignments: allAssignments.length,
      avgGrade,
      avgQuizScore
    });
    const smartAlerts = buildStudentSmartAlerts({
      assignments: pendingAssignments,
      quizzes: upcomingQuizzes,
      attendanceRate,
      now
    });

    success(res, {
      stats: {
        subjects: subjectsCount,
        pendingAssignments: pendingAssignments.length,
        totalAssignments: allAssignments.length,
        submittedAssignments: mySubmissions.length,
        attendanceRate,
        avgGrade,
        points: student?.points || 0,
        quizAttempts: quizAttempts.length,
        avgQuizScore,
        assignmentCompletion,
        overallProgress
      },
      progress: {
        overall: overallProgress,
        assignments: assignmentCompletion,
        attendance: attendanceRate,
        grade: avgGrade,
        quizzes: avgQuizScore
      },
      risk,
      smartAlerts,
      studyPlan: {
        generatedAt: now.toISOString(),
        items: studyPlan,
        hasUrgentItems: studyPlan.some(item => item.urgency === "high")
      },
      recentNotifications: recentNotifs
    });
  } catch (err) {
    serverError(res, err, "dashboard الطالب");
  }
});

// ========== تقرير الطالب الشخصي ==========
router.get("/report", auth, async (req, res) => {
  try {
    const student = await User.findById(req.user.id)
      .select("batch points name email")
      .lean();

    const batchId = student?.batch;

    const [allAssignments, submissions, attendanceAgg, bySubjectAgg, quizAttempts] = await Promise.all([
      batchId ? Assignment.countDocuments({ batches: batchId }) : 0,

      StudentSubmission.find({ student: req.user.id })
        .select("assignment status grade submissionDate isLate")
        .populate("assignment", "title dueDate subject")
        .lean(),

      batchId
        ? Attendance.aggregate([
            { $match: { batch: batchId } },
            { $unwind: "$students" },
            { $match: { "students.student": student._id } },
            {
              $group: {
                _id: "$students.status",
                count: { $sum: 1 }
              }
            }
          ])
        : [],

      batchId
        ? Attendance.aggregate([
            { $match: { batch: batchId } },
            { $unwind: "$students" },
            { $match: { "students.student": student._id } },
            {
              $group: {
                _id: "$subject",
                total: { $sum: 1 },
                present: {
                  $sum: { $cond: [{ $eq: ["$students.status", "present"] }, 1, 0] }
                }
              }
            },
            {
              $lookup: {
                from: "subjects",
                localField: "_id",
                foreignField: "_id",
                as: "subjectDoc"
              }
            },
            { $unwind: { path: "$subjectDoc", preserveNullAndEmptyArrays: true } }
          ])
        : [],

      QuizAttempt.find({ student: req.user.id })
        .select("score maxScore submittedAt")
        .populate("quiz", "title")
        .lean()
    ]);

    // تجميع بيانات الحضور
    const attMap = {};
    attendanceAgg.forEach(a => { attMap[a._id] = a.count; });
    const present = attMap["present"] || 0;
    const absent = attMap["absent"] || 0;
    const excused = attMap["excused"] || 0;
    const totalSessions = present + absent + excused;
    const attendanceRate = totalSessions > 0
      ? Math.round((present / totalSessions) * 100)
      : null;

    const bySubject = bySubjectAgg.map(item => ({
      subjectName: item.subjectDoc?.name || "مادة دراسية",
      rate: item.total > 0 ? Math.round((item.present / item.total) * 100) : 0
    }));

    // إحصائيات الواجبات
    const gradedSubmissions = submissions.filter(s => s.grade !== undefined);
    const avgGrade = gradedSubmissions.length
      ? Math.round(gradedSubmissions.reduce((sum, s) => sum + s.grade, 0) / gradedSubmissions.length)
      : null;

    // إحصائيات الاختبارات
    const avgQuizScore = quizAttempts.length
      ? Math.round(
          quizAttempts.reduce((sum, q) => sum + (q.maxScore > 0 ? (q.score / q.maxScore) * 100 : 0), 0) / quizAttempts.length
        )
      : null;

    success(res, {
      student: { name: student.name, email: student.email, points: student.points || 0, batch: student.batch },
      totalPoints: student.points || 0,
      assignments: {
        total: submissions.length,
        submittedCount: submissions.length,
        totalCount: allAssignments,
        graded: gradedSubmissions.length,
        avgGrade,
        late: submissions.filter(s => s.isLate).length,
        list: submissions.slice(0, 20) // آخر 20 واجب
      },
      attendance: {
        total: totalSessions,
        present,
        absent,
        excused,
        overallRate: attendanceRate,
        rate: attendanceRate,
        bySubject
      },
      quizzes: {
        total: quizAttempts.length,
        avgScore: avgQuizScore,
        list: quizAttempts.slice(0, 10)
      }
    });
  } catch (err) {
    serverError(res, err, "تقرير الطالب");
  }
});

module.exports = router;
module.exports._internals = { buildStudentStudyPlan, calculateStudentRisk, buildStudentSmartAlerts };
