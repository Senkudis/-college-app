/**
 * video.routes.js — Chunked Resumable Upload + Streaming + CRUD
 * 
 * Optimized for Sudan's low-bandwidth, unstable internet:
 *   - 5MB chunk uploads with resume capability
 *   - Range-based video streaming for seeking
 *   - Direct download endpoints for offline viewing
 */

const router   = require("express").Router();
const mongoose = require("mongoose");
const multer   = require("multer");
const path     = require("path");
const fs       = require("fs");
const crypto   = require("crypto");

const Video        = require("../models/Video");
const Notification = require("../models/Notification");
const auth         = require("../middleware/auth.middleware");
const role         = require("../middleware/role.middleware");
const batchMiddleware = require("../middleware/batch.middleware");
const { processVideo } = require("../utils/transcode");
const { logActivity } = require("../utils/activityLogger");

// ===== Constants =====
const CHUNK_SIZE     = 5 * 1024 * 1024; // 5MB per chunk
const MAX_FILE_SIZE  = 2 * 1024 * 1024 * 1024; // 2GB max total
const CHUNKS_DIR     = path.join(__dirname, "..", "uploads", "chunks");
const VIDEOS_DIR     = path.join(__dirname, "..", "uploads", "videos");

// Ensure directories exist
[CHUNKS_DIR, VIDEOS_DIR].forEach(dir => fs.mkdirSync(dir, { recursive: true }));

// Multer for single chunk uploads (stored temporarily)
const chunkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(CHUNKS_DIR, req.params.uploadId);
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const chunkIndex = parseInt(req.body.chunkIndex || "0");
    cb(null, `chunk-${chunkIndex}`);
  }
});

const uploadChunk = multer({
  storage: chunkStorage,
  limits: { fileSize: CHUNK_SIZE + (512 * 1024) } // 5MB + 512KB overhead
});


// ============================================================
//  1. INITIALIZE CHUNKED UPLOAD
// ============================================================
router.post("/init-upload", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const { title, description, subject, batches, fileName, fileSize, totalChunks, mimeType } = req.body;

    // batches now optional — if empty/undefined, video is for all batches
    if (!title || !subject || !fileSize || !totalChunks) {
      return res.status(400).json({ success: false, message: "البيانات المطلوبة ناقصة (العنوان، المادة، حجم الملف، عدد القطع)" });
    }

    if (fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({ success: false, message: "حجم الملف يتجاوز الحد الأقصى (2GB)" });
    }

    const allowedExts = /\.(mp4|mov|avi|wmv|flv|mkv|webm)$/i;
    if (fileName && !allowedExts.test(fileName)) {
      return res.status(400).json({ success: false, message: "صيغة الملف غير مسموح بها. الرجاء رفع فيديو فقط." });
    }

    // Generate unique upload ID
    const uploadId = crypto.randomBytes(16).toString("hex");

    const video = await Video.create({
      title: title.trim(),
      description: (description || "").trim(),
      subject,
      batches: batches || [], // empty array = all batches
      uploadedBy: req.user.id,
      uploadId,
      originalFilename: fileName || "video.mp4",
      fileSize: parseInt(fileSize),
      totalChunks: parseInt(totalChunks),
      uploadedChunks: [],
      status: "uploading",
      mimeType: mimeType || "video/mp4"
    });

    res.json({
      success: true,
      uploadId,
      videoId: video._id,
      chunkSize: CHUNK_SIZE,
      message: "تم تهيئة الرفع بنجاح"
    });
  } catch (err) {
    console.error("Init upload error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ في تهيئة الرفع" });
  }
});


// ============================================================
//  2. UPLOAD A SINGLE CHUNK
// ============================================================
router.post("/upload-chunk/:uploadId", auth, role("dean", "doctor", "leader", "admin"), uploadChunk.single("chunk"), async (req, res) => {
  try {
    const { uploadId } = req.params;
    const chunkIndex = parseInt(req.body.chunkIndex);

    if (isNaN(chunkIndex) || chunkIndex < 0) {
      return res.status(400).json({ success: false, message: "رقم القطعة غير صالح" });
    }

    const video = await Video.findOne({ uploadId, uploadedBy: req.user.id });
    if (!video) {
      return res.status(404).json({ success: false, message: "جلسة الرفع غير موجودة" });
    }

    if (video.status !== "uploading") {
      return res.status(400).json({ success: false, message: "الرفع اكتمل أو قيد المعالجة" });
    }

    // Track uploaded chunk (avoid duplicates)
    if (!video.uploadedChunks.includes(chunkIndex)) {
      video.uploadedChunks.push(chunkIndex);
      video.uploadedChunks.sort((a, b) => a - b);
      await video.save();
    }

    res.json({
      success: true,
      received: chunkIndex,
      totalUploaded: video.uploadedChunks.length,
      totalChunks: video.totalChunks,
      progress: Math.round((video.uploadedChunks.length / video.totalChunks) * 100)
    });
  } catch (err) {
    console.error("Chunk upload error:", err);
    res.status(500).json({ success: false, message: "فشل رفع القطعة" });
  }
});


// ============================================================
//  3. CHECK UPLOAD STATUS (for resume)
// ============================================================
router.get("/upload-status/:uploadId", auth, async (req, res) => {
  try {
    const video = await Video.findOne({ uploadId: req.params.uploadId });
    if (!video) {
      return res.status(404).json({ success: false, message: "جلسة الرفع غير موجودة" });
    }

    res.json({
      success: true,
      uploadId: video.uploadId,
      status: video.status,
      uploadedChunks: video.uploadedChunks,
      totalChunks: video.totalChunks,
      progress: video.totalChunks > 0
        ? Math.round((video.uploadedChunks.length / video.totalChunks) * 100)
        : 0
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل التحقق من حالة الرفع" });
  }
});


// ============================================================
//  4. FINALIZE UPLOAD — Merge chunks + trigger transcoding
// ============================================================
router.post("/finalize/:uploadId", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const video = await Video.findOne({ uploadId: req.params.uploadId, uploadedBy: req.user.id });
    if (!video) {
      return res.status(404).json({ success: false, message: "جلسة الرفع غير موجودة" });
    }

    if (video.status !== "uploading") {
      return res.status(400).json({ success: false, message: "تم إنهاء هذا الرفع مسبقاً" });
    }

    // Verify all chunks received
    if (video.uploadedChunks.length < video.totalChunks) {
      return res.status(400).json({
        success: false,
        message: `لم يتم استلام جميع القطع (${video.uploadedChunks.length}/${video.totalChunks})`,
        uploadedChunks: video.uploadedChunks
      });
    }

    // ===== Merge chunks into single file =====
    const chunkDir = path.join(CHUNKS_DIR, video.uploadId);
    const videoDir = path.join(VIDEOS_DIR, video.uploadId);
    fs.mkdirSync(videoDir, { recursive: true });

    const ext = path.extname(video.originalFilename) || ".mp4";
    const originalPath = path.join(videoDir, `original${ext}`);
    const writeStream  = fs.createWriteStream(originalPath);

    for (let i = 0; i < video.totalChunks; i++) {
      const chunkPath = path.join(chunkDir, `chunk-${i}`);
      if (!fs.existsSync(chunkPath)) {
        writeStream.close();
        return res.status(400).json({ success: false, message: `القطعة ${i} مفقودة` });
      }
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }

    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // Get original file size
    const originalStats = fs.statSync(originalPath);

    // Update video with original file info
    video.status = "processing";
    video.variants.original = {
      path: originalPath,
      size: originalStats.size,
      resolution: "original"
    };
    await video.save();

    // Clean up chunks directory
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (e) {
      console.warn("Failed to clean chunks dir:", e.message);
    }

    // Respond immediately — transcoding happens in background
    res.json({
      success: true,
      message: "تم دمج الملف بنجاح. جاري المعالجة...",
      videoId: video._id,
      status: "processing"
    });

    // ===== Background transcoding (fire and forget) =====
    (async () => {
      try {
        // console.log(`🎬 Starting background transcoding for: ${video.title}`);
        const results = await processVideo(originalPath, videoDir);

        video.duration = results.duration;
        video.thumbnailPath = results.thumbnailPath;

        if (results.low.path) {
          video.variants.low = {
            path: results.low.path,
            size: results.low.size,
            resolution: "360p"
          };
        }

        if (results.audioOnly.path) {
          video.variants.audioOnly = {
            path: results.audioOnly.path,
            size: results.audioOnly.size,
            format: "mp3"
          };
        }

        video.status = "ready";
        await video.save();
        // console.log(`✅ Video ready: ${video.title}`);

// Send notification to students (target specific batches or all if empty)
        try {
          let targetStudents;
          if (video.batches && video.batches.length > 0) {
            targetStudents = await User.find({ roles: { $in: ["student", "leader"] }, batch: { $in: video.batches } }).select("_id");
          } else {
            // All students if no specific batches
            targetStudents = await User.find({ roles: { $in: ["student", "leader"] } }).select("_id");
          }

          if (targetStudents.length) {
            await Notification.create({
              title: "محاضرة مسجلة جديدة",
              message: `تم رفع محاضرة جديدة: ${video.title}`,
              type: "normal",
              target: "students",
              recipients: targetStudents.map(s => s._id),
              batches: video.batches || [],
              createdBy: video.uploadedBy || req.user?.id
            }).catch(e => console.error("Notification Error:", e));
          }
        } catch (notifErr) {
          console.error("Failed to create video notification:", notifErr.message);
        }
      } catch (err) {
        console.error("Transcoding failed:", err);
        video.status = "failed";
        await video.save();
      }
    })();

  } catch (err) {
    console.error("Finalize error:", err);
    res.status(500).json({ success: false, message: "فشل إنهاء الرفع" });
  }
});

// ============================================================
//  5. GET ALL VIDEOS (Library)
// ============================================================
router.get("/", auth, batchMiddleware, async (req, res) => {
  try {
    const filter = { status: { $in: ["ready", "processing"] }, batches: req.activeBatch };
    
    // Only show uploading/failed to the uploader
    if (req.query.mine === "true") {
      filter.uploadedBy = req.user.id;
      delete filter.status; // show all statuses for own videos
    } else if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      // Filter by doctor's subjects to avoid seeing filler materials
      const Subject = require("../models/Subject");
      const mySubjects = await Subject.find({ doctor: req.user.id }).select("_id");
      filter.subject = { $in: mySubjects.map(s => s._id) };
    }

    const videos = await Video.find(filter)
      .populate("subject", "name")
      .populate("uploadedBy", "name")
      .sort({ createdAt: -1 })
      .select("-uploadedChunks -variants.original.path -variants.low.path -variants.audioOnly.path");

    res.json({ success: true, videos });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل تحميل الفيديوهات" });
  }
});


// ============================================================
//  6. VIDEOS BY SUBJECT
// ============================================================
router.get("/by-subject/:subjectId", auth, batchMiddleware, async (req, res) => {
  try {
    const { subjectId } = req.params;
    if (!subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
      return res.json({ success: true, videos: [] });
    }

    const videos = await Video.find({ subject: subjectId, status: "ready", batches: req.activeBatch })
      .populate("uploadedBy", "name")
      .sort({ createdAt: -1 })
      .select("-uploadedChunks -variants.original.path -variants.low.path -variants.audioOnly.path");

    res.json({ success: true, videos });
  } catch (err) {
    res.json({ success: true, videos: [] });
  }
});


// ============================================================
//  7. GET SINGLE VIDEO DETAILS
// ============================================================
// ============================================================
//  7b. GET VIDEO STATUS — Used for polling after upload (no batch filter)
// ============================================================
router.get("/status/:id", auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "معرف الفيديو غير صالح" });
    }
    // Only the uploader or a dean can poll status
    const video = await Video.findOne({
      _id: req.params.id,
      $or: [
        { uploadedBy: req.user.id },
        // allow dean or admin full access
        ...(req.user.roles.includes('dean') || req.user.roles.includes('admin') ? [{}] : [])
      ]
    }).select("status title duration variants thumbnailPath");

    if (!video) {
      return res.status(404).json({ success: false, message: "الفيديو غير موجود" });
    }
    res.json({
      success: true,
      video: {
        _id: video._id,
        status: video.status,
        title: video.title,
        duration: video.duration,
        hasOriginal: !!video.variants?.original?.path,
        hasLowRes: !!video.variants?.low?.path,
        hasAudio: !!video.variants?.audioOnly?.path,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل التحقق من حالة الفيديو" });
  }
});


// ============================================================
//  7. GET A SINGLE VIDEO
// ============================================================
router.get("/:id", auth, batchMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "معرف الفيديو غير صالح" });
    }

    const video = await Video.findOne({ _id: req.params.id, batches: req.activeBatch })
      .populate("subject", "name")
      .populate("uploadedBy", "name");

    if (!video) {
      return res.status(404).json({ success: false, message: "الفيديو غير موجود" });
    }

    // زيادة المشاهدات وتسجيل النشاط
    Video.findByIdAndUpdate(video._id, { $inc: { views: 1 } }).exec();
    logActivity(req.user.id, "VIDEO_VIEWED", { videoId: video._id, title: video.title });

    // Build public response (hide internal paths)
    const data = {
      _id: video._id,
      title: video.title,
      description: video.description,
      subject: video.subject,
      uploadedBy: video.uploadedBy,
      status: video.status,
      duration: video.duration,
      createdAt: video.createdAt,
      hasOriginal: !!video.variants.original.path,
      hasLowRes: !!video.variants.low.path,
      hasAudio: !!video.variants.audioOnly.path,
      hasThumbnail: !!video.thumbnailPath,
      originalSize: video.variants.original.size,
      lowSize: video.variants.low.size,
      audioSize: video.variants.audioOnly.size,
      chapters: video.chapters || [],
      views: video.views || 0,
      commentsCount: video.commentsCount || 0
    };

    res.json({ success: true, data: { video: data } });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل تحميل بيانات الفيديو" });
  }
});


// ============================================================
//  8. STREAM VIDEO (Range support for seeking)
// ============================================================
router.get("/:id/stream/:variant", auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || (video.status !== "ready" && video.status !== "processing")) {
      return res.status(404).json({ success: false, message: "الفيديو غير متاح" });
    }

    const variant = req.params.variant; // "original", "low", or "audio"
    let filePath, contentType;

    if (variant === "low" && video.variants.low.path) {
      filePath = video.variants.low.path;
      contentType = "video/mp4";
    } else if (variant === "audio" && video.variants.audioOnly.path) {
      filePath = video.variants.audioOnly.path;
      contentType = "audio/mpeg";
    } else if (video.variants.original.path) {
      filePath = video.variants.original.path;
      contentType = video.mimeType || "video/mp4";
    } else {
      return res.status(404).json({ success: false, message: "الملف غير موجود" });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "الملف غير موجود على الخادم" });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    // Range header for seeking (HTTP 206 Partial Content)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end   = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range":  `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges":  "bytes",
        "Content-Length":  chunkSize,
        "Content-Type":   contentType
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type":  contentType,
        "Accept-Ranges": "bytes"
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error("Stream error:", err);
    res.status(500).json({ success: false, message: "فشل تشغيل الفيديو" });
  }
});


// ============================================================
//  9. DOWNLOAD VIDEO (specific variant)
// ============================================================
router.get("/:id/download/:variant", auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || video.status !== "ready") {
      return res.status(404).json({ success: false, message: "الفيديو غير متاح" });
    }

    const variant = req.params.variant;
    let filePath, downloadName;

    const safeTitle = video.title.replace(/[^\u0600-\u06FFa-zA-Z0-9\s_-]/g, "").trim() || "video";

    if (variant === "low" && video.variants.low.path) {
      filePath = video.variants.low.path;
      downloadName = `${safeTitle}_360p.mp4`;
    } else if (variant === "audio" && video.variants.audioOnly.path) {
      filePath = video.variants.audioOnly.path;
      downloadName = `${safeTitle}_audio.mp3`;
    } else if (variant === "original" && video.variants.original.path) {
      filePath = video.variants.original.path;
      const ext = path.extname(video.originalFilename) || ".mp4";
      downloadName = `${safeTitle}${ext}`;
    } else {
      return res.status(404).json({ success: false, message: "النسخة المطلوبة غير متاحة" });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "الملف غير موجود على الخادم" });
    }

    res.download(filePath, downloadName);
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل التحميل" });
  }
});


// ============================================================
//  10. THUMBNAIL
// ============================================================
router.get("/:id/thumbnail", async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || !video.thumbnailPath || !fs.existsSync(video.thumbnailPath)) {
      // Return a placeholder SVG
      res.set("Content-Type", "image/svg+xml");
      return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
        <rect fill="#1e293b" width="640" height="360"/>
        <text fill="#64748b" font-family="sans-serif" font-size="48" x="50%" y="50%" dominant-baseline="middle" text-anchor="middle">🎬</text>
      </svg>`);
    }
    res.sendFile(video.thumbnailPath);
  } catch (err) {
    res.status(404).end();
  }
});


// ============================================================
//  11. DELETE VIDEO
// ============================================================
router.delete("/:id", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ success: false, message: "الفيديو غير موجود" });
    }

    // Delete files from disk
    const videoDir = path.join(VIDEOS_DIR, video.uploadId);
    try {
      if (fs.existsSync(videoDir)) {
        fs.rmSync(videoDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn("Failed to delete video files:", e.message);
    }

    // Delete chunk directory if it still exists
    const chunkDir = path.join(CHUNKS_DIR, video.uploadId);
    try {
      if (fs.existsSync(chunkDir)) {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      }
    } catch (e) {}

    // Delete from DB
    await Video.findByIdAndDelete(req.params.id);

    // Also delete associated comments
    const VideoComment = require("../models/VideoComment");
    await VideoComment.deleteMany({ video: req.params.id });

    res.json({ success: true, message: "تم حذف الفيديو بنجاح" });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل حذف الفيديو" });
  }
});


// ============================================================
//  12. UPDATE VIDEO METADATA (title, description)
// ============================================================
router.put("/:id", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ success: false, message: "الفيديو غير موجود" });
    }

    const { title, description } = req.body;
    if (title) video.title = title.trim();
    if (description !== undefined) video.description = description.trim();
    await video.save();

    res.json({ success: true, message: "تم تحديث الفيديو", video });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل تحديث الفيديو" });
  }
});


// ============================================================
//  13. MANAGE CHAPTERS (replace entire chapters array)
// ============================================================
router.put("/:id/chapters", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ success: false, message: "الفيديو غير موجود" });
    }

    const { chapters } = req.body; // [{title, time}, ...]
    if (!Array.isArray(chapters)) {
      return res.status(400).json({ success: false, message: "البيانات غير صحيحة" });
    }

    // Validate and sort by time
    video.chapters = chapters
      .filter(c => c.title && typeof c.time === "number" && c.time >= 0)
      .map(c => ({ title: c.title.trim(), time: Math.floor(c.time) }))
      .sort((a, b) => a.time - b.time);

    await video.save();
    res.json({ success: true, message: "تم تحديث الفصول", chapters: video.chapters });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل تحديث الفصول" });
  }
});


// ============================================================
//  14. INCREMENT VIEW COUNT
// ============================================================
router.post("/:id/view", auth, async (req, res) => {
  try {
    await Video.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});


module.exports = router;

