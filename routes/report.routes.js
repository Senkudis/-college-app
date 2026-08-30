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

/* نطاق الدفعة لغير العميد — بتحقق فعلي لا بثقة في الترويسة.
   كانت المسارات تقرأ x-batch-id وتبني عليه مباشرة، فيكفي تعديل ترويسة
   واحدة ليقرأ أي دكتور تقارير دفعة لا يُدرّسها — بل ليقرأ الليدر (وهو
   طالب) كشف أي دفعة في الكلية بالأسماء والبريد وأرقام الهواتف. */
async function resolveBatchScope(user) {
  const requested = user.requestedBatchId;
  const asId = (v) => (v && mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : null);

  // الطالب والليدر: دفعتهم من قاعدة البيانات دائماً، وأي ترويسة تُتجاهَل
  if (user.roles.includes("student") || user.roles.includes("leader")) {
    return asId(user.batch);
  }

  if (user.roles.includes("doctor")) {
    const doctor = await User.findById(user.id).select("batches").lean();
    const assigned = (doctor?.batches || []).map(String);
    if (requested) {
      return assigned.includes(String(requested)) ? asId(requested) : null;
    }
    // بلا ترويسة: تُختار الدفعة تلقائياً فقط إن كانت واحدة لا لبس فيها
    return assigned.length === 1 ? asId(assigned[0]) : null;
  }

  return null;
}

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
      batchScope = await resolveBatchScope({ ...user, requestedBatchId: req.headers["x-batch-id"] });
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

    // 2. Attendance Stats
    let subjectMatch = {};
    if (batchScope) {
      const batchSubjects = await Subject.find({ batches: batchScope }).distinct('_id');
      subjectMatch.subject = { $in: batchSubjects };
    }
    if (isDoctor && !isDean) {
      const docSubjects = await Subject.find({ doctor: user._id }).distinct('_id');
      if (subjectMatch.subject) {
        const docSubjStrs = new Set(docSubjects.map(id => id.toString()));
        subjectMatch.subject = { $in: subjectMatch.subject.$in.filter(id => docSubjStrs.has(id.toString())) };
      } else {
        subjectMatch.subject = { $in: docSubjects };
      }
    }

    const studentObjId = isStudent ? new mongoose.Types.ObjectId(user._id) : null;
    const baseMatch = isStudent ? { "students.student": studentObjId } : subjectMatch;

    const [attStatsResult] = await Attendance.aggregate([
      { $match: baseMatch },
      { $unwind: "$students" },
      ...(isStudent ? [{ $match: { "students.student": studentObjId } }] : []),
      { $group: {
        _id: null,
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $eq: ["$students.status", "present"] }, 1, 0] } }
      }}
    ]);
    const totalRecords = attStatsResult?.total || 0;
    const totalAttended = attStatsResult?.present || 0;
    const avgAttendance = totalRecords > 0 ? Math.round((totalAttended / totalRecords) * 100) : 0;

    // بيانات الرسم البياني: آخر 7 أيام
    const d7 = new Date();
    d7.setDate(d7.getDate() - 7);
    const sevenDaysAgoStr = d7.toISOString().split('T')[0];

    const recentAtt = await Attendance.aggregate([
      { $match: { ...baseMatch, date: { $gte: sevenDaysAgoStr } } },
      { $unwind: "$students" },
      ...(isStudent ? [{ $match: { "students.student": studentObjId } }] : []),
      { $group: {
        _id: "$date",
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $eq: ["$students.status", "present"] }, 1, 0] } }
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
      const usersMatch = { roles: { $in: ["student", "leader"] }, ...batchFilter };
      const students = await User.find(usersMatch).select("name email batch").populate("batch", "name").limit(200).lean();
      const studentIds = students.map(s => s._id);

      const attendanceAgg = await Attendance.aggregate([
        { $match: subjectMatch },
        { $unwind: "$students" },
        { $match: { "students.student": { $in: studentIds } } },
        { $group: {
          _id: "$students.student",
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $eq: ["$students.status", "present"] }, 1, 0] } }
        }}
      ]);
      const attMap = {};
      attendanceAgg.forEach(a => {
        if (a && a._id) {
          attMap[a._id.toString()] = a.total > 0 ? Math.round((a.present / a.total) * 100) : 0;
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

    const atRiskStudents = studentsTable
      .filter(student => student.attendanceRate < 75)
      .map(student => ({ ...student, risk: student.attendanceRate < 60 ? "high" : "medium" }));

    success(res, {
      totalStudents,
      totalSubjects,
      avgAttendance,
      attendanceChartData,
      totalQuizzes,
      videoViews,
      logins,
      studentsTable,
      atRiskCount: atRiskStudents.length,
      atRiskStudents,
      healthStatus: avgAttendance >= 85 ? "good" : avgAttendance >= 75 ? "watch" : "action_required"
    });

  } catch (error) {
    serverError(res, error, "استخراج التقارير");
  }
});

/**
 * GET /api/reports/early-warning
 * تقرير الإنذار المبكر الذكي للطلاب الأكثر عرضة للتعثر الأكاديمي
 * يشمل: تراجع الحضور، تراكم الواجبات المتأخرة، وتدني نتائج الاختبارات
 */
router.get("/early-warning", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    /* الليدر مستبعد عمداً: هو طالب، والتقرير يكشف أسماء الزملاء وبريدهم
       وأرقام هواتفهم وتصنيف تعثّرهم الأكاديمي — وهذه بيانات إدارية لا
       يجوز أن يطّلع عليها زميل في المقعد المجاور. */
    const isStaff = user.roles.some(r => ["dean", "doctor", "admin"].includes(r));
    if (!isStaff) {
      return res.status(403).json({ success: false, message: "غير مصرح لك بعرض تقرير الإنذار المبكر" });
    }

    const Assignment = require("../models/Assignment");
    const StudentSubmission = require("../models/StudentSubmission");

    let batchScope = null;
    const isDean = user.roles.includes("dean") || user.roles.includes("admin");
    if (!isDean) {
      batchScope = await resolveBatchScope({ ...user, requestedBatchId: req.headers["x-batch-id"] });
      /* بلا نطاق مُتحقَّق منه لا نُرجع شيئاً: الرجوع إلى استعلام بلا مرشّح
         كان يعني كشف طلاب الكلية كلهم لمن لا يملك دفعة. */
      if (!batchScope) {
        return res.status(400).json({
          success: false,
          message: "يرجى تحديد دفعة مسندة إليك لعرض تقرير الإنذار المبكر",
          code: "BATCH_SCOPE_REQUIRED"
        });
      }
    }

    const batchFilter = batchScope ? { batch: batchScope } : {};
    const students = await User.find({
      roles: { $in: ["student", "leader"] },
      isActive: { $ne: false },
      ...batchFilter
    }).select("name email phone batch").populate("batch", "name").lean();

    if (!students.length) {
      return success(res, {
        summary: { totalAnalyzed: 0, highRisk: 0, mediumRisk: 0, lowRisk: 0 },
        students: []
      });
    }

    const studentIds = students.map(s => s._id);

    // 1. حساب الحضور لكل طالب
    /* كان هذا Attendance.find({}) — كل سجل حضور في النظام يُحمَّل إلى الذاكرة
       ثم يُفلتر بحلقة داخل حلقة (تعقيد تربيعي مع عدد الطلاب). نقصر الاستعلام
       على طلاب هذا التقرير ونترك العدّ لقاعدة البيانات. */
    const attendanceRecords = await Attendance
      .find({ "students.student": { $in: studentIds } })
      .select("students")
      .lean();

    const studentIdSet = new Set(studentIds.map(id => id.toString()));
    const attCounts = {};
    attendanceRecords.forEach(rec => {
      (rec.students || []).forEach(st => {
        const sId = st.student?.toString();
        if (sId && studentIdSet.has(sId)) {
          if (!attCounts[sId]) attCounts[sId] = { total: 0, present: 0 };
          attCounts[sId].total += 1;
          if (st.status === 'present') attCounts[sId].present += 1;
        }
      });
    });

    const attMap = {};
    Object.keys(attCounts).forEach(sId => {
      const c = attCounts[sId];
      attMap[sId] = c.total > 0 ? Math.round((c.present / c.total) * 100) : 0;
    });

    // 2. فحص الواجبات المتأخرة غير المسلمة
    const now = new Date();
    const activeAssignments = await Assignment.find({
      dueDate: { $lt: now },
      ...(batchScope ? { batches: batchScope } : {})
    }).select("_id title dueDate").lean();

    const assignmentIds = activeAssignments.map(a => a._id);
    const submissions = await StudentSubmission.find({
      student: { $in: studentIds },
      assignment: { $in: assignmentIds }
    }).select("student assignment status").lean();

    const submissionMap = new Map();
    submissions.forEach(sub => {
      if (sub && sub.student && sub.assignment) {
        const key = `${sub.student.toString()}_${sub.assignment.toString()}`;
        submissionMap.set(key, true);
      }
    });

    // 3. فحص متوسط درجات الكويزات
    const quizAttempts = await QuizAttempt.find({
      student: { $in: studentIds }
    }).select("student score totalPoints maxScore").lean();

    const quizCounts = {};
    quizAttempts.forEach(q => {
      const sId = q.student?.toString();
      if (sId) {
        const total = q.maxScore || q.totalPoints || 1;
        const pct = total > 0 ? (q.score / total) * 100 : 0;
        if (!quizCounts[sId]) quizCounts[sId] = { sumPct: 0, count: 0 };
        quizCounts[sId].sumPct += pct;
        quizCounts[sId].count += 1;
      }
    });

    const quizMap = {};
    Object.keys(quizCounts).forEach(sId => {
      const qc = quizCounts[sId];
      quizMap[sId] = qc.count > 0 ? Math.round(qc.sumPct / qc.count) : 0;
    });

    // 4. بناء تقييم المخاطر لكل طالب
    let highRiskCount = 0;
    let medRiskCount = 0;
    let lowRiskCount = 0;

    const analyzedStudents = students.map(s => {
      const sId = s._id.toString();
      const attRate = attMap[sId] !== undefined ? attMap[sId] : 100;
      const quizAvg = quizMap[sId] !== undefined ? quizMap[sId] : null;

      // حساب عدد الواجبات المتأخرة غير المسلمة
      let overdueCount = 0;
      activeAssignments.forEach(a => {
        const key = `${sId}_${a._id.toString()}`;
        if (!submissionMap.has(key)) overdueCount++;
      });

      const riskFactors = [];
      if (attRate < 60) riskFactors.push(`نسبة الحضور متدنية جداً (${attRate}%)`);
      else if (attRate < 75) riskFactors.push(`نسبة الحضور منخفضة (${attRate}%)`);

      if (overdueCount >= 3) riskFactors.push(`تراكم ${overdueCount} واجبات غير مسلّمة`);
      else if (overdueCount >= 1) riskFactors.push(`${overdueCount} واجب متأخر لم يتم تسليمه`);

      if (quizAvg !== null && quizAvg < 50) riskFactors.push(`متوسط درجات الاختبارات متدنٍ (${quizAvg}%)`);

      let riskLevel = "low";
      if (attRate < 60 || (attRate < 75 && overdueCount >= 2) || (overdueCount >= 4)) {
        riskLevel = "high";
        highRiskCount++;
      } else if (attRate < 75 || overdueCount >= 2 || (quizAvg !== null && quizAvg < 60)) {
        riskLevel = "medium";
        medRiskCount++;
      } else {
        lowRiskCount++;
      }

      return {
        id: s._id,
        name: s.name,
        email: s.email,
        phone: s.phone || "",
        batchName: s.batch ? s.batch.name : "غير محدد",
        attendanceRate: attRate,
        overdueAssignments: overdueCount,
        quizAverage: quizAvg,
        riskLevel,
        riskFactors,
        recommendedAction: riskLevel === "high" ? "تواصل عاجل من المرشد وتوجيه إنذار أكاديمي" : (riskLevel === "medium" ? "متابعة تسليم التكليفات ورصد الحضور" : "مستوى جيد ومستقر")
      };
    });

    // ترتيب النتيجة: الطلاب الأكثر خطورة أولاً
    const riskPriority = { high: 3, medium: 2, low: 1 };
    analyzedStudents.sort((a, b) => riskPriority[b.riskLevel] - riskPriority[a.riskLevel] || a.attendanceRate - b.attendanceRate);

    success(res, {
      summary: {
        totalAnalyzed: students.length,
        highRisk: highRiskCount,
        mediumRisk: medRiskCount,
        lowRisk: lowRiskCount
      },
      students: analyzedStudents
    });

  } catch (error) {
    serverError(res, error, "استخراج تقرير الإنذار المبكر");
  }
});

module.exports = router;
