/**
 * quiz-review.test.js
 * - الطالب يراجع إجاباته (مع الصحيحة) بعد إغلاق الاختبار فقط.
 * - دكتور المادة يدير اختباراً أنشأه العميد لمادته (كانت "من أنشأه فقط").
 */
const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");

let baseUrl, batchId;
const T = {};
const day = 864e5;

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "x-batch-id": String(batchId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await r.json(); } catch { /* */ }
  return { status: r.status, data };
}

let openQuiz, closedQuiz;

test.before(async () => { baseUrl = `http://localhost:${(await startServer()).port}`; });
test.after(async () => { await stopServer(); });

test("Quiz review: seeding", async () => {
  resetDB();
  const M = n => mongoose.model(n);
  const batch = await M("Batch").create({ name: "دفعة", code: "QR", status: "active" });
  batchId = batch._id;
  const dean = await seedUser("عميد", "dean.qr@t.edu", "password123", "dean");
  const doctor = await seedUser("دكتور", "doc.qr@t.edu", "password123", "doctor", { batches: [batch._id] });
  const otherDoctor = await seedUser("دكتور آخر", "doc2.qr@t.edu", "password123", "doctor", { batches: [batch._id] });
  const student = await seedUser("طالب", "stu.qr@t.edu", "password123", "student", { batch: batch._id });
  Object.assign(T, { dean: dean.token, doctor: doctor.token, otherDoctor: otherDoctor.token, student: student.token, studentId: student.user._id });
  const subj = await M("Subject").create({ name: "شبكات", level: "4", doctor: doctor.user._id, batches: [batch._id] });
  const questions = [
    { text: "س1", options: ["أ", "ب", "ج"], correctOption: 1, points: 1 },
    { text: "س2", options: ["أ", "ب"], correctOption: 0, points: 1 }
  ];
  // كلا الاختبارين أنشأهما العميد لمادة الدكتور
  openQuiz = await M("Quiz").create({ title: "مفتوح", subject: subj._id, batch: batch._id, startsAt: new Date(Date.now() - day), endsAt: new Date(Date.now() + day), durationMinutes: 30, published: true, createdBy: dean.user._id, questions });
  closedQuiz = await M("Quiz").create({ title: "مغلق", subject: subj._id, batch: batch._id, startsAt: new Date(Date.now() - 2 * day), endsAt: new Date(Date.now() - day), durationMinutes: 30, published: true, createdBy: dean.user._id, questions });
  for (const q of [openQuiz, closedQuiz]) {
    await M("QuizAttempt").create({ quiz: q._id, student: student.user._id, answers: [{ questionIndex: 0, selectedOption: 1 }, { questionIndex: 1, selectedOption: 1 }], score: 1, maxScore: 2, startedAt: new Date(Date.now() - 2 * day), submittedAt: new Date(Date.now() - 2 * day), submitted: true });
  }
});

test("المراجعة ممنوعة والاختبار ما زال مفتوحاً (لا تتسرب الإجابات)", async () => {
  const r = await api(`/api/quizzes/${openQuiz._id}/review`, { token: T.student });
  assert.strictEqual(r.status, 403);
  assert.ok(!JSON.stringify(r.data).includes("correctOption"));
});

test("بعد الإغلاق: كل سؤال بإجابة الطالب والصحيحة", async () => {
  const r = await api(`/api/quizzes/${closedQuiz._id}/review`, { token: T.student });
  assert.strictEqual(r.status, 200, r.data.message);
  const qs = r.data.data.questions;
  assert.strictEqual(qs.length, 2);
  assert.deepStrictEqual(qs.map(q => [q.selectedOption, q.correctOption, q.isCorrect]), [[1, 1, true], [1, 0, false]]);
});

test("دكتور المادة يرى نتائج اختبار أنشأه العميد لمادته، والدكتور الآخر لا", async () => {
  assert.strictEqual((await api(`/api/quizzes/${closedQuiz._id}/results`, { token: T.doctor })).status, 200);
  assert.strictEqual((await api(`/api/quizzes/${closedQuiz._id}/results`, { token: T.otherDoctor })).status, 403);
});
