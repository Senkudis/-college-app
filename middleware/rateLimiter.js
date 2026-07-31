const rateLimit = require('express-rate-limit');

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

// General API limiter: 1000 requests per 15 minutes (increased to allow background polling)
const apiLimiter = createRateLimiter(
  15 * 60 * 1000,
  1000,
  'طلبات كثيرة جداً، يرجى الانتظار قبل المحاولة مرة أخرى'
);

// Auth endpoints: stricter limits (5 min, IP only, only counts failed attempts)
const authLimiter = createRateLimiter(
  5 * 60 * 1000, // 5 min
  5, // 5 failed attempts
  'محاولات تسجيل دخول خاطئة كثيرة، يرجى المحاولة بعد 5 دقائق',
  (req) => `ip:${getIpPrefix(req.ip)}`, // Restrict to IP only
  true // skipSuccessfulRequests: only count failed attempts (400, 401, 500 etc)
);

// Password reset: very strict
const passwordResetLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  3,
  'تم تجاوز حد طلبات استعادة كلمة المرور، يرجى الانتظار ساعة',
  (req) => `ip:${getIpPrefix(req.ip)}` // Restrict to IP only
);

// File upload: moderate limits
const uploadLimiter = createRateLimiter(
  10 * 60 * 1000, // 10 min
  20,
  'طلبات رفع كثيرة، يرجى الانتظار',
  (req) => req.user?.id ? `user:${req.user.id}` : `ip:${getIpPrefix(req.ip)}`
);

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  uploadLimiter
};