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
const auth         = require("../middleware/auth.middleware");
const batchMiddleware = require("../middleware/batch.middleware");
const { success, fail, notFound, serverError } = require("../utils/response");
const Notification = require("../models/Notification");

// Apply batchMiddleware to all comment routes
router.use(auth, batchMiddleware);

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
    const video = await Video.findOne({ _id: videoId, batches: req.activeBatch });
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
       await Notification.create({
         title: "تعليق جديد",
         message: `قام ${req.user.name || 'أحد الطلاب'} بالتعليق على الفيديو: ${video.title}`,
         type: "info",
         recipients: [video.uploadedBy]
       });
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
    const video = await Video.findOne({ _id: videoId, batches: req.activeBatch });
    if (!video) return notFound(res, "الفيديو غير موجود في هذه الدفعة");

    const sortBy = req.query.sort === "time" ? { timestamp: 1 } : { createdAt: -1 };

    const comments = await VideoComment.find({ video: videoId })
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
    const comment = await VideoComment.findById(req.params.id);
    if (!comment) {
      return notFound(res, "التعليق غير موجود");
    }

    const isOwner = comment.author.toString() === req.user.id;
    const isStaff = req.user.roles && (
      req.user.roles.includes("doctor") ||
      req.user.roles.includes("dean") ||
      req.user.roles.includes("admin") ||
      req.user.roles.includes("leader")
    );

    if (!isOwner && !isStaff) {
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
