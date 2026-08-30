/**
 * routes/moderation.test.js — الإبلاغ والحظر (متطلب App Store 1.2)
 *
 * هذه المسارات شرط قبول في المتجر، فأي كسر فيها يعني رفض التحديث كله.
 */
const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");

let baseUrl;

async function apiCall(path, options = {}) {
  const headers = { ...options.headers };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  let body = options.body;
  if (body && typeof body === "object") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method: options.method || "GET", headers, body });
  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: response.status, data: json };
}
let deanToken, studentToken, otherToken;
let studentUser, otherUser;

test.before(async () => {
  const server = await startServer();
  baseUrl = `http://localhost:${server.port}`;
});
test.after(async () => { await stopServer(); });

test("Moderation: الإبلاغ والحظر ومراجعة الإدارة", async (t) => {
  await resetDB();

  const batchId = new mongoose.Types.ObjectId();
  ({ token: deanToken } = await seedUser("عميد", "dean_mod@test.com", "Pass1234!", ["dean"]));
  ({ user: studentUser, token: studentToken } = await seedUser("طالب مبلِّغ", "s1_mod@test.com", "Pass1234!", ["student"], { batch: batchId }));
  ({ user: otherUser, token: otherToken } = await seedUser("طالب مخالف", "s2_mod@test.com", "Pass1234!", ["student"], { batch: batchId }));

  // تعليق يملكه الطالب الآخر، ليُبلَّغ عنه
  const comment = await mongoose.model("VideoComment").create({
    video: new mongoose.Types.ObjectId(),
    author: otherUser._id,
    text: "تعليق مسيء للاختبار"
  });

  await t.test("الإبلاغ يتطلب سبباً صالحاً", async () => {
    const res = await apiCall("/api/moderation/report", {
      method: "POST", token: studentToken,
      body: { targetType: "comment", targetId: String(comment._id), reason: "غير-موجود" }
    });
    assert.strictEqual(res.status, 400);
  });

  let reportId;
  await t.test("الطالب يبلّغ عن تعليق مسيء", async () => {
    const res = await apiCall("/api/moderation/report", {
      method: "POST", token: studentToken,
      body: { targetType: "comment", targetId: String(comment._id), reason: "harassment", details: "إساءة مباشرة" }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    reportId = res.data.data.reportId;
    assert.ok(reportId);
  });

  await t.test("لا يمكن الإبلاغ عن محتوى المستخدم نفسه", async () => {
    const res = await apiCall("/api/moderation/report", {
      method: "POST", token: otherToken,
      body: { targetType: "comment", targetId: String(comment._id), reason: "spam" }
    });
    assert.strictEqual(res.status, 400);
  });

  /* مهام غرف المذاكرة تحمل معرّفاً نصياً لا ObjectId. اشتراط ObjectId
     كان يرفض كل بلاغ عليها بـ400 رغم وجود الزر في الواجهة. */
  await t.test("الإبلاغ عن مهمة بمعرّف نصّي يُقبل", async () => {
    const taskId = `${Date.now()}-ab12`;
    await mongoose.model("StudyPod").create({
      title: "غرفة اختبار",
      subject: new mongoose.Types.ObjectId(),
      batch: batchId,
      createdBy: otherUser._id,
      tasks: [{ id: taskId, title: "مهمة مخالفة للاختبار", completed: false }]
    });

    const res = await apiCall("/api/moderation/report", {
      method: "POST", token: studentToken,
      body: { targetType: "pod-task", targetId: taskId, reason: "spam" }
    });
    assert.strictEqual(res.status, 201, "المعرّف النصّي يجب أن يُقبل لا أن يُرفض بـ400");
  });

  await t.test("الطالب لا يرى طابور المراجعة", async () => {
    const res = await apiCall("/api/moderation/reports", { token: studentToken });
    assert.strictEqual(res.status, 403);
  });

  await t.test("العميد يرى البلاغ في قائمة المعلّقة", async () => {
    const res = await apiCall("/api/moderation/reports?status=pending", { token: deanToken });
    assert.strictEqual(res.status, 200);
    const payload = res.data.data || res.data;
    assert.ok(payload.reports.length >= 1);
    assert.strictEqual(payload.slaHours, 24);
  });

  await t.test("الحظر يمنع ظهور محتوى المحظور", async () => {
    const res = await apiCall(`/api/moderation/block/${otherUser._id}`, { method: "POST", token: studentToken });
    assert.strictEqual(res.status, 200);

    const list = await apiCall("/api/moderation/blocked", { token: studentToken });
    const payload = list.data.data || list.data;
    assert.strictEqual(payload.blocked.length, 1);
  });

  await t.test("إلغاء الحظر يعيد الوضع", async () => {
    const res = await apiCall(`/api/moderation/block/${otherUser._id}`, { method: "DELETE", token: studentToken });
    assert.strictEqual(res.status, 200);
    const list = await apiCall("/api/moderation/blocked", { token: studentToken });
    const payload = list.data.data || list.data;
    assert.strictEqual(payload.blocked.length, 0);
  });

  await t.test("العميد يزيل المحتوى المخالف فيُحذف فعلاً", async () => {
    const res = await apiCall(`/api/moderation/reports/${reportId}/action`, {
      method: "POST", token: deanToken, body: { action: "remove", note: "مخالف" }
    });
    assert.strictEqual(res.status, 200);

    const gone = await mongoose.model("VideoComment").findById(comment._id);
    assert.strictEqual(gone, null, "يجب أن يُحذف التعليق فعلاً لا أن يُعلَّم فقط");
  });

  await t.test("لا يمكن البتّ في بلاغ مرتين", async () => {
    const res = await apiCall(`/api/moderation/reports/${reportId}/action`, {
      method: "POST", token: deanToken, body: { action: "dismiss" }
    });
    assert.strictEqual(res.status, 409);
  });
});
