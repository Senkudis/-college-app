const router = require("express").Router();
const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const { verifySubjectAccess } = require("../middleware/ownership.middleware");

// جلب قائمة الطلاب لتسجيل الحضور
router.get("/students", auth, role("dean", "doctor", "leader", "admin"), async (req, res, next) => {
  if (req.query.subject) {
    return verifySubjectAccess(req, res, next);
  }
  next();
}, async (req, res) => {
  try {
    const { subject } = req.query;
    let filter = { roles: { $in: ["student", "leader"] }, isActive: true, deletedAt: null };
    
    if (subject) {
      const subj = req.subject; // تم تعيينها بواسطة الميدل وير
      if (subj && subj.batches && subj.batches.length > 0) {
        filter.batch = { $in: subj.batches };
      }
    }
    
    const students = await User.find(filter).select("name email batch").populate("batch", "name code");
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: "فشل جلب الطلاب" });
  }
});

// تسجيل أو تحديث الحضور
router.post("/", auth, role("dean", "doctor", "leader", "admin"), verifySubjectAccess, async (req, res) => {
  const { subject, date, students } = req.body;
  try {

    const attendance = await Attendance.findOneAndUpdate(
      { subject, date, recordedBy: req.user.id },
      { students },
      { upsert: true, returnDocument: 'after' }
    );
    res.json(attendance);
  } catch (err) {
    res.status(400).json({ message: "فشل تسجيل الحضور" });
  }
});

// جلب سجلات الحضور الخاصة بالمستخدم الحالي
router.get("/history", auth, role("student", "dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    if (req.user.roles.includes("student")) {
      // للطالب: جلب جميع الأيام التي سُجل فيها حضوره أو غيابه
      const records = await Attendance.find({ "students.student": req.user.id })
        .populate("subject", "name")
        .sort({ date: -1 });
        
      const history = records.map(record => {
        const studentRecord = record.students.find(s => s.student.toString() === req.user.id);
        return {
          _id: record._id,
          date: record.date,
          subject: record.subject,
          status: studentRecord ? studentRecord.status : "absent"
        };
      });
      return res.json(history);
    } else {
      // للمسؤولين/الأساتذة: جلب السجلات التي قاموا بتسجيلها
      const history = await Attendance.find({ recordedBy: req.user.id })
        .populate("subject", "name")
        .sort({ date: -1 });
      return res.json(history);
    }
  } catch (err) {
    res.status(500).json({ message: "فشل جلب سجلات الحضور" });
  }
});

// ملخص حضور طالب محدد (dean/doctor/leader أو الطالب نفسه)
router.get("/summary/:studentId", auth, async (req, res) => {
  try {
    const { studentId } = req.params;
    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    const isDoctorOrLeader = req.user.roles.includes("doctor") || req.user.roles.includes("leader");
    const isSelf = req.user.id === studentId;

    if (!isDeanOrAdmin && !isDoctorOrLeader && !isSelf) {
      return res.status(403).json({ success: false, message: "ليس لديك صلاحية الوصول" });
    }

    // جلب جميع سجلات الحضور التي يظهر فيها الطالب
    const records = await Attendance.find({ "students.student": studentId })
      .populate("subject", "name code")
      .lean();

    let totalSessions = 0;
    let presentCount = 0;
    const bySubject = {};

    for (const record of records) {
      const studentEntry = record.students.find(s => s.student.toString() === studentId);
      const status = studentEntry ? studentEntry.status : "absent";
      const subjectId = record.subject?._id?.toString();
      const subjectName = record.subject?.name || "غير محدد";

      if (!bySubject[subjectId]) {
        bySubject[subjectId] = { name: subjectName, total: 0, present: 0 };
      }
      bySubject[subjectId].total++;
      totalSessions++;
      if (status === "present") {
        bySubject[subjectId].present++;
        presentCount++;
      }
    }

    const overallRate = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : null;
    const isAtRisk = overallRate !== null && overallRate < 75;

    const subjectBreakdown = Object.values(bySubject).map(s => ({
      ...s,
      rate: s.total > 0 ? Math.round((s.present / s.total) * 100) : null
    }));

    return res.json({
      success: true,
      studentId,
      totalSessions,
      presentCount,
      absentCount: totalSessions - presentCount,
      overallRate,
      isAtRisk,
      threshold: 75,
      bySubject: subjectBreakdown
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل جلب ملخص الحضور" });
  }
});

// تقرير حضور كامل لدفعة (dean/doctor/leader) مع كشف الطلاب المنذرين
router.get("/batch-report", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const { batchId } = req.query;
    if (!batchId) {
      return res.status(400).json({ success: false, message: "معرف الدفعة مطلوب" });
    }
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      return res.status(400).json({ success: false, message: "معرف الدفعة غير صالح" });
    }

    /* التحقق من ملكية الدفعة: المسار كان يقبل أي batchId من الطلب، فيستطيع
       أي دكتور أو ليدر سحب تقرير حضور دفعة لا يُدرّسها بأسماء طلابها
       وبريدهم. العميد والمسؤول وحدهما يريان كل الدفعات. */
    const isDeanLevel = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    if (!isDeanLevel) {
      const me = await User.findById(req.user.id).select("batch batches").lean();
      const owned = [
        ...(me?.batches || []).map(b => b && b.toString()),
        me?.batch && me.batch.toString()
      ].filter(Boolean);
      if (!owned.includes(batchId.toString())) {
        return res.status(403).json({ success: false, message: "غير مصرح لك بتقرير هذه الدفعة" });
      }
    }

    const students = await User.find({
      batch: batchId,
      roles: { $in: ["student", "leader"] },
      isActive: true
    }).select("name email").lean();

    const studentIds = students.map(s => s._id.toString());
    const records = await Attendance.find({
      "students.student": { $in: studentIds }
    }).lean();

    const statsMap = {};
    for (const student of students) {
      statsMap[student._id.toString()] = { student, total: 0, present: 0 };
    }

    for (const record of records) {
      for (const entry of record.students) {
        const sid = entry.student.toString();
        if (!statsMap[sid]) continue;
        statsMap[sid].total++;
        if (entry.status === "present") statsMap[sid].present++;
      }
    }

    const results = Object.values(statsMap).map(item => {
      const rate = item.total > 0 ? Math.round((item.present / item.total) * 100) : null;
      return {
        student: item.student,
        totalSessions: item.total,
        presentCount: item.present,
        attendanceRate: rate,
        isAtRisk: rate !== null && rate < 75
      };
    }).sort((a, b) => (a.attendanceRate ?? 100) - (b.attendanceRate ?? 100));

    const atRisk = results.filter(r => r.isAtRisk);

    return res.json({
      success: true,
      batchId,
      totalStudents: students.length,
      atRiskCount: atRisk.length,
      threshold: 75,
      students: results,
      atRiskStudents: atRisk
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل جلب تقرير الحضور" });
  }
});

// جلب سجل حضور محدد
router.get("/:id", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id)
      .populate("subject", "name")
      .populate("students.student", "name email");
    res.json(record);
  } catch (err) {
    res.status(404).json("Record not found");
  }
});

module.exports = router;
