const test = require("node:test");
const assert = require("node:assert/strict");
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

test("Advanced Academic Suite: Database Seeding", async () => {
  resetDB();

  const Batch = mongoose.model("Batch");
  const batch = await Batch.create({
    name: "دفعة تقنية المعلومات 2026",
    code: "IT2026",
    themeColor: "#2563eb",
    status: "active"
  });
  testBatchId = batch._id;

  ({ user: deanObj, token: deanToken }     = await seedUser("العميد الأكاديمي", "dean_suite@elnasr.edu", "Password123!", ["dean"]));
  ({ user: doctorObj, token: doctorToken } = await seedUser("دكتور الخوارزميات", "doc_suite@elnasr.edu", "Password123!", ["doctor"]));
  ({ user: studentObj, token: studentToken } = await seedUser("طالب متميز", "student_suite@elnasr.edu", "Password123!", ["student"], { batch: testBatchId }));

  const Subject = mongoose.model("Subject");
  const subject = await Subject.create({
    name: "خوارزميات وهياكل بيانات",
    level: "المستوى الثاني",
    batches: [testBatchId],
    doctor: doctorObj._id
  });
  testSubjectId = subject._id;
});

test("1. Interactive Code Lab Debugger (POST /api/ai/code-debug)", async () => {
  const res = await apiCall("/api/ai/code-debug", {
    method: "POST",
    token: studentToken,
    body: {
      language: "javascript",
      code: "function add(a, b) { return a + b;",
      errorOutput: "SyntaxError: Unexpected end of input"
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.language, "javascript");
  assert.ok(res.data.analysis.length > 10);
});

test("2. Past Papers & Smart Mock Simulator API", async (t) => {
  let createdExamId;

  await t.test("POST /api/past-exams - create past exam with questions", async () => {
    const res = await apiCall("/api/past-exams", {
      method: "POST",
      token: doctorToken,
      body: {
        title: "امتحان خوارزميات فاينل 2024/2025",
        subject: testSubjectId,
        year: "2024/2025",
        examType: "final",
        questions: [
          {
            text: "ما هو التعقيد الزمني لخوارزمية البحث الثنائي Binary Search؟",
            options: ["O(1)", "O(log n)", "O(n)", "O(n^2)"],
            correctOption: 1,
            explanation: "البحث الثنائي يقسم نطاق البحث إلى النصف في كل خطوة."
          },
          {
            text: "هيكل بيانات المكدس Stack يتبع مبدأ:",
            options: ["FIFO", "LIFO", "Random Access", "Priority"],
            correctOption: 1,
            explanation: "المكدس يتبع Last-In First-Out."
          }
        ]
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.ok(res.data.data?.exam?._id);
    createdExamId = res.data.data.exam._id;
  });

  await t.test("GET /api/past-exams - list past exams", async () => {
    const res = await apiCall(`/api/past-exams?subject=${testSubjectId}`, {
      token: studentToken
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.data.exams.length >= 1);
  });

  await t.test("POST /api/past-exams/:id/simulate - submit simulation answers and score", async () => {
    const res = await apiCall(`/api/past-exams/${createdExamId}/simulate`, {
      method: "POST",
      token: studentToken,
      body: {
        answers: { 0: 1, 1: 1 } // Both correct
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.percentage, 100);
    assert.equal(res.data.data.passed, true);
    assert.ok(res.data.data.aiDiagnosis.length > 5);
  });
});

test("3. Virtual Study Pods API", async (t) => {
  let createdPodId;
  let taskId;

  await t.test("POST /api/study-pods - create study session", async () => {
    const res = await apiCall("/api/study-pods", {
      method: "POST",
      token: studentToken,
      body: {
        title: "جلسة مذاكرة شيت الخوارزميات",
        subject: testSubjectId,
        batch: testBatchId
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.ok(res.data.data?.pod?._id);
    createdPodId = res.data.data.pod._id;
  });

  await t.test("POST /api/study-pods/:id/tasks - add shared target task", async () => {
    const res = await apiCall(`/api/study-pods/${createdPodId}/tasks`, {
      method: "POST",
      token: studentToken,
      body: {
        title: "حل مسائل التعقيد الزمني Big-O"
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.data?.task?.id);
    taskId = res.data.data.task.id;
  });

  await t.test("PUT /api/study-pods/:id/tasks/:taskId - toggle task completion", async () => {
    const res = await apiCall(`/api/study-pods/${createdPodId}/tasks/${taskId}`, {
      method: "PUT",
      token: studentToken,
      body: {}
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.task.completed, true);
  });

  await t.test("POST /api/study-pods/:id/timer - sync Pomodoro timer", async () => {
    const res = await apiCall(`/api/study-pods/${createdPodId}/timer`, {
      method: "POST",
      token: studentToken,
      body: {
        status: "running",
        remainingSeconds: 1200
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.data.timerState.status, "running");
  });
});

test("4. Anonymous Course Evaluation Surveys API", async (t) => {
  await t.test("GET /api/surveys/active - list active subjects for evaluation", async () => {
    const res = await apiCall("/api/surveys/active", {
      token: studentToken
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.data.subjects));
  });

  await t.test("POST /api/surveys/submit - submit anonymous evaluation", async () => {
    const res = await apiCall("/api/surveys/submit", {
      method: "POST",
      token: studentToken,
      body: {
        subjectId: testSubjectId,
        ratings: {
          contentClarity: 5,
          teachingMethod: 4,
          labUsefulness: 5,
          examFairness: 4
        },
        feedbackText: "مقرر متميز وشرح وافٍ جداً.",
        academicYear: "2025/2026"
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
  });

  await t.test("POST /api/surveys/submit - prevent duplicate submission", async () => {
    const res = await apiCall("/api/surveys/submit", {
      method: "POST",
      token: studentToken,
      body: {
        subjectId: testSubjectId,
        ratings: { contentClarity: 5, teachingMethod: 5, labUsefulness: 5, examFairness: 5 },
        academicYear: "2025/2026"
      }
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
  });

  await t.test("GET /api/surveys/analytics - dean retrieves quality satisfaction analytics", async () => {
    const res = await apiCall(`/api/surveys/analytics?subjectId=${testSubjectId}`, {
      token: deanToken
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.data.totalEvaluations, 1);
    assert.ok(res.data.data.satisfactionIndex >= 80);
    assert.equal(res.data.data.feedbacks.length, 1);
  });
});
