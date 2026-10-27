/* إرسال إشعار الهاتف (FCM لتطبيق أندرويد + Web Push للمتصفح) لمستهدفي إشعار.
   كان الإرسال يتم من مسار الإنشاء اليدوي وحده، فالإشعارات التي ينشئها النظام
   (رصد درجة، قبول سداد، رسوم جديدة، تحذير غياب، تسليم جديد) تُحفظ وتصل لمن
   يفتح التطبيق فقط، ولا تصل للهاتف المغلق إطلاقاً. صار يُستدعى من خطّاف
   الحفظ في نموذج الإشعار، فيشمل كل إشعار جديد أياً كان مصدره. */
const PLURAL_TO_SINGULAR = { students: "student", doctors: "doctor", leaders: "leader" };

function targetQuery(notification) {
  if (notification.recipients?.length) return { _id: { $in: notification.recipients } };
  const and = [];
  if (notification.target && notification.target !== "all") {
    const singular = PLURAL_TO_SINGULAR[notification.target];
    if (singular) and.push({ roles: singular });
  }
  if (notification.batches?.length) {
    and.push({ $or: [{ batch: { $in: notification.batches } }, { batches: { $in: notification.batches } }] });
  }
  return and.length ? { $and: and } : {};
}

async function fcmPush(notification) {
  const User = require("../models/User");
  const fcmService = require("./fcmService");
  const users = await User.find({ ...targetQuery(notification), fcmTokens: { $exists: true, $not: { $size: 0 } } })
    .select("_id fcmTokens").lean();
  const tokens = users.flatMap(u => (Array.isArray(u.fcmTokens) ? u.fcmTokens.filter(Boolean) : []));
  if (!tokens.length) return;
  const failed = await fcmService.sendToMultiple(tokens, {
    title: notification.title,
    body: notification.message,
    isEmergency: notification.type === "emergency",
    data: { notificationId: String(notification._id) }
  });
  if (Array.isArray(failed) && failed.length) {
    await User.updateMany({ fcmTokens: { $in: failed } }, { $pull: { fcmTokens: { $in: failed } } });
  }
}

async function webPush(notification) {
  const webpush = require("./webpushService");
  if (!webpush.isEnabled()) return;
  const User = require("../models/User");
  const users = await User.find({ ...targetQuery(notification), webPushSubscriptions: { $exists: true, $not: { $size: 0 } } })
    .select("_id webPushSubscriptions").lean();
  await webpush.sendToUsers(users, {
    title: notification.title,
    body: notification.message,
    isEmergency: notification.type === "emergency",
    data: { url: "/notifications.html" }
  });
}

function dispatchPush(notification) {
  fcmPush(notification).catch(err => console.error("FCM Push dispatch:", err.message));
  webPush(notification).catch(err => console.error("WebPush dispatch:", err.message));
}

module.exports = { dispatchPush };
