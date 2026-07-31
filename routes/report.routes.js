const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const authMiddleware = require("../middleware/auth.middleware");

const User = require("../models/User");
const Subject = require("../models/Subject");
const Attendance = require("../models/Attendance");
const QuizAttempt = require("../models/QuizAttempt");
const ActivityLog = require("../models/ActivityLog");
const Batch = require("../models/Batch");
const { success, serverError } = require("../utils/response");

router.get("/summary", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const isDean = user.roles.includes("dean") || user.roles.includes("admin");
    const isDoctor = user.roles.includes("doctor");
    const isLeader = user.roles.includes("leader");
    const isStudent = user.roles.includes("student");

    /* نطاق الدفعة لغير العميد.
       تحذير: Mongoose يحذف المفاتيح ذات القيمة undefined، لذا كان
       { batch: undefined } يتحول إلى {} فتتسع الاستعلامات لتشمل الكلية كلها —
       أي أن دكتوراً بلا دفعة محددة كان يرى إحصاءات كل الطلاب وجدولهم
       بأسمائهم وبريدهم. لذلك نتعامل مع غياب الدفعة صراحةً. */
    let batchScope = null;
    if (!isDean) {
      if (isDoctor) {
        const batchId = req.headers["x-batch-id"];
        if (batchId && mongoose.Types.ObjectId.isValid(batchId)) {
          batchScope = new mongoose.Types.ObjectId(batchId);
        }
      } else if (isLeader || isStudent) {
        if (user.batch && mongoose.Types.ObjectId.isValid(user.batch)) {
          batchScope = new mongoose.Types.ObjectId(user.batch);
        }
      }
    }

    // غير العميد وبلا دفعة: لا نُرجع بيانات على مستوى الكلية إطلاقاً
    if (!isDean && !batchScope && !isStudent) {
      return success(res, {
        totalStudents: 0,
        totalSubjects: 0,
        avgAttendance: 0,
        attendanceChartData: [],
        totalQuizzes: 0,
        videoViews: 0,
        logins: 0,
        studentsTable: [],
        scopeMissing: true // للواجهة: اطلب من المستخدم اختيار دفعة
      });
    }

    // مرشّح الدفعة يُدرَج فقط عند وجود نطاق فعلي
    const batchFilter = batchScope ? { batch: batchScope } : {};

    // العميد وحده يرى أرقام الكلية كلها؛ غيره يحتاج نطاق دفعة
    const hasCollegeWideAccess = isDean;
    const canCount = hasCollegeWideAccess || !!batchScope;

    // 1. Basic Counts
    const totalStudents = canCount
      ? await User.countDocuments({ roles: { $in: ["student", "leader"] }, ...batchFilter })
      : 0;
    const totalSubjects = hasCollegeWideAccess
      ? await Subject.countDocuments({})
      : (isDoctor ? await Subject.countDocuments({ doctor: user._id })
                  : (batchScope ? await Subject.countDocuments({ batches: batchScope }) : 0));

    // 2. Attendance Stats — نستخدم aggregate لتجنب تحميل كل السجلات في الذاكرة
    const attMatch = isStudent
      ? { student: new mongoose.Types.ObjectId(user._id) }
      : batchFilter;

    // حساب الإجماليات بـ aggregate بدلاً من find() لتحسين الأداء
    const [attStatsResult] = await Attendance.aggregate([
      { $match: attMatch },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } }
      }}
    ]);
    const totalRecords = attStatsResult?.total || 0;
    const totalAttended = attStatsResult?.present || 0;
    const avgAttendance = totalRecords > 0 ? Math.round((totalAttended / totalRecords) * 100) : 0;

    // بيانات الرسم البياني: آخر 7 أيام فقط
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentAttMatch = { ...attMatch, date: { $gte: sevenDaysAgo } };
    const recentAtt = await Attendance.aggregate([
      { $match: recentAttMatch },
      { $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } }
      }},
      { $sort: { _id: 1 } },
      { $limit: 7 }
    ]);
    const attendanceChartData = recentAtt.map(d => ({
      date: d._id,
      rate: d.total > 0 ? Math.round((d.present / d.total) * 100) : 0
    }));

    // 3. Quiz / Engagement Stats
    const quizMatch = isStudent ? { student: new mongoose.Types.ObjectId(user._id) } : {};
    const totalQuizzes = await QuizAttempt.countDocuments(quizMatch);

    const activityMatch = isStudent ? { user: new mongoose.Types.ObjectId(user._id) } : batchFilter;
    const activityLogs = await ActivityLog.aggregate([
      { $match: activityMatch },
      { $group: { _id: "$action", count: { $sum: 1 } } }
    ]);

    let videoViews = 0;
    let logins = 0;
    activityLogs.forEach(log => {
      if (log._id === "VIDEO_VIEWED") videoViews = log.count;
      if (log._id === "USER_LOGIN") logins = log.count;
    });

    // 4. Students Table Data (for export)
    let studentsTable = [];
    if (!isStudent) {
      const usersMatch = { roles: "student", ...batchFilter };
      const students = await User.find(usersMatch).select("name email batch").populate("batch", "name").limit(200).lean();

      const attendanceAgg = await Attendance.aggregate([
        { $match: batchFilter },
        { $group: { _id: "$student", total: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } } } }
      ]);
      const attMap = {};
      attendanceAgg.forEach(a => {
         if (a && a._id) {
            attMap[a._id.toString()] = Math.round((a.present / a.total) * 100);
         }
      });

      studentsTable = students.map(s => ({
        id: s._id,
        name: s.name,
        email: s.email,
        batchName: s.batch ? s.batch.name : "غير محدد",
        attendanceRate: attMap[s._id.toString()] || 0
      }));
    } else {
      studentsTable = [{
        id: user._id,
        name: user.name,
        email: user.email,
        batchName: "دفعتي",
        attendanceRate: avgAttendance
      }];
    }

    success(res, {
      totalStudents,
      totalSubjects,
      avgAttendance,
      attendanceChartData,
      totalQuizzes,
      videoViews,
      logins,
      studentsTable
    });

  } catch (error) {
    serverError(res, error, "استخراج التقارير");
  }
});

module.exports = router;
