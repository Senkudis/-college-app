/**
 * utils/webpushService.js
 * Web Push (VAPID) — إشعارات للمتصفح وiPhone PWA (iOS 16.4+)
 * يكمّل fcmService: FCM لتطبيق أندرويد الأصلي، وهذا للويب/آيفون.
 *
 * الإعداد المطلوب مرة واحدة:
 *   1) npm install web-push
 *   2) توليد مفاتيح:  npx web-push generate-vapid-keys
 *   3) وضعها في .env:
 *        VAPID_PUBLIC_KEY=...
 *        VAPID_PRIVATE_KEY=...
 *        VAPID_SUBJECT=mailto:admin@elnasrcsit.website
 * بدون هذه المتغيرات تعمل الوحدة بصمت (no-op) دون تعطيل السيرفر.
 */

let webpush = null;
let enabled = false;
let initAttempted = false;

function init() {
  if (initAttempted) return;
  initAttempted = true;

  try {
    webpush = require('web-push');
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.log('ℹ️  حزمة web-push غير مثبتة على الخادم (يلزم تشغيل npm install على cPanel لتفعيل إشعارات الويب)');
    }
    return;
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    if (process.env.NODE_ENV !== 'test') {
      console.log('ℹ️  Web Push غير مفعل (مفاتيح VAPID غير موجودة في .env)');
    }
    return;
  }

  try {
    webpush.setVapidDetails(
      VAPID_SUBJECT || 'mailto:admin@elnasrcsit.website',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    enabled = true;
    if (process.env.NODE_ENV !== 'test') {
      console.log('✅ Web Push (VAPID) initialized');
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('⚠️  تعذر تهيئة Web Push:', err.message);
    }
  }
}

function isEnabled() {
  if (!enabled) init();
  return enabled;
}

/**
 * إرسال لاشتراك واحد. يُعيد true/false، أو 'invalid' إذا انتهى الاشتراك (410/404).
 */
async function sendToSubscription(subscription, { title, body, data = {}, isEmergency = false }) {
  if (!isEnabled() || !subscription?.endpoint) return false;
  const payload = JSON.stringify({
    title: title || 'إشعار جديد',
    body: body || '',
    data: { ...data, isEmergency: String(isEmergency) }
  });
  try {
    await webpush.sendNotification(subscription, payload, {
      urgency: isEmergency ? 'high' : 'normal',
      TTL: isEmergency ? 3600 : 86400
    });
    return true;
  } catch (err) {
    // 410 Gone أو 404 = اشتراك ميّت، يجب حذفه من DB
    if (err.statusCode === 410 || err.statusCode === 404) return 'invalid';
    console.error('WebPush send error:', err.statusCode || err.message);
    return false;
  }
}

/**
 * إرسال لعدة مستخدمين. يستقبل مصفوفة مستندات User (بحقل webPushSubscriptions)،
 * ويحذف الاشتراكات الميتة تلقائياً من DB.
 * @param {Array} users مستندات mongoose تحوي _id و webPushSubscriptions
 */
async function sendToUsers(users, payload) {
  if (!isEnabled() || !users?.length) return;
  const User = require('../models/User');

  await Promise.allSettled(users.map(async (user) => {
    const subs = user.webPushSubscriptions || [];
    if (!subs.length) return;
    const dead = [];
    await Promise.allSettled(subs.map(async (sub) => {
      const r = await sendToSubscription(sub, payload);
      if (r === 'invalid') dead.push(sub.endpoint);
    }));
    if (dead.length) {
      await User.updateOne(
        { _id: user._id },
        { $pull: { webPushSubscriptions: { endpoint: { $in: dead } } } }
      ).catch(() => {});
    }
  }));
}

init();

module.exports = { isEnabled, sendToSubscription, sendToUsers };
