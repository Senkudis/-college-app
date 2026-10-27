/**
 * routes/device.routes.js
 * تسجيل/إلغاء FCM Tokens الخاصة بالأجهزة
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth.middleware');
const User    = require('../models/User');
const { success, fail, serverError } = require('../utils/response');

// ===== تسجيل FCM Token للجهاز الحالي =====
router.post('/register', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.length < 10) {
      return fail(res, 'رمز الجهاز (Token) غير صالح', 400);
    }

    /* الجهاز لحساب واحد: على هاتف مشترك (خروج طالب ودخول آخر) كان التوكن يبقى
       في حساب الأول فتصله إشعارات الثاني — درجاته ورسومه وتنبيهات غيابه. */
    await User.updateMany(
      { _id: { $ne: req.user.id }, fcmTokens: token },
      { $pull: { fcmTokens: token } }
    );
    // أضف التوكن إذا لم يكن موجوداً مسبقاً (addToSet)
    await User.updateOne(
      { _id: req.user.id },
      { $addToSet: { fcmTokens: token } }
    );

    return success(res, null, 'تم تسجيل الجهاز بنجاح');
  } catch (err) {
    return serverError(res, err, 'تسجيل جهاز FCM');
  }
});

// ===== إلغاء FCM Token (عند تسجيل الخروج) =====
router.delete('/unregister', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return fail(res, 'رمز الجهاز مطلوب', 400);

    await User.updateOne(
      { _id: req.user.id },
      { $pull: { fcmTokens: token } }
    );

    return success(res, null, 'تم إلغاء تسجيل الجهاز');
  } catch (err) {
    return serverError(res, err, 'إلغاء تسجيل جهاز FCM');
  }
});

// ===== Web Push (متصفح/آيفون) =====

// المفتاح العام لـ VAPID — يحتاجه العميل للاشتراك (عام وآمن للكشف)
router.get('/webpush/key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY || '';
  res.json({ success: true, key, enabled: Boolean(key) }); // كانت !key: معكوسة
});

// حفظ اشتراك Web Push للمستخدم الحالي
router.post('/webpush/subscribe', auth, async (req, res) => {
  try {
    const sub = req.body;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
      return fail(res, 'بيانات الاشتراك غير صالحة', 400);
    }
    // نحذف أي اشتراك بنفس الـ endpoint من كل الحسابات (جهاز مشترك) ثم نضيف المحدّث
    await User.updateMany(
      { 'webPushSubscriptions.endpoint': sub.endpoint },
      { $pull: { webPushSubscriptions: { endpoint: sub.endpoint } } }
    );
    await User.updateOne(
      { _id: req.user.id },
      { $push: { webPushSubscriptions: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } } }
    );
    return success(res, null, 'تم تفعيل الإشعارات بنجاح');
  } catch (err) {
    return serverError(res, err, 'اشتراك WebPush');
  }
});

// إلغاء اشتراك Web Push
router.post('/webpush/unsubscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return fail(res, 'رابط الاشتراك (endpoint) مطلوب', 400);
    await User.updateOne(
      { _id: req.user.id },
      { $pull: { webPushSubscriptions: { endpoint } } }
    );
    return success(res, null, 'تم إلغاء الإشعارات');
  } catch (err) {
    return serverError(res, err, 'إلغاء اشتراك WebPush');
  }
});

// ===== تنظيف توكنات منتهية الصلاحية (internal) =====
router.delete('/cleanup', auth, async (req, res) => {
  try {
    const { invalidTokens } = req.body;
    if (!Array.isArray(invalidTokens) || !invalidTokens.length) {
      return success(res, { removed: 0 });
    }
    await User.updateMany(
      { fcmTokens: { $in: invalidTokens } },
      { $pull: { fcmTokens: { $in: invalidTokens } } }
    );
    return success(res, { removed: invalidTokens.length });
  } catch (err) {
    return serverError(res, err, 'تنظيف التوكنات');
  }
});

module.exports = router;
