/**
 * routes/kedy-smart-notifications.test.js
 * اختبارات محرك إشعارات كيدي الذكية (Duolingo-Style Engagement Engine)
 */

const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");
const kedyService = require("../services/kedySmartNotification.service");
const User = require("../models/User");
const Notification = require("../models/Notification");
const Assignment = require("../models/Assignment");
const Subject = require("../models/Subject");

let port;
let baseUrl;
let studentToken, deanToken;
let studentUser, deanUser;
const testBatchId = new mongoose.Types.ObjectId();

test.before(async () => {
  const server = await startServer();
  port = server.port;
  baseUrl = `http://localhost:${port}`;
});

test.after(async () => {
  await stopServer();
});

test("Kedy Smart Notifications Engine", async (t) => {
  await resetDB();

  // تهيئة الطلاب والمشرف
  const deanData = await seedUser("Dean Kedy", "dean_kedy@test.com", "dean1234", ["dean"]);
  deanToken = deanData.token;
  deanUser = deanData.user;

  const studentData = await seedUser("Ahmed Student", "ahmed_kedy@test.com", "student123", ["student"], { batch: testBatchId });
  studentToken = studentData.token;
  studentUser = studentData.user;

  await t.test("recordActivity: يسجل نشاط الطالب ويزيد الستريك عند المتابعة اليومية", async () => {
    // نشاط أولي
    const res1 = await kedyService.recordActivity(studentUser._id);
    assert.strictEqual(res1.streak, 1);

    /* "قبل ٢٥ ساعة" ليس دائماً أمسِ: عند تشغيل الاختبار بعد منتصف الليل
       بقليل يقع التاريخ قبل يومين تقويميين فينكسر الستريك ويفشل الاختبار
       بلا علاقة بالكود. نحسب أمسِ صراحةً بتوقيت الكلية بدل الطرح الأعمى. */
    const OFFSET_H = Number(process.env.COLLEGE_UTC_OFFSET || 2);
    const localNow = new Date(Date.now() + OFFSET_H * 3600000);
    const yesterdayLocalNoon = new Date(Date.UTC(
      localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() - 1, 12, 0, 0
    ));

    const user = await User.findById(studentUser._id);
    user.lastStreakDate = new Date(yesterdayLocalNoon.getTime() - OFFSET_H * 3600000);
    await user.save();

    const res2 = await kedyService.recordActivity(studentUser._id);
    assert.strictEqual(res2.streak, 2);
    assert.ok(res2.points >= 10);
  });

  await t.test("evaluateAndSendSmartNudges: يكتشف اقتراب موعد تسليم الواجب ويرسل تنبيهاً ذكياً", async () => {
    // إنشاء مادة وتكليف ينتهي خلال 12 ساعة
    const subject = await Subject.create({
      name: "هياكل البيانات",
      level: 2,
      doctor: deanUser._id,
      batches: [testBatchId]
    });

    const urgentAssignment = await Assignment.create({
      title: "تطبيق المكدس Stack",
      subject: subject._id,
      batches: [testBatchId],
      dueDate: new Date(Date.now() + 12 * 60 * 60 * 1000), // بعد 12 ساعة
      dueTime: "23:59",
      type: "exercise",
      file: "test_assignment.pdf",
      addedBy: deanUser._id
    });

    // إعادة ضبط وقت آخر تنبيه للطالب ليسمح بإرسال إشعار
    await User.findByIdAndUpdate(studentUser._id, { lastKedyNudgeAt: null });

    const result = await kedyService.evaluateAndSendSmartNudges(null);
    assert.ok(result.sent >= 1, "يجب إرسال إشعار واحد على الأقل");

    // التحقق من إنشاء إشعار في قاعدة البيانات
    const notif = await Notification.findOne({
      recipients: studentUser._id
    });
    assert.ok(notif, "الإشعار الذكي غير موجود في قاعدة البيانات");
    assert.ok(notif.title.includes("كيدي"), "عنوان الإشعار يجب أن يحمل هوية كيدي");
  });

  await t.test("POST /api/ai/trigger-smart-notifications: متاح للمشرف ومحظور على الطالب", async () => {
    // محاولة الطالب
    const studentRes = await fetch(`${baseUrl}/api/ai/trigger-smart-notifications`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${studentToken}` }
    });
    assert.strictEqual(studentRes.status, 403);

    // محاولة العميد
    const deanRes = await fetch(`${baseUrl}/api/ai/trigger-smart-notifications`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${deanToken}` }
    });
    assert.strictEqual(deanRes.status, 200);
    const data = await deanRes.json();
    assert.strictEqual(data.success, true);
    assert.ok(typeof data.result?.processed === 'number');
  });
});
