const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// Helper to mask IPv6 to /64 to prevent rate limit bypass
const getIpPrefix = (ip) => {
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length > 4) return parts.slice(0, 4).join(':');
  }
  return ip;
};

const createRateLimiter = (windowMs, max, message, keyGenerator, skipSuccessfulRequests = false) => {
  const options = {
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    },
    validate: { ip: false, default: false } // Disable validation to prevent IPv6 crash
  };
  if (keyGenerator) options.keyGenerator = keyGenerator;
  return rateLimit(options);
};

/* طلاب الحرم يخرجون إلى الإنترنت من عنوان IP واحد (شبكة الكلية أو مزوّد
   الهاتف). أي حدّ مفتاحه الـIP وحده يُعامل الحرم كله كمستخدم واحد:
   خمس محاولات دخول خاطئة من خمسة طلاب كانت تقفل الدخول على الجميع خمس
   دقائق، وألف طلب في ربع ساعة تستهلكها بضع عشرات من الطلاب يتصفحون معاً.
   نعدّ لكل مستخدم/حساب، ونُبقي على الـIP سقفاً أعلى بكثير ضد الإغراق. */
const userFromToken = (req) => {
  const h = req.headers?.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  try {
    // تحقق كامل من التوقيع: توكن مزوّر لا يمنح صاحبه دلواً جديداً في كل طلب
    const d = jwt.verify(h.slice(7).trim(), process.env.JWT_SECRET);
    return d.id || d._id || d.userId || null;
  } catch { return null; }
};
const emailKey = (req) => String(req.body?.email || '').trim().toLowerCase().slice(0, 200);

// General API limiter: per signed-in user, per IP for anonymous traffic
const apiLimiter = createRateLimiter(
  15 * 60 * 1000,
  1000,
  'طلبات كثيرة جداً، يرجى الانتظار قبل المحاولة مرة أخرى',
  (req) => { const uid = userFromToken(req); return uid ? `user:${uid}` : `ip:${getIpPrefix(req.ip)}`; }
);

// Login: failed attempts per account from this network (the account itself also locks after repeated failures)
const authLimiter = createRateLimiter(
  5 * 60 * 1000, // 5 min
  5, // 5 failed attempts
  'محاولات تسجيل دخول خاطئة كثيرة، يرجى المحاولة بعد 5 دقائق',
  (req) => `login:${getIpPrefix(req.ip)}:${emailKey(req)}`,
  true // skipSuccessfulRequests: only count failed attempts (400, 401, 500 etc)
);

// سقف الشبكة: يوقف تجربة كلمات مرور على حسابات كثيرة من مصدر واحد
const authIpLimiter = createRateLimiter(
  5 * 60 * 1000,
  80,
  'محاولات تسجيل دخول خاطئة كثيرة من هذه الشبكة، يرجى المحاولة بعد 5 دقائق',
  (req) => `loginip:${getIpPrefix(req.ip)}`,
  true
);

/* التحقق من كود الاستعادة: الكود 6 أرقام صالح 20 دقيقة، وبلا حدّ كان
   تخمينه بالقوة الغاشمة ممكناً خلال دقائق = الاستيلاء على أي حساب.
   الحدّ لكل بريد هو ما يحمي الكود؛ سقف الـIP يمنع تدوير البريد. */
const resetCodeLimiter = createRateLimiter(
  15 * 60 * 1000,
  10,
  'محاولات كثيرة للتحقق من الكود، يرجى الانتظار 15 دقيقة',
  (req) => `resetcode:${emailKey(req) || getIpPrefix(req.ip)}`,
  true
);
const resetCodeIpLimiter = createRateLimiter(
  15 * 60 * 1000,
  100,
  'محاولات كثيرة للتحقق من الكود، يرجى الانتظار 15 دقيقة',
  (req) => `resetcodeip:${getIpPrefix(req.ip)}`,
  true
);

// Password reset emails: per address, with a network ceiling against mail flooding
const passwordResetLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  3,
  'تم تجاوز حد طلبات استعادة كلمة المرور، يرجى الانتظار ساعة',
  (req) => `reset:${getIpPrefix(req.ip)}:${emailKey(req)}`
);
const passwordResetIpLimiter = createRateLimiter(
  60 * 60 * 1000,
  40,
  'تم تجاوز حد طلبات استعادة كلمة المرور من هذه الشبكة، يرجى الانتظار ساعة',
  (req) => `resetip:${getIpPrefix(req.ip)}`
);

// File upload: moderate limits
const uploadLimiter = createRateLimiter(
  10 * 60 * 1000, // 10 min
  20,
  'طلبات رفع كثيرة، يرجى الانتظار',
  (req) => req.user?.id ? `user:${req.user.id}` : `ip:${getIpPrefix(req.ip)}`
);

/* ===== حدّ استدعاءات الذكاء الاصطناعي =====
   حصة Gemini المجانية ~20 طلباً يومياً لكل مفتاح، وحصة Cohere/Groq محدودة
   كذلك. الحدّ العام (1000 طلب/15 دقيقة) لا يحمي منها إطلاقاً: طالب واحد
   يضغط "ملخص شامل" بضع مرات يستنفد رصيد الدفعة كلها.

   الحدّ لكل مستخدم لا لكل IP — الطلاب داخل الحرم خلف نفس الشبكة، فالحدّ
   بالـIP كان سيعاقب الجميع بذنب واحد. */
const aiLimiter = createRateLimiter(
  60 * 60 * 1000, // ساعة
  30,             // 30 طلباً للمستخدم في الساعة
  'استخدمت مساعد كيدي كثيراً خلال الساعة الماضية. أمهله قليلاً ثم عد إليه.',
  (req) => req.user?.id ? `ai:user:${req.user.id}` : `ai:ip:${getIpPrefix(req.ip)}`
);

/* حدّ يومي أشمل يحمي الحصة الكلية للنظام لا حصة المستخدم وحده */
const aiDailyLimiter = createRateLimiter(
  24 * 60 * 60 * 1000, // يوم
  120,                 // 120 طلباً للمستخدم يومياً
  'بلغت الحد اليومي لاستخدام مساعد كيدي. يتجدد غداً.',
  (req) => req.user?.id ? `aiday:user:${req.user.id}` : `aiday:ip:${getIpPrefix(req.ip)}`
);

/* تفاعلات الصفحات العامة (الإعجابات) — مفتوحة بلا تسجيل دخول، وكانت
   تستدعي $inc بلا أي حدّ: أي زائر يرفع عدّاد خبر أو صورة أو يخفضه بلا
   نهاية بحلقة بسيطة، فيفقد الرقم أي دلالة. */
const publicActionLimiter = createRateLimiter(
  10 * 60 * 1000, // 10 دقائق
  30,
  'تفاعلات كثيرة خلال وقت قصير، يرجى المحاولة لاحقاً',
  (req) => `public:${getIpPrefix(req.ip)}`
);

/* صفحة التحقق من بطاقة الهوية — عامة بلا تسجيل دخول. الرموز موقّعة فلا
   يُجدي تخمينها، والحدّ يمنع استخدامها لإغراق قاعدة البيانات بالاستعلامات.
   60 مسحاً في 10 دقائق يكفي حارس بوابة يتحقق من طابور طلاب. */
const idVerifyLimiter = createRateLimiter(
  10 * 60 * 1000,
  60,
  'محاولات تحقق كثيرة، يرجى الانتظار قليلاً',
  (req) => `idverify:${getIpPrefix(req.ip)}`
);

module.exports = {
  apiLimiter,
  idVerifyLimiter,
  authLimiter,
  authIpLimiter,
  passwordResetLimiter,
  passwordResetIpLimiter,
  resetCodeLimiter,
  resetCodeIpLimiter,
  uploadLimiter,
  aiLimiter,
  aiDailyLimiter,
  publicActionLimiter
};