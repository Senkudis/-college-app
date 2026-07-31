const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const User = require("../models/User");
const { success, serverError } = require("../utils/response");
const mongoose = require("mongoose");

// ========== لوحة المتصدرين ==========
router.get("/", auth, async (req, res) => {
  try {
    const batchFilter = req.query.batch && mongoose.Types.ObjectId.isValid(req.query.batch)
      ? { batch: new mongoose.Types.ObjectId(req.query.batch) }
      : {};

    const students = await User.find({ roles: { $in: ["student", "leader"] }, isActive: true, deletedAt: null, ...batchFilter })
      .select("name points batch")
      .populate("batch", "name code")
      .sort({ points: -1 })
      .limit(50)
      .lean();

    // إضافة الترتيب وتمييز المستخدم الحالي
    const leaderboard = students.map((s, index) => ({
      rank: index + 1,
      _id: s._id,
      name: s.name,
      points: s.points || 0,
      batch: s.batch,
      isCurrentUser: String(s._id) === String(req.user.id),
      medal: index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : null
    }));

    success(res, { leaderboard, total: leaderboard.length });
  } catch (err) {
    serverError(res, err, "لوحة المتصدرين");
  }
});

// ========== ترتيب المستخدم الحالي ==========
router.get("/my-rank", auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id).select("points batch").lean();
    const myPoints = me?.points || 0;

    // عدد الطلاب الذين لديهم نقاط أكثر مني
    const rank = await User.countDocuments({
      roles: { $in: ["student", "leader"] },
      isActive: true,
      deletedAt: null,
      points: { $gt: myPoints }
    });

    // إجمالي الطلاب
    const total = await User.countDocuments({
      roles: { $in: ["student", "leader"] },
      isActive: true,
      deletedAt: null
    });

    success(res, {
      rank: rank + 1,
      total,
      points: myPoints,
      percentile: total > 1 ? Math.round(((total - rank) / total) * 100) : 100
    });
  } catch (err) {
    serverError(res, err, "ترتيب الطالب");
  }
});

module.exports = router;
