/**
 * routes/device.routes.js
 * تسجيل/إلغاء FCM Tokens الخاصة بالأجهزة
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth.middleware');
const User    = require('../models/User');

// ===== تسجيل FCM Token للجهاز الحالي =====
router.post('/register', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.length < 10) {
      return res.status(400).json({ error: 'token غير صالح' });
    }

    // أضف التوكن إذا لم يكن موجوداً مسبقاً (addToSet)
    await User.updateOne(
      { _id: req.user.id },
      { $addToSet: { fcmTokens: token } }
    );

    res.json({ success: true, message: 'تم تسجيل الجهاز بنجاح' });
  } catch (err) {
    console.error('Device register error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ===== إلغاء FCM Token (عند تسجيل الخروج) =====
router.delete('/unregister', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token مطلوب' });

    await User.updateOne(
      { _id: req.user.id },
      { $pull: { fcmTokens: token } }
    );

    res.json({ success: true, message: 'تم إلغاء تسجيل الجهاز' });
  } catch (err) {
    console.error('Device unregister error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ===== Web Push (متصفح/آيفون) =====

// المفتاح العام لـ VAPID — يحتاجه العميل للاشتراك (عام وآمن للكشف)
router.get('/webpush/key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY || '';
  res.json({ key, enabled: !!key });
});

// حفظ اشتراك Web Push للمستخدم الحالي
router.post('/webpush/subscribe', auth, async (req, res) => {
  try {
    const sub = req.body;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ error: 'اشتراك غير صالح' });
    }
    // نحذف أي اشتراك بنفس الـ endpoint أولاً (تفادي التكرار) ثم نضيف المحدّث
    await User.updateOne(
      { _id: req.user.id },
      { $pull: { webPushSubscriptions: { endpoint: sub.endpoint } } }
    );
    await User.updateOne(
      { _id: req.user.id },
      { $push: { webPushSubscriptions: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } } }
    );
    res.json({ success: true, message: 'تم تفعيل الإشعارات' });
  } catch (err) {
    console.error('WebPush subscribe error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// إلغاء اشتراك Web Push
router.post('/webpush/unsubscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint مطلوب' });
    await User.updateOne(
      { _id: req.user.id },
      { $pull: { webPushSubscriptions: { endpoint } } }
    );
    res.json({ success: true, message: 'تم إلغاء الإشعارات' });
  } catch (err) {
    console.error('WebPush unsubscribe error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ===== تنظيف توكنات منتهية الصلاحية (internal) =====
router.delete('/cleanup', auth, async (req, res) => {
  try {
    const { invalidTokens } = req.body;
    if (!Array.isArray(invalidTokens) || !invalidTokens.length) {
      return res.json({ success: true });
    }
    await User.updateMany(
      { fcmTokens: { $in: invalidTokens } },
      { $pull: { fcmTokens: { $in: invalidTokens } } }
    );
    res.json({ success: true, removed: invalidTokens.length });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
