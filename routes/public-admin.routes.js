const router  = require('express').Router();
const auth    = require('../middleware/auth.middleware');
const PublicNews    = require('../models/PublicNews');
const PublicGallery = require('../models/PublicGallery');
const Notification  = require('../models/Notification');
const { success, serverError } = require('../utils/response');
const upload = require('../config/multer');
const optimizeImage = require('../middleware/imageOptimizer');

// ── Middleware: أدمن أو عميد فقط ─────────────────────────────────────────
const adminOnly = [auth, (req, res, next) => {
  if (!req.user?.roles?.some(r => ['admin', 'dean'].includes(r))) {
    return res.status(403).json({ success: false, message: 'غير مصرح' });
  }
  next();
}];

// ═══════════════════════════════════════════════════════════════════════════
//  NEWS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/public/news — كل الأخبار (منشورة + مسودات)
router.get('/news', adminOnly, async (req, res) => {
  try {
    const news = await PublicNews.find()
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name')
      .lean();
    success(res, { news });
  } catch (err) { serverError(res, err, 'جلب الأخبار'); }
});

// POST /api/admin/public/news — إضافة خبر
router.post('/news', adminOnly, async (req, res) => {
  try {
    const { title, summary, body, imageUrl, tags, isPublished, publishedAt } = req.body;
    if (!title || !summary || !body) {
      return res.status(400).json({ success: false, message: 'العنوان والملخص والمحتوى مطلوبة' });
    }
    const item = await PublicNews.create({
      title: title.trim(),
      summary: summary.trim(),
      body: body.trim(),
      imageUrl: imageUrl?.trim() || null,
      tags: Array.isArray(tags) ? tags : [],
      isPublished: isPublished !== false,
      publishedAt: publishedAt ? new Date(publishedAt) : (isPublished !== false ? new Date() : null),
      createdBy: req.user.id
    });

    if (item.isPublished) {
      await Notification.create({
        title: "خبر جديد",
        message: item.title,
        type: "normal",
        target: "all",
        createdBy: req.user.id
      }).catch(e => console.error("Notification Error:", e));
    }

    success(res, { news: item }, 'تم إضافة الخبر بنجاح', 201);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    serverError(res, err, 'إضافة خبر');
  }
});

// PUT /api/admin/public/news/:id — تعديل خبر
router.put('/news/:id', adminOnly, async (req, res) => {
  try {
    const { title, summary, body, imageUrl, tags, isPublished, publishedAt } = req.body;
    const updates = {};
    if (title       !== undefined) updates.title       = title.trim();
    if (summary     !== undefined) updates.summary     = summary.trim();
    if (body        !== undefined) updates.body        = body.trim();
    if (imageUrl    !== undefined) updates.imageUrl    = imageUrl?.trim() || null;
    if (tags        !== undefined) updates.tags        = Array.isArray(tags) ? tags : [];
    if (publishedAt !== undefined && publishedAt) updates.publishedAt = new Date(publishedAt);
    if (isPublished !== undefined) {
      updates.isPublished = isPublished;
      if (isPublished && !updates.publishedAt && !publishedAt) updates.publishedAt = new Date();
    }

    const item = await PublicNews.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after', runValidators: true });
    if (!item) return res.status(404).json({ success: false, message: 'الخبر غير موجود' });
    success(res, { news: item }, 'تم تحديث الخبر');
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    serverError(res, err, 'تعديل خبر');
  }
});

// DELETE /api/admin/public/news/:id — حذف خبر
router.delete('/news/:id', adminOnly, async (req, res) => {
  try {
    const item = await PublicNews.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'الخبر غير موجود' });
    success(res, null, 'تم حذف الخبر');
  } catch (err) { serverError(res, err, 'حذف خبر'); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  GALLERY
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/public/gallery — كل الصور
router.get('/gallery', adminOnly, async (req, res) => {
  try {
    const images = await PublicGallery.find()
      .sort({ order: 1, createdAt: -1 })
      .populate('uploadedBy', 'name')
      .lean();
    success(res, { images });
  } catch (err) { serverError(res, err, 'جلب المعرض'); }
});

// التصنيفات المسموح بها — يجب أن تطابق enum في نموذج PublicGallery
const GALLERY_CATEGORIES = ['نشاط', 'مبنى', 'تخرج', 'أخرى'];

// POST /api/admin/public/gallery — إضافة صورة
router.post('/gallery', adminOnly, async (req, res) => {
  try {
    const { imageUrl, caption, category, order } = req.body;
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
      return res.status(400).json({ success: false, message: 'رابط الصورة مطلوب' });
    }

    // تصنيف غير معروف → «أخرى» بدل رمي خطأ enum يتحول إلى 500
    const safeCategory = GALLERY_CATEGORIES.includes(category) ? category : 'أخرى';
    const safeOrder = Number.isFinite(Number(order)) ? Number(order) : 0;

    const img = await PublicGallery.create({
      imageUrl: imageUrl.trim(),
      caption: (typeof caption === 'string' ? caption.trim() : '').slice(0, 300),
      category: safeCategory,
      order: safeOrder,
      uploadedBy: req.user.id
    });
    success(res, { image: img }, 'تم إضافة الصورة', 201);
  } catch (err) { serverError(res, err, 'إضافة صورة'); }
});

// PUT /api/admin/public/gallery/:id — تعديل صورة
router.put('/gallery/:id', adminOnly, async (req, res) => {
  try {
    const { caption, category, order, isVisible } = req.body;
    const updates = {};
    if (caption    !== undefined) updates.caption   = String(caption ?? '').trim().slice(0, 300);
    if (category   !== undefined) updates.category  = GALLERY_CATEGORIES.includes(category) ? category : 'أخرى';
    if (order      !== undefined) updates.order     = Number.isFinite(Number(order)) ? Number(order) : 0;
    if (isVisible  !== undefined) updates.isVisible = Boolean(isVisible);

    const img = await PublicGallery.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after', runValidators: true });
    if (!img) return res.status(404).json({ success: false, message: 'الصورة غير موجودة' });
    success(res, { image: img }, 'تم تحديث الصورة');
  } catch (err) { serverError(res, err, 'تعديل صورة'); }
});

// DELETE /api/admin/public/gallery/:id — حذف صورة
router.delete('/gallery/:id', adminOnly, async (req, res) => {
  try {
    const img = await PublicGallery.findByIdAndDelete(req.params.id);
    if (!img) return res.status(404).json({ success: false, message: 'الصورة غير موجودة' });
    success(res, null, 'تم حذف الصورة');
  } catch (err) { serverError(res, err, 'حذف صورة'); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/admin/public/upload — رفع ملف (صورة)
router.post('/upload', adminOnly, upload.single('file'), optimizeImage, (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ success: false, message: 'لم يتم رفع أي ملف' });
    }
    // مسار نسبي بشرطة مائلة أمامية موحّدة (يعمل على ويندوز ولينكس)
    const rel = req.file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    success(res, { url: '/' + rel }, 'تم رفع الملف بنجاح');
  } catch (err) { serverError(res, err, 'رفع ملف المعرض'); }
});

module.exports = router;
