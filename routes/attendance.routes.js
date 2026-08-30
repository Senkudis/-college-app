const router = require("express").Router();
const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const Subject = require("../models/Subject");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const { verifySubjectAccess } = require("../middleware/ownership.middleware");
const { success, fail, notFound, serverError } = require("../utils/response");

function canAccessSubject(user, subject) {
  if (!subject) return false;
  if (user.roles.includes("dean") || user.roles.includes("admin")) return true;
  const subjectDoctor = subject.doctor?._id || subject.doctor;
  if (user.roles.includes("doctor")) {
    return String(subjectDoctor || "") === String(user.id);
  }
  if (user.roles.includes("leader")) {
    const leaderBatch = user.batch && String(user.batch);
    return Boolean(leaderBatch && (subject.batches || []).some(batch => String(batch?._id || batch) === leaderBatch));
  }
  return false;
}

// ── GET /api/attendance/export ──────────────────────────────────────────────
// تصدير كشف الحضور بصيغة CSV / Excel مع دعم اللغة العربية UTF-8 BOM
router.get("/export", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const { subjectId, date } = req.query;
    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    if (!isDeanOrAdmin && !subjectId) {
      return fail(res, "معرف المادة مطلوب", 400);
    }
    if (!isDeanOrAdmin && subjectId) {
      const subject = await Subject.findById(subjectId).select("doctor batches").lean();
      if (!canAccessSubject(req.user, subject)) {
        return fail(res, "غير مصرح لك بتصدير حضور هذه المادة", 403);
      }
    }
    let query = {};

    if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
      query.subject = subjectId;
    }
    if (date) {
      query.date = date;
    }

    const records = await Attendance.find(query)
      .populate('subject', 'name code')
      .populate('students.student', 'name email batch')
      .lean();

    let csv = '\uFEFFالاسم,البريد الإلكتروني,المادة,التاريخ,الحالة\n';

    records.forEach(rec => {
      const subjName = rec.subject?.name || 'مادة';
      const dateStr = rec.date ? new Date(rec.date).toLocaleDateString('ar-SD') : '';
      (rec.students || []).forEach(s => {
        const studentName = s.student?.name || 'طالب';
        const studentEmail = s.student?.email || '';
        const statusStr = s.status === 'present' ? 'حاضر' : s.status === 'late' ? 'متأخر' : 'غائب';
        csv += `"${studentName}","${studentEmail}","${subjName}","${dateStr}","${statusStr}"\n`;
      });
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance_report.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[Attendance Export] Error:', err);
    serverError(res, err, 'تصدير كشف الحضور');
  }
});

// جلب قائمة الطلاب لتسجيل الحضور
router.get("/students", auth, role("dean", "doctor", "leader", "admin"), async (req, res, next) => {
  if (req.query.subject) {
    return verifySubjectAccess(req, res, next);
  }
  next();
}, async (req, res) => {
  try {
    const { subject } = req.query;
    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    if (!subject && !isDeanOrAdmin) {
      return fail(res, "معرف المادة مطلوب", 400);
    }
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
    serverError(res, err, "جلب الطلاب لتسجيل الحضور");
  }
});

// تسجيل أو تحديث الحضور
router.post("/", auth, role("dean", "doctor", "leader", "admin"), verifySubjectAccess, async (req, res) => {
  const { subject, date, students } = req.body;
  if (!subject || !date || !Array.isArray(students)) {
    return fail(res, "المادة والتاريخ وقائمة الطلاب مطلوبة", 400);
  }
  try {
    /* المفتاح صار (المادة، التاريخ) ليطابق الفهرس الفريد الجديد: الرصد
       الثاني لنفس الحصة يحدّث السجل القائم بدل أن يُنشئ سجلاً موازياً،
       ونحتفظ بآخر من عدّله. */
    const attendance = await Attendance.findOneAndUpdate(
      { subject, date },
      { students, recordedBy: req.user.id },
      { upsert: true, returnDocument: 'after' }
    );
    res.json(attendance);
  } catch (err) {
    return serverError(res, err, "تسجيل الحضور");
  }

  /* الإشعارات في كتلة try مستقلة بعد إرسال الرد.
     كانت داخل نفس الـtry، فأي خطأ هنا (قائمة students مشوّهة مثلاً) يصل إلى
     serverError بعد أن أُرسلت الترويسات فيسقط الطلب بـ
     ERR_HTTP_HEADERS_SENT في السجل دون أن يلاحظ العميل شيئاً. */
  try {
    // ====== إشعارات الغياب — بعد إرسال الاستجابة مباشرة للتجنب التأخير ======
    // الطلاب الغائبون في هذا التسجيل
    const absentStudentIds = (students || [])
      .filter(s => s && s.status === 'absent')
      .map(s => (s.student || s.studentId || s).toString());

    if (absentStudentIds.length > 0) {
      const io = req.app?.get('io');
      // نحسب نسبة الحضور لكل طالب غائب ونرسل إشعاراً إذا تجاوز الغياب 25%
      for (const studentId of absentStudentIds) {
        try {
          const allRecords = await Attendance.find({ 'students.student': studentId }).lean();
          let total = 0, present = 0;
          for (const rec of allRecords) {
            const entry = rec.students?.find(s => s.student && s.student.toString() === studentId);
            total++;
            if (entry && entry.status === 'present') present++;
          }
          if (total === 0) continue;
          const rate = Math.round((present / total) * 100);
          const absenceRate = 100 - rate;

          // نرسل إشعاراً إذا تجاوز الغياب 25% (أي الحضور أقل من 75%)
          if (rate < 75) {
            const isWarning = rate < 60; // خطر حرج أقل من 60%
            const notif = await Notification.create({
              title: isWarning ? ' تحذير: نسبة غياب حرجة' : ' تنبيه: نسبة حضور منخفضة',
              message: `نسبة حضورك الحالية هي ${rate}% (غياب ${absenceRate}%). الحد الأدنى المطلوب 75%. يرجى الالتزام بتسجيل الحضور.`,
              type: isWarning ? 'normal' : 'normal',
              target: 'custom',
              recipients: [studentId],
              createdBy: null
            });
            if (io) {
              io.to(`user:${studentId}`).emit('notification:new', {
                _id: notif._id,
                title: notif.title,
                message: notif.message,
                type: notif.type,
                createdAt: notif.createdAt
              });
            }
          }
        } catch (notifErr) {
          // لا نفشل بسبب خطأ إشعار فردي
          console.error('[Attendance] فشل إشعار الغياب:', notifErr.message);
        }
      }
    }
  } catch (err) {
    // الرد أُرسل بالفعل — نسجّل فقط ولا نحاول الرد ثانية
    console.error('[Attendance] فشل معالجة إشعارات الغياب:', err.message);
  }
});

// جلب سجلات الحضور الخاصة بالمستخدم الحالي
router.get("/history", auth, role("student", "dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    /* الليدر طالب يحضر المحاضرات كذلك. فحص "student" وحده كان يُسقطه في
       فرع الطاقم فيرى ما رصده هو لا حضوره هو — أي أنه لم يستطع قط الاطّلاع
       على سجل غيابه رغم أن نسبته تُحتسب عليه كأي طالب. */
    const isStudentLike = req.user.roles.includes("student") || req.user.roles.includes("leader");
    if (isStudentLike) {
      // للطالب والليدر: جلب جميع الأيام التي سُجل فيها حضوره أو غيابه
      const records = await Attendance.find({ "students.student": req.user.id })
        .populate("subject", "name")
        .sort({ date: -1 });
        
      const history = records.map(record => {
        const studentRecord = (record.students || []).find(s => s.student && s.student.toString() === req.user.id);
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
    serverError(res, err, "جلب سجلات الحضور");
  }
});

// ملخص حضور طالب محدد (dean/doctor/leader أو الطالب نفسه)
router.get("/summary/:studentId", auth, async (req, res) => {
  try {
    const { studentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return fail(res, "معرف الطالب غير صالح", 400);
    }
    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    const isDoctorOrLeader = req.user.roles.includes("doctor") || req.user.roles.includes("leader");
    const isSelf = req.user.id === studentId;

    if (!isDeanOrAdmin && !isDoctorOrLeader && !isSelf) {
      return fail(res, "ليس لديك صلاحية الوصول", 403);
    }
    if (!isDeanOrAdmin && !isSelf) {
      const targetStudent = await User.findById(studentId).select("batch").lean();
      let permitted = false;
      if (req.user.roles.includes("leader")) {
        permitted = Boolean(targetStudent?.batch && req.user.batch && String(targetStudent.batch) === String(req.user.batch));
      } else if (req.user.roles.includes("doctor")) {
        const doctorSubjects = await Subject.find({ doctor: req.user.id }).select("batches").lean();
        permitted = doctorSubjects.some(subject => (subject.batches || []).some(batch => String(batch) === String(targetStudent?.batch)));
      }
      if (!permitted) return fail(res, "ليس لديك صلاحية الوصول", 403);
    }

    // جلب جميع سجلات الحضور التي يظهر فيها الطالب
    const records = await Attendance.find({ "students.student": studentId })
      .populate("subject", "name code")
      .lean();

    let totalSessions = 0;
    let presentCount = 0;
    const bySubject = {};

    for (const record of records) {
      const studentEntry = (record.students || []).find(s => s.student && s.student.toString() === studentId);
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
    serverError(res, err, "جلب ملخص الحضور");
  }
});

// تقرير حضور كامل لدفعة (dean/doctor/leader) مع كشف الطلاب المنذرين
router.get("/batch-report", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const { batchId } = req.query;
    if (!batchId) {
      return fail(res, "معرف الدفعة مطلوب", 400);
    }
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      return fail(res, "معرف الدفعة غير صالح", 400);
    }

    const isDeanLevel = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    if (!isDeanLevel) {
      const me = await User.findById(req.user.id).select("batch batches").lean();
      const owned = [
        ...(me?.batches || []).map(b => b && b.toString()),
        me?.batch && me.batch.toString()
      ].filter(Boolean);
      if (req.user.roles.includes("doctor")) {
        const doctorSubjects = await Subject.find({ doctor: req.user.id }).select("batches").lean();
        doctorSubjects.forEach(subject => {
          (subject.batches || []).forEach(batch => owned.push(batch.toString()));
        });
      }
      if (!owned.includes(batchId.toString())) {
        return fail(res, "غير مصرح لك بتقرير هذه الدفعة", 403);
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
      for (const entry of (record.students || [])) {
        if (!entry || !entry.student) continue;
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
    serverError(res, err, "جلب تقرير الحضور");
  }
});

// جلب سجل حضور محدد
router.get("/:id", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, "معرف السجل غير صالح", 400);
    }
    const record = await Attendance.findById(req.params.id)
      .populate("subject", "name doctor batches")
      .populate("students.student", "name email");
    if (!record) return notFound(res, "السجل غير موجود");
    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    if (!isDeanOrAdmin && !canAccessSubject(req.user, record.subject)) {
      return fail(res, "غير مصرح لك بهذا السجل", 403);
    }
    res.json(record);
  } catch (err) {
    serverError(res, err, "جلب سجل الحضور");
  }
});

module.exports = router;
