const Redis = require('ioredis');

let isRedisConnected = false;
let redis = null;

// لا يتم الاتصال إلا في حالة تكوين Redis صراحة
const hasRedisConfig = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);

if (hasRedisConfig && process.env.NODE_ENV !== 'test') {
  redis = new Redis(process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 1) return null;
      return 1000;
    }
  });

  redis.connect().then(() => {
    isRedisConnected = true;
    console.log('[REDIS] Connected successfully for Caching.');
  }).catch(err => {
    isRedisConnected = false;
  });

  redis.on('error', () => {
    isRedisConnected = false;
  });
}

/**
 * Middleware للتخزين المؤقت للبيانات
 * @param {number} duration الثواني التي سيبقى فيها الكاش
 */
const cacheRoute = (duration = 60) => {
  return async (req, res, next) => {
    // إذا لم يكن رديس متصلاً، تجاوز الكاش
    if (!isRedisConnected || req.method !== 'GET') {
      return next();
    }

    // بناء مفتاح الكاش بناءً على المسار والمتغيرات
    const key = `__express__${req.originalUrl || req.url}`;

    try {
      const cachedBody = await redis.get(key);
      if (cachedBody) {
        res.setHeader('X-Cache', 'HIT');
        return res.send(JSON.parse(cachedBody));
      } else {
        res.setHeader('X-Cache', 'MISS');
        
        // التقاط الـ Response الأصلي لتخزينه قبل الإرسال
        res.sendResponse = res.send;
        res.send = (body) => {
          try {
            // نخزن البيانات كنص في Redis
            redis.setex(key, duration, JSON.stringify(body));
          } catch (e) {
            console.error('[REDIS] Error saving to cache:', e);
          }
          res.sendResponse(body);
        };
        next();
      }
    } catch (err) {
      // تجاوز الخطأ في حال فشل الكاش
      next();
    }
  };
};

/**
 * وظيفة لمسح الكاش يدوياً (مثلاً عند إضافة مقال جديد)
 */
const clearCache = async (pattern) => {
  if (!isRedisConnected) return;
  try {
    const keys = await redis.keys(`__express__${pattern}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (e) {
    console.error('[REDIS] Clear cache failed:', e);
  }
};

module.exports = { cacheRoute, clearCache, redis };
