/**
 * audit-fixes.test.js — إصلاحات فحص 2026-10-22:
 * 1. حدّ محاولات الدخول لكل حساب لا لكل شبكة (طلاب الحرم خلف IP واحد)
 * 2. نماذج الامتحانات السابقة: الدكتور يضيف لمواده فقط
 * 3. تعديل رصد حصة لا يكرّر تحذير الغياب لمن كان غائباً أصلاً
 */
const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");

let baseUrl;
async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}

test.before(async () => {
  const server = await startServer();
  baseUrl = `http://localhost:${server.port}`;
  await resetDB();
});
test.after(async () => { await stopServer(); });

test("failed logins on one account do not lock other students on the same network", async () => {
  await seedUser("طالب أ", "a@uni.edu", "Secret123", ["student"], { firstLogin: false });
  await seedUser("طالب ب", "b@uni.edu", "Secret123", ["student"], { firstLogin: false });
  for (let i = 0; i < 5; i++) {
    const r = await api("/api/auth/login", { method: "POST", body: { email: "a@uni.edu", password: "wrong-pass" } });
    assert.notStrictEqual(r.status, 200);
  }
  const blocked = await api("/api/auth/login", { method: "POST", body: { email: "a@uni.edu", password: "wrong-pass" } });
  assert.strictEqual(blocked.status, 429, "the account under attack is throttled");

  const other = await api("/api/auth/login", { method: "POST", body: { email: "b@uni.edu", password: "Secret123" } });
  assert.notStrictEqual(other.status, 429, "a classmate on the same IP can still sign in");
});

test("a doctor can add past exams only to subjects he teaches", async () => {
  const { user: d1, token: t1 } = await seedUser("د. أ", "d1@uni.edu", "Secret123", ["doctor"]);
  const { user: d2 } = await seedUser("د. ب", "d2@uni.edu", "Secret123", ["doctor"]);
  const Subject = mongoose.model("Subject");
  const mine = await Subject.create({ name: "شبكات", level: "المستوى الأول", doctor: d1._id, batches: [] });
  const theirs = await Subject.create({ name: "رياضيات", level: "المستوى الأول", doctor: d2._id, batches: [] });

  const denied = await api("/api/past-exams", { method: "POST", token: t1, body: { title: "نهائي 2024", subject: String(theirs._id), year: "2024" } });
  assert.strictEqual(denied.status, 403);
  const ok = await api("/api/past-exams", { method: "POST", token: t1, body: { title: "نهائي 2024", subject: String(mine._id), year: "2024" } });
  assert.strictEqual(ok.status, 201);
});

test("re-saving the same attendance session does not repeat the absence warning", async () => {
  const Batch = mongoose.model("Batch");
  const Subject = mongoose.model("Subject");
  const Notification = mongoose.model("Notification");
  const batch = await Batch.create({ name: "دفعة اختبار", code: "T1", status: "active" });
  const { user: doc, token } = await seedUser("د. ج", "d3@uni.edu", "Secret123", ["doctor"], { batches: [batch._id] });
  const { user: stu } = await seedUser("طالب ج", "c@uni.edu", "Secret123", ["student"], { batch: batch._id });
  const subject = await Subject.create({ name: "برمجة", level: "المستوى الأول", doctor: doc._id, batches: [batch._id] });

  const body = { subject: String(subject._id), date: "2026-10-01", students: [{ student: String(stu._id), status: "absent" }] };
  const warnings = async () => (await Notification.find({ recipients: stu._id })).length;

  assert.strictEqual((await api("/api/attendance", { method: "POST", token, body })).status, 200);
  await new Promise(r => setTimeout(r, 150)); // التحذير يُرسل بعد الرد
  const first = await warnings();
  assert.strictEqual(first, 1);

  assert.strictEqual((await api("/api/attendance", { method: "POST", token, body })).status, 200);
  await new Promise(r => setTimeout(r, 150));
  assert.strictEqual(await warnings(), first, "editing the session must not warn the same student again");
});

test("Kedy's finance context is the student's own balance, not the whole batch", async () => {
  const ai = require("./ai.routes.js")._internals;
  const Batch = mongoose.model("Batch"), Fee = mongoose.model("Fee"), Payment = mongoose.model("Payment");
  const batch = await Batch.create({ name: "دفعة المال", code: "FIN1", status: "active" });
  const { user: me } = await seedUser("طالب المال", "fin-me@uni.edu", "Secret123", ["student"], { batch: batch._id });
  const { user: mate } = await seedUser("زميل", "fin-mate@uni.edu", "Secret123", ["student"], { batch: batch._id });
  const due = new Date(Date.now() + 5 * 864e5);
  await Fee.create({ student: me._id, batch: batch._id, title: "رسوم", amount: 500000, discount: 50000, dueDate: due, createdBy: mate._id });
  await Fee.create({ student: mate._id, batch: batch._id, title: "رسوم", amount: 500000, dueDate: due, createdBy: mate._id });
  await Payment.create({ student: me._id, amount: 100000, paymentMethod: "cash", reference: "KEDY-FIN-1", recordedBy: mate._id });

  const s = await ai.getLiveStudentSections(String(me._id), batch._id);
  assert.match(s.finance, /إجمالي الرسوم: 450,000/, "own fee, net of discount — not the classmate's");
  assert.match(s.finance, /المسدد: 100,000/, "payments counted (no non-existent status filter)");
  assert.match(s.finance, /المتبقي المطلوب: 350,000/);
});

test("provider race: a hung provider does not block a healthy one", async () => {
  const { raceProviders } = require("./ai.routes.js")._internals;
  const plan = [{ name: "slow" }, { name: "fast" }];
  const t0 = Date.now();
  const answer = await raceProviders(plan, step => step.name === "slow"
    ? new Promise((_, rej) => step.opts.signal.addEventListener("abort", () => rej(new Error("CANCELLED"))))
    : Promise.resolve("رد سليم"), { budgetMs: 5000, hedgeAfterMs: 200 });
  assert.strictEqual(answer, "رد سليم");
  assert.ok(Date.now() - t0 < 2000, "the second provider starts after the hedge delay, not after a full timeout");

  await assert.rejects(
    raceProviders([{ name: "a" }], () => Promise.reject(new Error("boom")), { budgetMs: 2000, hedgeAfterMs: 100 }),
    /ALL_AI_SYSTEMS_DOWN/
  );
  await assert.rejects(
    raceProviders([{ name: "hang" }], step => new Promise((_, rej) => step.opts.signal.addEventListener("abort", () => rej(new Error("x")))), { budgetMs: 300, hedgeAfterMs: 100 }),
    /AI_TIMEOUT/
  );
});

test("submission files are removed on undo and when the upload is rejected", async () => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "uploads", "submissions");
  const Batch = mongoose.model("Batch"), Subject = mongoose.model("Subject"), Assignment = mongoose.model("Assignment");
  const batch = await Batch.create({ name: "دفعة الملفات", code: "FILE1", status: "active" });
  const { user: doc } = await seedUser("د. ملفات", "file-doc@uni.edu", "Secret123", ["doctor"], { batches: [batch._id] });
  const { token } = await seedUser("طالب ملفات", "file-stu@uni.edu", "Secret123", ["student"], { batch: batch._id, firstLogin: false });
  const subject = await Subject.create({ name: "ملفات", level: "المستوى الأول", doctor: doc._id, batches: [batch._id] });
  const day = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const open = await Assignment.create({ title: "مفتوح", type: "exercise", subject: subject._id, file: "a.pdf", dueDate: day(5), dueTime: "23:59", addedBy: doc._id, batches: [batch._id] });
  const late = await Assignment.create({ title: "منتهي", type: "exercise", subject: subject._id, file: "b.pdf", dueDate: day(-5), dueTime: "23:59", addedBy: doc._id, batches: [batch._id] });

  const send = async assignmentId => {
    const fd = new FormData();
    fd.append("assignmentId", String(assignmentId));
    fd.append("file", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "work.pdf");
    const r = await fetch(baseUrl + "/api/submissions/submit", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, data: await r.json() };
  };
  const files = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

  const before = files().length;
  const rejected = await send(late._id);
  assert.strictEqual(rejected.status, 400);
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(files().length, before, "a rejected late upload leaves no file behind");

  const ok = await send(open._id);
  assert.strictEqual(ok.status, 201);
  const saved = ok.data.data.submission.file;
  assert.ok(files().includes(saved));
  const undo = await api(`/api/submissions/${ok.data.data.submission._id}/undo`, { method: "DELETE", token });
  assert.strictEqual(undo.status, 200);
  assert.ok(!files().includes(saved), "undo deletes the stored file");
});
