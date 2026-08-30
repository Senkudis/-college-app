/**
 * smart-features.test.js
 * اختبارات التحقق من الميزات الذكية:
 * 1. محرك الإنذار المبكر الأكاديمي (Early Warning Engine)
 * 2. توليد وحفظ الاختبارات الذكية (AI Quiz Generator)
 * 3. تصنيف وتقييم مؤشرات الخطر للطلاب
 */

const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");

let port, baseUrl;
let deanToken, doctorToken, studentToken;
let deanObj, doctorObj, studentObj;
let testBatchId, testSubjectId;

async function apiCall(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { ...options.headers };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  if (options.batch) headers["x-batch-id"] = String(options.batch);
  let body = options.body;
  if (body && typeof body === "object") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(url, { method: options.method || "GET", headers, body });
  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: response.status, data: json };
}

test.before(async () => {
  const server = await startServer();
  port = server.port;
  baseUrl = `http://localhost:${port}`;
});

test.after(async () => {
  await stopServer();
});

test("Smart Features: Database Seeding", async () => {
  resetDB();

  const Batch = mongoose.model("Batch");
  const batch = await Batch.create({
    name: "دفعة الذكاء الاصطناعي",
    code: "AI2026",
    themeColor: "#4f46e5",
    status: "active"
  });
  testBatchId = batch._id;

  const User = mongoose.model("User");
  ({ user: deanObj, token: deanToken }   = await seedUser("عميد الكلية", "dean_smart@elnasr.edu", "Password123!", ["dean"]));
  ({ user: doctorObj, token: doctorToken } = await seedUser("دكتور المادة", "doc_smart@elnasr.edu", "Password123!", ["doctor"]));
  ({ user: studentObj, token: studentToken } = await seedUser("طالب متعثر", "student_smart@elnasr.edu", "Password123!", ["student"]));

  await User.findByIdAndUpdate(doctorObj._id,  { batches: [testBatchId] });
  await User.findByIdAndUpdate(studentObj._id, { batch: testBatchId, points: 0 });

  const Subject = mongoose.model("Subject");
  const subject = await Subject.create({
    name: "معالجة اللغات الطبيعية",
    code: "AI302",
    level: 1,
    doctor: doctorObj._id,
    batches: [testBatchId]
  });
  testSubjectId = subject._id;

  assert.ok(deanToken && doctorToken && studentToken, "Tokens should be generated");
});

test("1. Early Academic Warning Engine (GET /api/reports/early-warning)", async (t) => {
  await t.test("returns early warning diagnostics and flags at-risk student for dean", async () => {
    const Attendance = mongoose.model("Attendance");
    const Assignment = mongoose.model("Assignment");

    // إعداد كشف حضور لطالب بنسبة حضور منخفضة
    await Attendance.create({
      subject: testSubjectId,
      date: "2026-08-01",
      recordedBy: doctorObj._id,
      students: [{ student: studentObj._id, status: "absent" }]
    });

    // إعداد واجب متأخر لم يسلمه الطالب
    await Assignment.create({
      title: "واجب تصنيف النصوص المتأخر",
      type: "exercise",
      file: "test_assignment.pdf",
      subject: testSubjectId,
      batches: [testBatchId],
      addedBy: doctorObj._id,
      dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    });

    const res = await apiCall(`/api/reports/early-warning?batch=${testBatchId}`, { token: deanToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.summary);
    assert.ok(Array.isArray(res.data.data.students));

    const target = res.data.data.students.find(s => String(s.id) === String(studentObj._id));
    assert.ok(target, "Target student must be in the report");
    assert.ok(["high", "medium"].includes(target.riskLevel), "Student must be flagged at risk");
    assert.ok(target.riskFactors.length > 0, "Risk factors must be populated");
    assert.ok(target.recommendedAction, "Recommended action must be present");
  });

  await t.test("rejects regular students from viewing early warning report", async () => {
    const res = await apiCall("/api/reports/early-warning", { token: studentToken });
    assert.strictEqual(res.status, 403);
  });
});

test("2. AI Quiz Generator Direct Save (POST /api/ai/quiz-gen)", async (t) => {
  await t.test("creates and saves quiz directly into DB when requested by doctor", async () => {
    const payload = {
      quizTitle: "اختبار تجريبي ذكي للذكاء الاصطناعي",
      subjectId: testSubjectId.toString(),
      batchId: testBatchId.toString(),
      count: 5,
      questionType: "mcq",
      durationMinutes: 20,
      text: "الشبكات الحاسوبية: بروتوكول TCP يعتمد على المصافحة الثلاثية لضمان وصول البيانات. بروتوكول UDP لا يضمن الوصول وهو أسرع للبث المباشر. عنوان IP ينقسم إلى IPv4 بطول 32 بت و IPv6 بطول 128 بت.",
      saveDirectly: true
    };

    const res = await apiCall("/api/ai/quiz-gen", {
      method: "POST",
      token: doctorToken,
      batch: testBatchId,
      body: payload
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.questions));
    assert.ok(res.data.questions.length >= 3);
    assert.ok(res.data.savedQuiz, "Saved quiz object should be returned");

    const Quiz = mongoose.model("Quiz");
    const dbQuiz = await Quiz.findById(res.data.savedQuiz._id);
    assert.ok(dbQuiz, "Quiz must exist in database");
    assert.strictEqual(dbQuiz.title, "اختبار تجريبي ذكي للذكاء الاصطناعي");
    assert.strictEqual(dbQuiz.published, true);
  });

  await t.test("generates True/False questions when questionType is true_false", async () => {
    const payload = {
      count: 3,
      questionType: "true_false",
      text: "نظام التشغيل لينكس هو نظام مفتوح المصدر تم تطوير نواته بواسطة لينوس تورفالدس عام 1991.",
      saveDirectly: false
    };

    const res = await apiCall("/api/ai/quiz-gen", {
      method: "POST",
      token: studentToken,
      body: payload
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.questions));
    assert.ok(res.data.questions.length > 0);
    assert.strictEqual(res.data.savedQuiz, null, "Should not save to DB when saveDirectly is false");
  });
});

test("3. Verified Digital Student Portfolio (GET /api/users/portfolio/:id)", async (t) => {
  await t.test("returns official verified academic record with institution seal", async () => {
    const res = await apiCall(`/api/users/portfolio/${studentObj._id}`, { token: deanToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.student);
    assert.ok(res.data.data.academicRecord);
    assert.ok(res.data.data.institution);
    assert.strictEqual(res.data.data.institution.verified, true);
    assert.strictEqual(res.data.data.student.name, "طالب متعثر");
    assert.ok(typeof res.data.data.academicRecord.attendanceRate === "number");
  });

  await t.test("returns 400 on invalid student ID", async () => {
    const res = await apiCall("/api/users/portfolio/invalid-id-999", { token: deanToken });
    assert.strictEqual(res.status, 400);
  });

  /* كان هذا المسار بلا مصادقة إطلاقاً — معرّف واحد يكشف السجل الأكاديمي
     الكامل لأي مستخدم. هذان الاختباران يمنعان عودة الثغرة. */
  await t.test("rejects anonymous access to a student record", async () => {
    const res = await apiCall(`/api/users/portfolio/${studentObj._id}`);
    assert.strictEqual(res.status, 401);
  });

  await t.test("lets a student read their own record", async () => {
    const res = await apiCall(`/api/users/portfolio/${studentObj._id}`, { token: studentToken });
    assert.strictEqual(res.status, 200);
  });
});
