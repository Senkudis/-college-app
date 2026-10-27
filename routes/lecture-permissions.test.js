/**
 * lecture-permissions.test.js
 * من يدير محاضرة: العميد الكل، الرافع محاضرته، الدكتور مواده، الليدر مواد دفعته.
 * كانت القاعدة "من رفعها فقط" فلا يحذف الليدر محاضرة رفعها الدكتور في مادة دفعته.
 */
const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");

let baseUrl;
const T = {};
const ids = {};

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await r.json(); } catch { /* */ }
  return { status: r.status, data };
}

async function newLecture(title, uploader, subject) {
  const l = await mongoose.model("Lecture").create({ title, subject, file: "x.pdf", uploadedBy: uploader });
  return String(l._id);
}

test.before(async () => {
  const s = await startServer();
  baseUrl = `http://localhost:${s.port}`;
});
test.after(async () => { await stopServer(); });

test("Lecture permissions: seeding", async () => {
  resetDB();
  const Batch = mongoose.model("Batch");
  const Subject = mongoose.model("Subject");
  const bA = await Batch.create({ name: "دفعة أ", code: "LA", status: "active" });
  const bB = await Batch.create({ name: "دفعة ب", code: "LB", status: "active" });
  const doctor = await seedUser("د. المادة", "doc.lp@t.edu", "password123", "doctor");
  const otherDoctor = await seedUser("د. آخر", "doc2.lp@t.edu", "password123", "doctor");
  const leaderA = await seedUser("ليدر أ", "leaderA.lp@t.edu", "password123", ["student", "leader"], { batch: bA._id });
  const leaderB = await seedUser("ليدر ب", "leaderB.lp@t.edu", "password123", ["student", "leader"], { batch: bB._id });
  const student = await seedUser("طالب", "stu.lp@t.edu", "password123", "student", { batch: bA._id });
  Object.assign(T, { doctor: doctor.token, otherDoctor: otherDoctor.token, leaderA: leaderA.token, leaderB: leaderB.token, student: student.token });
  const subj = await Subject.create({ name: "قواعد البيانات", level: "4", doctor: doctor.user._id, batches: [bA._id] });
  ids.subject = String(subj._id);
  ids.doctorUser = doctor.user._id;
  ids.leaderAUser = leaderA.user._id;
});

test("الليدر يحذف محاضرة رفعها الدكتور في مادة دفعته", async () => {
  const id = await newLecture("محاضرة الدكتور", ids.doctorUser, ids.subject);
  const r = await api(`/api/lectures/${id}`, { method: "DELETE", token: T.leaderA });
  assert.strictEqual(r.status, 200, r.data.message);
});

test("ليدر دفعة أخرى لا يحذف", async () => {
  const id = await newLecture("محاضرة 2", ids.doctorUser, ids.subject);
  const r = await api(`/api/lectures/${id}`, { method: "DELETE", token: T.leaderB });
  assert.strictEqual(r.status, 403);
});

test("الدكتور يحذف ويعدّل ما رفعه الليدر في مادته، والدكتور الآخر لا", async () => {
  const id = await newLecture("رفع الليدر", ids.leaderAUser, ids.subject);
  assert.strictEqual((await api(`/api/lectures/${id}`, { method: "PUT", token: T.otherDoctor, body: { title: "x" } })).status, 403);
  assert.strictEqual((await api(`/api/lectures/${id}`, { method: "PUT", token: T.doctor, body: { title: "اسم جديد" } })).status, 200);
  assert.strictEqual((await api(`/api/lectures/${id}`, { method: "DELETE", token: T.doctor })).status, 200);
});

test("الطالب العادي لا يحذف", async () => {
  const id = await newLecture("محاضرة 3", ids.doctorUser, ids.subject);
  const r = await api(`/api/lectures/${id}`, { method: "DELETE", token: T.student });
  assert.strictEqual(r.status, 403);
});

test("القائمة تُرجع canManage الصحيح ولا تكشف طبيب المادة ودفعاتها", async () => {
  await newLecture("محاضرة للقائمة", ids.doctorUser, ids.subject);
  const leader = await api(`/api/lectures?subject=${ids.subject}`, { token: T.leaderA });
  assert.strictEqual(leader.status, 200);
  assert.ok(leader.data.length > 0 && leader.data.every(l => l.canManage === true));
  assert.ok(leader.data.every(l => l.subject && l.subject.doctor === undefined && l.subject.batches === undefined));
  const stu = await api(`/api/lectures?subject=${ids.subject}`, { token: T.student });
  assert.ok(stu.data.every(l => l.canManage === false));
});
