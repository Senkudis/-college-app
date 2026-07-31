const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const batch = require("../middleware/batch.middleware");
const User = require("../models/User");
const Subject = require("../models/Subject");
const Assignment = require("../models/Assignment");
const Notification = require("../models/Notification");
const AcademicEvent = require("../models/AcademicEvent");
const Attendance = require("../models/Attendance");
const Batch = require("../models/Batch");
const { success, serverError } = require("../utils/response");

router.get("/overview", auth, batch, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name roles batch batches points").lean();
    const now = new Date();
    const notificationFilter = {
      $and: [
        { $or: [{ batches: { $size: 0 } }, { batches: req.activeBatch }, { recipients: req.user.id }] },
        { readBy: { $ne: req.user.id } }
      ]
    };
    const [activeBatch, subjects, assignments, events, notifications, studentCount] = await Promise.all([
      Batch.findById(req.activeBatch).select("name code themeColor").lean(),
      Subject.countDocuments({ batches: req.activeBatch }),
      Assignment.find({ batches: req.activeBatch, dueDate: { $gte: now } }).populate("subject", "name").sort({ dueDate: 1 }).limit(5).lean(),
      AcademicEvent.find({ batch: req.activeBatch, startsAt: { $gte: now } }).populate("subject", "name").sort({ startsAt: 1 }).limit(5).lean(),
      Notification.find(notificationFilter).sort({ type: -1, createdAt: -1 }).limit(4).select("title message type createdAt").lean(),
      User.countDocuments({ roles: { $in: ["student", "leader"] }, batch: req.activeBatch })
    ]);

    let attendance = null;
    if (user.roles.includes("student")) {
      const records = await Attendance.find({ "students.student": user._id }).select("students").lean();
      let present = 0;
      records.forEach(record => {
        const entry = record.students.find(item => item.student.toString() === user._id.toString());
        if (entry?.status === "present") present += 1;
      });
      attendance = { present, total: records.length, rate: records.length ? Math.round((present / records.length) * 100) : null };
    }

    success(res, {
      overview: {
        user: { name: user.name, roles: user.roles, points: user.points || 0 },
        batch: activeBatch,
        metrics: { subjects, studentCount, upcomingAssignments: assignments.length, unreadNotifications: notifications.length, attendance },
        upcoming: { assignments, events, notifications }
      }
    });
  } catch (err) {
    serverError(res, err, "جلب ملخص الحرم الأكاديمي");
  }
});

module.exports = router;
