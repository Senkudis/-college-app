const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const PublicNews = require('../models/PublicNews');
const PublicGallery = require('../models/PublicGallery');
const { success, serverError } = require('../utils/response');
const { cacheRoute } = require('../middleware/cache.middleware');
const { publicActionLimiter } = require('../middleware/rateLimiter');

// ── Rate Limiter: 100 طلب لكل IP كل 15 دقيقة ──────────────────────────────
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'كثير من الطلبات، حاول لاحقاً.' }
});

router.use(publicLimiter);

// ── GET /api/public/news ──────────────────────────────────────────────────
// جلب الأخبار المنشورة مع Pagination
router.get('/news', cacheRoute(300), async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(20, parseInt(req.query.limit) || 6);
    const skip  = (page - 1) * limit;

    const [news, total] = await Promise.all([
      PublicNews.find({ isPublished: true })
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('title summary body imageUrl tags publishedAt viewsCount likesCount')
        .lean(),
      PublicNews.countDocuments({ isPublished: true })
    ]);

    success(res, {
      news,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    serverError(res, err, 'جلب الأخبار العامة');
  }
});

// ── GET /api/public/news/:id ──────────────────────────────────────────────
// تفاصيل خبر واحد (مع زيادة عدد المشاهدات تلقائياً)
router.get('/news/:id', async (req, res) => {
  try {
    const item = await PublicNews.findOne({
      _id: req.params.id,
      isPublished: true
    }).select('-createdBy').lean();

    if (!item) return res.status(404).json({ success: false, message: 'الخبر غير موجود' });

    // زيادة المشاهدات
    await PublicNews.findByIdAndUpdate(req.params.id, { $inc: { viewsCount: 1 } });
    item.viewsCount = (item.viewsCount || 0) + 1;

    success(res, { news: item });
  } catch (err) {
    serverError(res, err, 'جلب تفاصيل الخبر');
  }
});

// ── GET /api/public/gallery ───────────────────────────────────────────────
// جلب صور المعرض الظاهرة مرتبة (بيانات حية مباشرة بدون تخزين مؤقت)
router.get('/gallery', async (req, res) => {
  try {
    const category = req.query.category || null;
    const filter = { isVisible: true };
    if (category) filter.category = category;

    const images = await PublicGallery.find(filter)
      .sort({ order: 1, createdAt: -1 })
      .select('imageUrl caption category order likesCount')
      .lean();

    success(res, { images });
  } catch (err) {
    serverError(res, err, 'جلب معرض الصور');
  }
});

// ── POST /api/public/gallery/:id/like ─────────────────────────────────────
// تسجيل إعجاب أو إلغاء إعجاب لصورة بالمعرض
router.post('/gallery/:id/like', publicActionLimiter, async (req, res) => {
  try {
    const { action } = req.body;
    const delta = action === 'unlike' ? -1 : 1;
    const img = await PublicGallery.findByIdAndUpdate(
      req.params.id,
      { $inc: { likesCount: delta } },
      { returnDocument: 'after' }
    );
    if (!img) return fail(res, 'الصورة غير موجودة', 404);

    if (img.likesCount < 0) {
      img.likesCount = 0;
      await img.save();
    }
    success(res, { likesCount: img.likesCount });
  } catch (err) {
    serverError(res, err, 'تحديث الإعجابات');
  }
});

// ── POST /api/public/gallery/upload ──────────────────────────────────────
// رفع الطالب لصورة جديدة من المعرض/الهاتف
const authMiddleware = require('../middleware/auth.middleware');

router.post('/gallery/upload', authMiddleware, async (req, res) => {
  try {
    const { imageUrl, caption, category = 'أخرى' } = req.body;
    if (!imageUrl) {
      return fail(res, 'يرجى اختيار صورة للرفع', 400);
    }

    /* imageUrl كان نصاً حراً يُخزَّن ويُعرض للزوار كما هو — أي رابط خارجي
       أو نظام URI مثل javascript:. نقصره على مسارات الرفع الداخلية. */
    const cleanUrl = String(imageUrl).trim();
    if (!/^\/uploads\/[A-Za-z0-9._\-\/]+$/.test(cleanUrl)) {
      return fail(res, 'رابط الصورة غير صالح — يجب رفع الصورة عبر النظام', 400);
    }

    const safeCategories = ['نشاط', 'مبنى', 'تخرج', 'أخرى'];
    const safeCategory = safeCategories.includes(category) ? category : 'أخرى';

    /* النشر صار بانتظار مراجعة الإدارة: isVisible:true كان يعني أن أي
       مستخدم مصادق ينشر مباشرة على واجهة الكلية العامة أمام الزوار
       دون أن يمرّ المحتوى على أحد. */
    const img = await PublicGallery.create({
      imageUrl: cleanUrl,
      caption: caption ? String(caption).trim().slice(0, 1000) : '',
      category: safeCategory,
      uploadedBy: req.user.id,
      isVisible: false
    });

    success(res, {
      image: img,
      message: 'تم استلام صورتك وستظهر في المعرض بعد موافقة الإدارة'
    }, 201);
  } catch (err) {
    serverError(res, err, 'رفع صورة المعرض');
  }
});

// ── POST /api/public/news/:id/like ────────────────────────────────────────
// تسجيل إعجاب لخبر
router.post('/news/:id/like', publicActionLimiter, async (req, res) => {
  try {
    const { action } = req.body;
    const delta = action === 'unlike' ? -1 : 1;
    const news = await PublicNews.findByIdAndUpdate(
      req.params.id,
      { $inc: { likesCount: delta } },
      { returnDocument: 'after' }
    );
    if (!news) return fail(res, 'الخبر غير موجود', 404);

    if (news.likesCount < 0) {
      news.likesCount = 0;
      await news.save();
    }
    success(res, { likesCount: news.likesCount });
  } catch (err) {
    serverError(res, err, 'تحديث إعجابات الخبر');
  }
});

module.exports = router;
