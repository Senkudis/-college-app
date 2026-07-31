let Jimp = null;
try {
  const jModule = require('jimp');
  Jimp = jModule.Jimp || jModule;
} catch (e) {
  console.warn('[ImageOptimizer] Jimp module not installed on server. Image optimization will be bypassed.');
}

/**
 * Middleware لضغط الصور وتحويلها إلى جودة ويب للحفاظ على المساحة
 */
const optimizeImage = async (req, res, next) => {
  if (!req.file || !Jimp || typeof Jimp.read !== 'function') return next();

  // تأكد من أن الملف المرفوع هو صورة
  const mimetype = req.file.mimetype;
  if (!mimetype || !mimetype.startsWith('image/')) return next();

  // استثناء بعض الصيغ التي قد لا يتعامل معها Jimp بسلاسة مثل SVG و GIF (المتحرك)
  if (mimetype === 'image/svg+xml' || mimetype === 'image/gif') return next();

  try {
    const filePath = req.file.path;
    
    // جلب الصورة عبر Jimp
    const image = await Jimp.read(filePath);
    if (!image) return next();

    const imgWidth = image.bitmap ? image.bitmap.width : (image.width || 0);

    // تغيير الحجم إذا كان العرض أكبر من 1200 بكسل
    if (imgWidth > 1200) {
      if (typeof image.resize === 'function') {
        try {
          image.resize({ w: 1200 });
        } catch (e) {
          const AUTO = Jimp.AUTO || -1;
          image.resize(1200, AUTO);
        }
      }
    }

    // ضغط الصورة وتخفيض الجودة لتسريع التحميل
    if (typeof image.quality === 'function') {
      try { image.quality(80); } catch (e) {}
    }

    // حفظ التعديلات على نفس الملف (توافق مع Jimp v0.x و v1.x)
    if (typeof image.write === 'function') {
      await image.write(filePath);
    } else if (typeof image.writeAsync === 'function') {
      await image.writeAsync(filePath);
    }

    next();
  } catch (error) {
    console.error('Image optimization failed:', error.message || error);
    // تجاوز الخطأ والسماح برفع الصورة الأصلية بدلاً من كسر العملية
    next();
  }
};

module.exports = optimizeImage;
