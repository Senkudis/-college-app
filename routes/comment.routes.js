/**
 * comment.routes.js — Timestamped Video Q&A
 * 
 * Students can ask questions linked to a specific video timestamp.
 * Clicking a timestamp seeks the video to that exact moment.
 */

const router       = require("express").Router();
const mongoose     = require("mongoose");
const VideoComment = require("../models/VideoComment");
const Video        = require("../models/Video");
const User         = require("../models/User");
const auth         = require("../middleware/auth.middleware");
const batchMiddleware = require("../middleware/batch.middleware");
const { success, fail, notFound, serverError } = require("../utils/response");
const Notification = require("../models/Notification");

// Apply batchMiddleware to all comment routes
router.use(auth, batchMiddleware);

// فيديو "كل الدفعات" (batches فارغة) يظهر في المكتبة — يجب أن يقبل التعليقات أيضاً
const inActiveBatch = (videoId, batchId) => ({
  _id: videoId,
  $or: [{ batches: batchId }, { batches: { $size: 0 } }, { batches: { $exists: false } }]
});

// ============================================================
//  1. ADD COMMENT (with optional timestamp)
// ============================================================
router.post("/:videoId/comments", async (req, res) => {
  try {
    const { videoId } = req.params;
    const { text, timestamp, parentComment } = req.body;

    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return fail(res, "معرف الفيديو غير صالح");
    }

    // Verify video exists and belongs to active batch
    const video = await Video.findOne(inActiveBatch(videoId, req.activeBatch));
    if (!video) return notFound(res, "الفيديو غير موجود في هذه الدفعة");

    if (!text || !text.trim()) {
      return fail(res, "نص التعليق مطلوب");
    }

    if (text.length > 1000) {
      return fail(res, "التعليق طويل جداً (حد أقصى 1000 حرف)");
    }

    const comment = await VideoComment.create({
      video: videoId,
      author: req.user.id,
      text: text.trim(),
      timestamp: (timestamp !== null && timestamp !== undefined && timestamp !== "")
        ? parseFloat(timestamp)
        : null,
      parentComment: parentComment && mongoose.Types.ObjectId.isValid(parentComment)
        ? parentComment
        : null
    });

    await comment.populate("author", "name");

    await Video.updateOne({_id: videoId}, { $inc: { commentsCount: 1 } });

    if (video.uploadedBy.toString() !== req.user.id) {
      /* type:"info" غير موجود في enum الإشعارات (normal|emergency) وكان
         يرمي ValidationError يبتلعه catch المسار — فلا يصل صاحب الفيديو
         أي إشعار بالتعليقات. نفس علّة target:'custom' في المسارات الأخرى. */
      try {
        await Notification.create({
          title: "تعليق جديد",
          message: `قام ${req.user.name || 'أحد الطلاب'} بالتعليق على الفيديو: ${video.title}`,
          type: "normal",
          target: "custom",
          recipients: [video.uploadedBy],
          createdBy: req.user.id
        });
      } catch (notifErr) {
        console.error("[Comments] فشل إشعار صاحب الفيديو:", notifErr.message);
      }
    }

    success(res, {
      comment: {
        _id: comment._id,
        text: comment.text,
        timestamp: comment.timestamp,
        author: comment.author,
        parentComment: comment.parentComment,
        createdAt: comment.createdAt
      }
    }, "تم إضافة التعليق");
  } catch (err) {
    serverError(res, err, "إضافة تعليق");
  }
});


// ============================================================
//  2. GET ALL COMMENTS FOR A VIDEO
// ============================================================
router.get("/:videoId/comments", async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return success(res, { comments: [] });
    }

    // Verify video belongs to active batch
    const video = await Video.findOne(inActiveBatch(videoId, req.activeBatch));
    if (!video) return notFound(res, "الفيديو غير موجود في هذه الدفعة");

    const sortBy = req.query.sort === "time" ? { timestamp: 1 } : { createdAt: -1 };

    /* إخفاء تعليقات من حظرهم المستخدم — الحظر بلا هذا الفلتر يبقى زراً
       بلا أثر، وهو ما يتحقق منه مراجع App Store عملياً (بند 1.2). */
    const me = await User.findById(req.user.id).select("blockedUsers").lean();
    const blocked = (me?.blockedUsers || []).map(String);

    const filter = { video: videoId };
    if (blocked.length) filter.author = { $nin: blocked };

    const comments = await VideoComment.find(filter)
      .populate("author", "name")
      .sort(sortBy);

    success(res, { comments });
  } catch (err) {
    serverError(res, err, "جلب التعليقات");
  }
});


// ============================================================
//  3. DELETE COMMENT (own comment or staff)
// ============================================================
router.delete("/comments/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return notFound(res, "التعليق غير موجود");
    const comment = await VideoComment.findById(req.params.id);
    if (!comment) {
      return notFound(res, "التعليق غير موجود");
    }

    /* الإشراف ضمن النطاق: كان أي دكتور أو ليدر يحذف أي تعليق في الكلية.
       الآن: صاحب التعليق، العميد/الأدمن، رافع الفيديو، أو طاقم دفعة الفيديو الحالية. */
    const isOwner = comment.author.toString() === req.user.id;
    const isDeanLevel = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    let isScopedStaff = false;
    if (!isOwner && !isDeanLevel && req.user.roles.some(r => r === "doctor" || r === "leader")) {
      const video = await Video.findOne(inActiveBatch(comment.video, req.activeBatch)).select("uploadedBy").lean();
      isScopedStaff = Boolean(video);
    }

    if (!isOwner && !isDeanLevel && !isScopedStaff) {
      return fail(res, "لا يمكنك حذف هذا التعليق", 403);
    }

    await VideoComment.findByIdAndDelete(req.params.id);
    await Video.updateOne({_id: comment.video}, { $inc: { commentsCount: -1 } });
    
    success(res, null, "تم حذف التعليق");
  } catch (err) {
    serverError(res, err, "حذف تعليق");
  }
});


module.exports = router;
