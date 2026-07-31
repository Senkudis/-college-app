const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const User = require("../models/User");
const Subject = require("../models/Subject");
const Assignment = require("../models/Assignment");
const StudentSubmission = require("../models/StudentSubmission");
const Attendance = require("../models/Attendance");
const Notification = require("../models/Notification");
const QuizAttempt = require("../models/QuizAttempt");
const { success, serverError } = require("../utils/response");

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
      quizAttempts
    ] = await Promise.all([
      // عدد المواد في الدفعة
      batchId
        ? Subject.countDocuments({ batches: batchId })
        : 0,

      // الواجبات المفتوحة (غير منتهية الموعد)
      batchId
        ? Assignment.find({ batches: batchId })
            .select("_id dueDate dueTime")
            .lean()
        : [],

      // تسليماتي
      StudentSubmission.find({ student: req.user.id })
        .select("assignment status grade")
        .lean(),

      // إحصائيات الحضور عبر aggregate
      batchId
        ? Attendance.aggregate([
            { $match: { batch: batchId } },
            { $unwind: "$students" },
            { $match: { "students.student": student._id } },
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
          ])
        : [],

      // آخر 3 إشعارات
      Notification.find({
        $or: [
          { target: "all" },
          { target: { $in: req.user.roles } },
          { recipients: req.user.id },
          ...(batchId ? [{ batches: batchId }] : [])
        ]
      })
        .sort({ createdAt: -1 })
        .limit(3)
        .select("title message type createdAt")
        .lean(),

      // محاولات الاختبارات
      QuizAttempt.find({ student: req.user.id })
        .select("score maxScore")
        .lean()
    ]);

    // حساب الواجبات المعلّقة (لم يُسلَّم)
    const submittedAssignmentIds = new Set(mySubmissions.map(s => s.assignment.toString()));
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
        avgQuizScore
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
