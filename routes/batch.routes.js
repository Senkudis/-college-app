const router = require("express").Router();
const Batch = require("../models/Batch");
const User = require("../models/User");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");

// ==========================================
// 0. GET PUBLIC BATCHES LIST (For Registration)
// ==========================================
router.get("/public/list", async (req, res) => {
  try {
    const batches = await Batch.find({ status: { $ne: "archived" } }).select("name code _id").sort({ createdAt: -1 }).lean();
    res.json({ success: true, batches });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل جلب الدفعات" });
  }
});

// ==========================================
// 1. GET ALL BATCHES (For Dean / Leader)
// ==========================================
router.get("/", auth, role("student", "dean", "leader", "doctor", "admin"), async (req, res) => {
  try {
    let query = {};
    let batchIds = new Set();
    if ((req.user.roles.includes('student') || req.user.roles.includes('leader')) && !req.user.roles.includes('dean') && !req.user.roles.includes('admin') && !req.user.roles.includes('doctor')) query._id = req.user.batch || null;

    // If doctor, check their assigned batches (or batches linked to their subjects)
    if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      const user = await User.findById(req.user.id).select("batches").lean();
      const Subject = require("../models/Subject");
      const doctorSubjects = await Subject.find({ doctor: req.user.id }).select("batches").lean();
      
      (user?.batches || []).forEach(b => { if (b) batchIds.add(b.toString()); });
      doctorSubjects.forEach(s => {
        if (Array.isArray(s.batches)) {
          s.batches.forEach(b => { if (b) batchIds.add(b.toString()); });
        }
      });

      if (batchIds.size > 0) {
        query._id = { $in: Array.from(batchIds) };
      } else {
        query._id = { $in: [] };
      }

    }
    
    if (req.query.status) {
      if (req.query.status === "active") {
        query.status = { $in: ["active", "draft", null, undefined] };
      } else {
        query.status = req.query.status;
      }
    }

    let batches = await Batch.find(query).sort({ createdAt: -1 });

    // Fallback: If no batches found with strict filtering (or if doctor has no explicit batches yet),
    // return all system batches (non-archived) so the doctor can still select destination batches!
    if ((!batches || batches.length === 0) && (req.user.roles.includes('dean') || req.user.roles.includes('admin'))) {
      batches = await Batch.find({ status: { $ne: "archived" } }).sort({ createdAt: -1 });
    }

    res.json({ success: true, batches });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل جلب الدفعات" });
  }
});

// ==========================================
// 2. GET SINGLE BATCH INFO & ACCURATE METRICS
// ==========================================
router.get("/:id", auth, async (req, res) => {
  try {
    const roleList = req.user.roles || [];
    const studentLike = (roleList.includes('student') || roleList.includes('leader')) && !roleList.includes('dean') && !roleList.includes('admin') && !roleList.includes('doctor');
    if (studentLike && (!req.user.batch || String(req.user.batch) !== String(req.params.id))) {
      return res.status(403).json({ success: false, message: 'Batch access denied' });
    }
    if (!roleList.includes('dean') && !roleList.includes('admin') && roleList.includes('doctor')) {
      const doctor = await User.findById(req.user.id).select('batches').lean();
      const assignedBatchIds = new Set((doctor?.batches || []).map(String));
      if (!assignedBatchIds.has(String(req.params.id))) {
        const Subject = require('../models/Subject');
        const linkedSubject = await Subject.findOne({ doctor: req.user.id, batches: req.params.id }).select('_id').lean();
        if (!linkedSubject) return res.status(403).json({ success: false, message: 'Batch access denied' });
      }
    }
    const batch = await Batch.findById(req.params.id).lean();

    if (!batch) return res.status(404).json({ success: false, message: "الدفعة غير موجودة" });

    const Subject = require("../models/Subject");
    const Attendance = require("../models/Attendance");
    const Assignment = require("../models/Assignment");

    // 1. إجمالي الطلاب في الدفعة
    const students = await User.find({
      $or: [{ batch: batch._id }, { batches: batch._id }],
      roles: { $in: ["student", "leader"] }
    }).select("_id name email studentId").lean();
    const studentsCount = students.length;

    // 2. المقررات المرتبطة بالدفعة
    const subjects = await Subject.find({
      $or: [{ batch: batch._id }, { batches: batch._id }]
    }).select("_id name").lean();
    const subjectsCount = subjects.length;

    // 3. الواجبات الخاصة بالدفعة
    const subjectIds = subjects.map(s => s._id);
    const assignmentsCount = await Assignment.countDocuments({
      $or: [
        { batches: batch._id },
        { subject: { $in: subjectIds } }
      ]
    });

    // 4. إحصائيات الحضور والغياب والطلاب المنذرين
    let avgAttendanceRate = 0;
    let atRiskStudents = [];

    if (subjectIds.length > 0 && studentsCount > 0) {
      const records = await Attendance.find({ subject: { $in: subjectIds } }).lean();
      if (records.length > 0) {
        const studentStatsMap = {};
        students.forEach(s => {
          studentStatsMap[s._id.toString()] = { student: s, present: 0, total: 0 };
        });

        records.forEach(r => {
          (r.students || []).forEach(st => {
            const sid = st.student ? st.student.toString() : null;
            if (sid && studentStatsMap[sid]) {
              studentStatsMap[sid].total++;
              if (st.status === "present") studentStatsMap[sid].present++;
            }
          });
        });

        let totalPresentAll = 0;
        let totalSessionsAll = 0;

        Object.values(studentStatsMap).forEach(st => {
          if (st.total > 0) {
            totalPresentAll += st.present;
            totalSessionsAll += st.total;
            const rate = Math.round((st.present / st.total) * 100);
            if (rate < 75) {
              atRiskStudents.push({
                student: st.student,
                attendanceRate: rate,
                presentCount: st.present,
                totalSessions: st.total
              });
            }
          }
        });

        if (totalSessionsAll > 0) {
          avgAttendanceRate = Math.round((totalPresentAll / totalSessionsAll) * 100);
        }
      }
    }

    res.json({
      success: true,
      batch: {
        ...batch,
        studentsCount,
        subjectsCount,
        subjects,
        attendanceRate: avgAttendanceRate,
        atRiskStudentsCount: atRiskStudents.length,
        atRiskStudents,
        assignmentsCount
      }
    });
  } catch (err) {
    console.error("GET batch info error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ في جلب بيانات الدفعة" });
  }
});

// ==========================================
// 3. CREATE BATCH (Dean / Leader Only)
// ==========================================
router.post("/", auth, role("dean", "leader", "admin"), async (req, res) => {
  try {
    const { name, code, themeColor, inviteCode } = req.body;
    
    // Check if code already exists
    const exists = await Batch.findOne({ code: code.toUpperCase() });
    if (exists) {
      return res.status(400).json({ success: false, message: "رمز الدفعة موجود مسبقاً" });
    }

    const newBatch = new Batch({
      name,
      code: code.toUpperCase(),
      themeColor: themeColor || "#6366f1",
      inviteCode: inviteCode ? inviteCode.trim() : null,
      createdBy: req.user.id
    });

    await newBatch.save();

    // إشعار تلقائي: دفعة جديدة — للعمداء فقط
    try {
      const deans = await User.find({ roles: 'dean' }).select('_id').lean();
      if (deans.length) {
        await Notification.create({
          title: `دفعة جديدة: ${name}`,
          message: `تم إنشاء دفعة جديدة باسم "${name}" (${code.toUpperCase()})`,
          type: 'info',
          recipients: deans.map(d => d._id),
          createdBy: req.user.id
        });
      }
    } catch(e) { console.warn('Batch notif failed:', e.message); }

    res.status(201).json({ success: true, message: "تم إنشاء الدفعة بنجاح", batch: newBatch });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل إنشاء الدفعة" });
  }
});

// ==========================================
// 4. UPDATE BATCH (Dean / Leader Only)
// ==========================================
router.put("/:id", auth, role("dean", "leader", "admin"), async (req, res) => {
  try {
    const { name, code, themeColor, status, inviteCode } = req.body;
    
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ success: false, message: "الدفعة غير موجودة" });

    if (name) batch.name = name;
    if (inviteCode !== undefined) batch.inviteCode = inviteCode ? inviteCode.trim() : null;
    if (code) batch.code = code.toUpperCase();
    if (themeColor) batch.themeColor = themeColor;
    if (status) batch.status = status;

    await batch.save();
    res.json({ success: true, message: "تم تحديث الدفعة", batch });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل التحديث" });
  }
});

// ==========================================
// 5. DELETE BATCH (Dean Only)
// ==========================================
router.delete("/:id", auth, role("dean", "admin"), async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ success: false, message: "الدفعة غير موجودة" });

    // منع حذف الدفعة إذا كان فيها طلاب مسجلون
    const studentsCount = await User.countDocuments({ batch: req.params.id });
    if (studentsCount > 0) {
      return res.status(400).json({
        success: false,
        message: `لا يمكن حذف الدفعة لأنها تحتوي على ${studentsCount} طالب مسجل. قم بأرشفتها بدلاً من الحذف.`
      });
    }

    await batch.deleteOne();
    res.json({ success: true, message: "تم حذف الدفعة بنجاح" });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل حذف الدفعة" });
  }
});

module.exports = router;
