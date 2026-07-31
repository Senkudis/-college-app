const Redis = require('ioredis');
// ملاحظة: config/index.js غير موجود — الإعدادات تُقرأ مباشرة من process.env

let redis = null;
let isConnected = false;

function initRedis() {
  if (process.env.NODE_ENV === 'test' || (!process.env.REDIS_URL && !process.env.REDIS_HOST)) {
    return null;
  }

  const redisUrl = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
  
  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => times > 1 ? null : 1000,
    enableReadyCheck: true,
    lazyConnect: true
  });

  redis.on('connect', () => {
    isConnected = true;
    console.log('✅ Redis connected');
  });

  redis.on('error', (err) => {
    isConnected = false;
  });

  redis.on('close', () => {
    isConnected = false;
  });

  redis.connect().catch(() => {});
  
  return redis;
}

function getRedis() {
  return redis;
}

function isRedisReady() {
  return isConnected && redis?.status === 'ready';
}

// Cache helpers
async function get(key) {
  if (!isRedisReady()) return null;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.warn('Redis get error:', err.message);
    return null;
  }
}

async function set(key, value, ttlSeconds = 300) {
  if (!isRedisReady()) return false;
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Redis set error:', err.message);
    return false;
  }
}

async function del(key) {
  if (!isRedisReady()) return false;
  try {
    await redis.del(key);
    return true;
  } catch (err) {
    console.warn('Redis del error:', err.message);
    return false;
  }
}

async function delPattern(pattern) {
  if (!isRedisReady()) return false;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return true;
  } catch (err) {
    console.warn('Redis delPattern error:', err.message);
    return false;
  }
}

// Cache keys
const CacheKeys = {
  subjects: (batchId) => `subjects:${batchId}`,
  subjectsAll: 'subjects:all',
  notifications: (userId) => `notifications:${userId}`,
  dashboard: (userId) => `dashboard:${userId}`,
  user: (userId) => `user:${userId}`,
  batches: 'batches:active',
  assignments: (batchId) => `assignments:${batchId}`,
  videos: (batchId) => `videos:${batchId}`,
  leaderboard: 'leaderboard:all'
};

// Cache TTL (seconds)
const CacheTTL = {
  subjects: 600,      // 10 min
  notifications: 60,  // 1 min
  dashboard: 120,     // 2 min
  user: 300,          // 5 min
  batches: 1800,      // 30 min
  assignments: 300,   // 5 min
  videos: 300,        // 5 min
  leaderboard: 600    // 10 min
};

// Invalidate cache
async function invalidateSubjects(batchId) {
  await Promise.all([
    del(CacheKeys.subjects(batchId)),
    del(CacheKeys.subjectsAll),
    delPattern('assignments:*'),
    delPattern('videos:*')
  ]);
}

async function invalidateUser(userId) {
  await Promise.all([
    del(CacheKeys.user(userId)),
    del(CacheKeys.notifications(userId)),
    del(CacheKeys.dashboard(userId)),
    del(CacheKeys.leaderboard)
  ]);
}

async function invalidateBatch(batchId) {
  await Promise.all([
    del(CacheKeys.subjects(batchId)),
    del(CacheKeys.assignments(batchId)),
    del(CacheKeys.videos(batchId)),
    del(CacheKeys.batches)
  ]);
}

async function invalidateAll() {
  if (!isRedisReady()) return;
  try {
    await redis.flushdb();
  } catch (err) {
    console.warn('Redis flushdb error:', err.message);
  }
}

module.exports = {
  initRedis,
  getRedis,
  isRedisReady,
  get,
  set,
  del,
  delPattern,
  CacheKeys,
  CacheTTL,
  invalidateSubjects,
  invalidateUser,
  invalidateBatch,
  invalidateAll
};