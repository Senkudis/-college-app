/**
 * utils/fcmService.js
 * Firebase Cloud Messaging — إرسال إشعارات حقيقية للهواتف
 */

const path = require('path');
let admin = null;
let messaging = null;
let initialized = false;

/**
 * يقرأ حساب الخدمة من إحدى ثلاث وسائل، بهذا الترتيب:
 *   1. FIREBASE_SERVICE_ACCOUNT      — محتوى JSON كاملاً (الأنسب للاستضافة المشتركة)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH — مسار الملف
 *   3. الملف الافتراضي بجانب المشروع
 * الملف مُستثنى من git (راجع .gitignore) فيجب رفعه للخادم يدوياً أو استخدام المتغير.
 */
function loadServiceAccount() {
  const fs = require('fs');
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, '..', 'elnasr-3dd9b-firebase-adminsdk-fbsvc-1094e99639.json');
  if (!fs.existsSync(file)) {
    const err = new Error('ملف حساب خدمة Firebase غير موجود: ' + file);
    err.cbsReason = 'missing-key';
    throw err;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function init() {
  if (initialized) return;
  try {
    try {
      admin = require('firebase-admin');
    } catch (e) {
      /* نُميّز غياب الحزمة عن غياب المفتاح: السبب والحل مختلفان تماماً،
         وكانت الرسالة السابقة تخلطهما فيصعب تشخيصها على الخادم. */
      const err = new Error("حزمة 'firebase-admin' غير مثبّتة على الخادم — نفّذ: npm install --omit=dev");
      err.cbsReason = 'missing-package';
      throw err;
    }

    const serviceAccount = loadServiceAccount();
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    messaging = admin.messaging();
    initialized = true;
    console.log('✅ Firebase Admin SDK initialized');
  } catch (err) {
    console.warn('⚠️  إشعارات FCM معطّلة:', err.message);
    if (err.cbsReason === 'missing-package') {
      console.warn('   ← التطبيق يعمل طبيعياً، لكن إشعارات الهاتف (FCM) لن تُرسل.');
    }
  }
}

// قنوات Android التي ينشئها التطبيق (_initNotifChannels في www/js/app.js) — يجب أن تتطابق
const CHANNELS = {
  normal:    { id: 'cbs_general',   sound: 'cbs_notif',     color: '#2563eb', priority: 'high' },
  emergency: { id: 'cbs_emergency', sound: 'cbs_emergency', color: '#ef4444', priority: 'max' }
};

/**
 * إرسال إشعار لجهاز واحد
 */
async function sendToToken(token, { title, body, data = {}, isEmergency = false }) {
  if (!initialized) init();
  if (!messaging || !token) return false;
  const ch = isEmergency ? CHANNELS.emergency : CHANNELS.normal;
  try {
    await messaging.send({
      token,
      notification: { title, body },
      // FCM يرفض الرسالة كلها إن كانت أي قيمة في data ليست نصاً (مثل url غير معرّف)
      data: Object.fromEntries(
        Object.entries({ ...data, isEmergency })
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      ),
      android: {
        // 'normal' كان يؤجّل الإشعار حتى يستيقظ الجهاز من وضع Doze، فيبدو أنه لم يصل
        priority: 'high',
        notification: {
          channelId:  ch.id,
          color:      ch.color,
          sound:      ch.sound,       // لأندرويد 7 وما دون؛ من 8 فصاعداً تحدده القناة
          priority:   ch.priority,
          visibility: 'public',
          defaultVibrateTimings: true
          // لا clickAction: قيمة FLUTTER_NOTIFICATION_CLICK لا يلتقطها أي نشاط في
          // تطبيقنا فكان النقر على الإشعار لا يفتح التطبيق
        }
      },
      apns: {
        payload: {
          aps: {
            sound:             'default',
            badge:             1,
            'content-available': 1
          }
        }
      }
    });
    return true;
  } catch (err) {
    // توكن منتهي الصلاحية أو غير صالح
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      return 'invalid';
    }
    console.error('FCM sendToToken error:', err.message);
    return false;
  }
}

/**
 * إرسال إشعار لمجموعة أجهزة
 * يُعيد قائمة التوكنات الفاشلة (لحذفها من DB)
 */
async function sendToMultiple(tokens, payload) {
  if (!initialized) init();
  if (!messaging || !tokens?.length) return [];

  const invalidTokens = [];
  // FCM يدعم 500 توكن كحد أقصى في الدفعة الواحدة
  const BATCH = 500;

  for (let i = 0; i < tokens.length; i += BATCH) {
    const chunk = tokens.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      chunk.map(token => sendToToken(token, payload))
    );
    results.forEach((r, idx) => {
      if (r.value === 'invalid') invalidTokens.push(chunk[idx]);
    });
  }
  return invalidTokens;
}

// تهيئة فورية عند تحميل الوحدة
init();

module.exports = { sendToToken, sendToMultiple };
