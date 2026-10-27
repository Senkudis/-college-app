/**
 * services/kedySmartNotification.service.js
 * نظام إشعارات كيدي الذكية — محرك تحفيز وتفاعل أكاديمي شبيه بنظام Duolingo
 * 
 * يحلل نشاط الطالب وسياقه الأكاديمي ويرسل تنبيهات Push ذكية في الأوقات المناسبة:
 * 1. حماية الستريك (Study Streak) عند الانقطاع لأكثر من 24 ساعة.
 * 2. تذكير بمواعيد تسليم الواجبات القريبة (Deadlines < 24h).
 * 3. تذكير بالكويزات والاختبارات القادمة.
 * 4. تشجيع على تجربة كتابة وتصحيح الأكواد في مختبر البرمجة (Code Lab).
 * 5. تذكير بمراجعة بطاقات الاستذكار (Flashcards).
 */

const User = require('../models/User');
const Notification = require('../models/Notification');
const Assignment = require('../models/Assignment');
const StudentSubmission = require('../models/StudentSubmission');
const Quiz = require('../models/Quiz');
const Subject = require('../models/Subject');
const webpush = require('../utils/webpushService');
const fcmService = require('../utils/fcmService');

// منع التكرار والإزعاج: لا يتم إرسال أكثر من إشعار ذكي واحد للطالب كل 18 ساعة
const NUDGE_COOLDOWN_MS = 18 * 60 * 60 * 1000;

/**
 * تسجيل نشاط الطالب وتحديث سلسلة الأيام المتتالية (Study Streak)
 */
async function recordActivity(userId) {
  if (!userId) return null;
  try {
    const user = await User.findById(userId);
    if (!user) return null;

    /* اليوم يُحسب بتوقيت الكلية لا بـ UTC.
       toISOString يعطي اليوم العالمي، والسودان UTC+2 — فطالب يذاكر
       الساعة ١:٠٠ فجراً كان يُحتسب في اليوم السابق، وطالب يذاكر ١١:٣٠
       مساءً يُحتسب في اليوم التالي. النتيجة ستريك ينكسر بلا سبب مفهوم. */
    const OFFSET_H = Number(process.env.COLLEGE_UTC_OFFSET || 2);
    const localDay = (d) => new Date(new Date(d).getTime() + OFFSET_H * 3600000)
      .toISOString().slice(0, 10);

    const now = new Date();
    const todayStr = localDay(now);
    const lastDateStr = user.lastStreakDate ? localDay(user.lastStreakDate) : null;

    user.lastActiveAt = now;

    if (!lastDateStr) {
      user.studyStreak = 1;
      user.lastStreakDate = now;
    } else if (lastDateStr !== todayStr) {
      const yesterday = localDay(now.getTime() - 24 * 60 * 60 * 1000);
      if (lastDateStr === yesterday) {
        // حافظ على الستريك وزاد يوماً إضافياً
        user.studyStreak = (user.studyStreak || 1) + 1;
        user.points = (user.points || 0) + 10; // مكافأة نقاط استمرارية
      } else {
        // انقطع أكثر من يوم -> إعادة ضبط الستريك
        user.studyStreak = 1;
      }
      user.lastStreakDate = now;
    }

    await user.save();
    return { streak: user.studyStreak, points: user.points };
  } catch (err) {
    console.warn('[KedySmartNotification] Error recording activity:', err.message);
    return null;
  }
}

/**
 * إرسال إشعار ذكي مخصص لطالب معين
 */
async function sendSmartNudge(student, { title, message, url = '/dashboard.html', actionType = 'general' }, io = null) {
  try {
    const notif = new Notification({
      title,
      message,
      type: 'normal',
      target: 'custom',
      recipients: [student._id],
      createdBy: null
    });
    if (notif.$locals) notif.$locals.skipPush = true; // نرسل أدناه نسخة أغنى (رابط الإجراء ونوعه)
    await notif.save();

    // 1. إرسال فوري عبر Socket.io
    if (io) {
      io.to(`user:${student._id}`).emit('notification:new', {
        _id: notif._id,
        title: notif.title,
        message: notif.message,
        type: notif.type,
        createdAt: notif.createdAt,
        isKedySmart: true,
        actionUrl: url
      });
    }

    // 2. إرسال عبر Web Push للمتصفح والـ PWA
    if (webpush.isEnabled() && student.webPushSubscriptions?.length) {
      await webpush.sendToUsers([student], {
        title,
        body: message,
        data: { url, notificationId: String(notif._id), actionType }
      });
    }

    // 3. إرسال عبر FCM لتطبيق الأندرويد الأصلي
    if (student.fcmTokens?.length) {
      await fcmService.sendToMultiple(student.fcmTokens, {
        title,
        body: message,
        data: { url, notificationId: String(notif._id), actionType }
      });
    }

    // تحديث وقت آخر تنبيه ذكي للطالب
    await User.findByIdAndUpdate(student._id, { lastKedyNudgeAt: new Date() });
    return true;
  } catch (err) {
    console.error('[KedySmartNotification] Send error for student', student._id, err.message);
    return false;
  }
}

/**
 * تقييم جميع الطلاب وإرسال تنبيهات كيدي الذكية المناسبة
 */
async function evaluateAndSendSmartNudges(io = null) {
  try {
    const now = new Date();
    const students = await User.find({
      roles: 'student',
      isActive: true,
      isPendingRegistration: { $ne: true }
    }).populate('batch').lean();

    if (!students || !students.length) return { processed: 0, sent: 0 };

    let sentCount = 0;

    for (const student of students) {
      // فحص إعدادات التنبيهات ووقت التهدئة
      if (student.kedyNudgeSettings?.enabled === false) continue;
      if (student.lastKedyNudgeAt && (now.getTime() - new Date(student.lastKedyNudgeAt).getTime()) < NUDGE_COOLDOWN_MS) {
        continue; // الطالب تلقى تنبيهاً ذكياً مؤخراً
      }

      const batchId = student.batch?._id || student.batch;
      const firstName = (student.name || 'يا بطل').split(' ')[0];
      let nudgePayload = null;

      // ─── 1. تذكير الواجبات القريبة غير المسلَّمة (أولوية قصوى) ───
      if (batchId) {
        const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const urgentAssignments = await Assignment.find({
          batches: batchId,
          dueDate: { $gte: now, $lte: in24h }
        }).populate('subject', 'name').lean();

        if (urgentAssignments.length > 0) {
          // فحص هل سلّم الطالب الواجب
          for (const ass of urgentAssignments) {
            const hasSubmitted = await StudentSubmission.findOne({
              assignment: ass._id,
              student: student._id
            });

            if (!hasSubmitted) {
              const subName = ass.subject?.name || 'المقرر';
              nudgePayload = {
                title: `⏰ كيدي يذكّرك: تسليم واجب ${subName}`,
                message: `يا ${firstName}، باقي أقل من 24 ساعة لتسليم واجب «${ass.title}»! أنجزه الآن واكسب درجاتك 🚀`,
                url: `/submit-assignment.html?id=${ass._id}`,
                actionType: 'assignment_deadline'
              };
              break;
            }
          }
        }
      }

      // ─── 2. تذكير الكويزات القادمة (أولوية ثانية) ───
      if (!nudgePayload && batchId) {
        const in36h = new Date(now.getTime() + 36 * 60 * 60 * 1000);
        const upcomingQuiz = await Quiz.findOne({
          batch: batchId,
          published: true,
          startsAt: { $lte: in36h },
          endsAt: { $gte: now }
        }).populate('subject', 'name').lean();

        if (upcomingQuiz) {
          const subName = upcomingQuiz.subject?.name || 'المادة';
          nudgePayload = {
            title: `🎯 كيدي: كويز قادم في ${subName}`,
            message: `يا ${firstName}، استعد لاختبار «${upcomingQuiz.title}»! راجع المفاهيم السريعة واضمن الدرجة الكاملة 💯`,
            url: `/quizzes.html`,
            actionType: 'quiz_reminder'
          };
        }
      }

      // ─── 3. حماية ستريك المذاكرة عند الغياب لأكثر من 24 ساعة ───
      if (!nudgePayload) {
        const lastActive = student.lastActiveAt ? new Date(student.lastActiveAt) : new Date(student.createdAt || 0);
        const hoursInactive = (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60);

        if (hoursInactive >= 24) {
          const streak = student.studyStreak || 1;
          nudgePayload = {
            title: `🔥 كيدي: حافظ على ستريك المذاكرة (${streak} أيام)!`,
            message: `يا ${firstName}، كيدي اشتاق لك! 5 دقائق اليوم في حل كويز أو مراجعة سريعة تبقيك في صدارة دفعتك 🦉✨`,
            url: `/flashcards.html`,
            actionType: 'streak_protection'
          };
        }
      }

      // ─── 4. تحفيز برمجي وتحدي في Code Lab ───
      if (!nudgePayload) {
        const randomSeed = Math.random();
        if (randomSeed > 0.5) {
          nudgePayload = {
            title: `💻 كيدي: تحدي برمجي سريع بانتظارك!`,
            message: `يا ${firstName}، هل جربت كتابة كود اليوم؟ افتح مختبر الأكواد وجرب خوارزمية جديدة مع فحص كيدي الذكي ⚡`,
            url: `/code-lab.html`,
            actionType: 'codelab_challenge'
          };
        } else {
          nudgePayload = {
            title: `📇 كيدي: وقت تنشيط الذاكرة!`,
            message: `يا ${firstName}، مراجعة 5 بطاقات استذكار سريعة الآن تثبت معلومات المحاضرات في ذهنك بنسبة 80% 🧠`,
            url: `/flashcards.html`,
            actionType: 'flashcards_review'
          };
        }
      }

      // إرسال الإشعار إن وجد دافع مناسب
      if (nudgePayload) {
        const ok = await sendSmartNudge(student, nudgePayload, io);
        if (ok) sentCount++;
      }
    }

    return { processed: students.length, sent: sentCount };
  } catch (err) {
    console.error('[KedySmartNotification] evaluateAndSendSmartNudges error:', err);
    return { processed: 0, sent: 0, error: err.message };
  }
}

module.exports = {
  recordActivity,
  sendSmartNudge,
  evaluateAndSendSmartNudges
};
