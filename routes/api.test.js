const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");

let port;
let baseUrl;

// Global seed data variables
let deanToken, doctorToken, studentToken, leaderToken;
let deanUser, doctorUser, studentUser, leaderUser;
const testBatchId = "6688f111e111111111111111"; // Mock ObjectId hex
const otherBatchId = "6688f222e222222222222222";
const aiSubjectId = "6688f333e333333333333333";
const aiOtherSubjectId = "6688f444e444444444444444";
const aiLectureId = "6688f555e555555555555555";
let subjectId;
let assignmentId;
let submissionId;
let notificationId;

test.before(async () => {
  const server = await startServer();
  port = server.port;
  baseUrl = `http://localhost:${port}`;
});

test.after(async () => {
  await stopServer();
});

// Helper for HTTP requests using native fetch
async function apiCall(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { ...options.headers };
  
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body
  });
  
  const text = await response.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch (e) {
    // Return empty object on parsing failure
  }
  
  return { status: response.status, data: json, text };
}

// 1. Seeding Users and Batches
test("Seeding users & initial data", async () => {
  resetDB();
  
  // Seed the batch first
  const Batch = mongoose.model("Batch");
  await Batch.create({
    _id: testBatchId,
    name: "Class of 2026",
    code: "CS2026",
    themeColor: "#6366f1",
    status: "active"
  });

  // Seed dean
  const dean = await seedUser("Dean User", "dean@college.edu", "password123", "dean");
  deanToken = dean.token;
  deanUser = dean.user;
  
  // Seed doctor (assigned to the test batch so subjects/assignments auto-link to it)
  const doctor = await seedUser("Doctor User", "doctor@college.edu", "password123", "doctor", { batches: [testBatchId] });
  doctorToken = doctor.token;
  doctorUser = doctor.user;
  
  // Seed leader
  const leader = await seedUser("Leader User", "leader@college.edu", "password123", "leader", { batch: testBatchId });
  leaderToken = leader.token;
  leaderUser = leader.user;
  
  // Seed student
  const student = await seedUser("Student User", "student@college.edu", "password123", "student", { batch: testBatchId });
  studentToken = student.token;
  studentUser = student.user;
  
  assert.ok(deanUser._id);
  assert.ok(doctorUser._id);
  assert.ok(studentUser._id);
});

// 2. Batch Authorization Scope Tests
test("Batch authorization scope tests", async (t) => {
  const Batch = mongoose.model("Batch");
  const Subject = mongoose.model("Subject");

  await Batch.create({
    _id: otherBatchId,
    name: "Class of 2027",
    code: "CS2027",
    themeColor: "#14b8a6",
    status: "active"
  });

  const unassignedDoctor = await seedUser(
    "Unassigned Doctor",
    "unassigned.doctor@college.edu",
    "password123",
    "doctor",
    { batches: [] }
  );
  const linkedDoctor = await seedUser(
    "Linked Doctor",
    "linked.doctor@college.edu",
    "password123",
    "doctor",
    { batches: [] }
  );
  await Subject.create({
    name: "Linked Batch Subject",
    level: "Level 4",
    doctor: linkedDoctor.user._id,
    batches: [otherBatchId]
  });

  await t.test("GET /api/batches - unassigned doctor receives no batches", async () => {
    const res = await apiCall("/api/batches", { token: unassignedDoctor.token });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.batches, []);
  });

  await t.test("GET /api/batches - assigned doctor receives only assigned batches", async () => {
    const res = await apiCall("/api/batches", { token: doctorToken });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.batches.map(batch => batch._id.toString()), [testBatchId]);
  });

  await t.test("GET /api/batches/:id - doctor cannot open an unrelated batch", async () => {
    const res = await apiCall(`/api/batches/${otherBatchId}`, { token: doctorToken });
    assert.strictEqual(res.status, 403);
  });

  await t.test("GET /api/batches/:id - doctor can open a batch linked through a subject", async () => {
    const res = await apiCall(`/api/batches/${otherBatchId}`, { token: linkedDoctor.token });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
  });

  await t.test("GET /api/batches/:id - student and leader cannot open another batch", async () => {
    const studentRes = await apiCall(`/api/batches/${otherBatchId}`, { token: studentToken });
    const leaderRes = await apiCall(`/api/batches/${otherBatchId}`, { token: leaderToken });
    assert.strictEqual(studentRes.status, 403);
    assert.strictEqual(leaderRes.status, 403);
  });
});

// 3. AI Content Authorization Tests
 test("AI content authorization scope tests", async (t) => {
  const Subject = mongoose.model("Subject");
  const Lecture = mongoose.model("Lecture");
  const otherDoctor = await seedUser("AI Other Doctor", "ai.other.doctor@college.edu", "password123", "doctor", { batches: [otherBatchId] });
  const otherStudent = await seedUser("AI Other Student", "ai.other.student@college.edu", "password123", "student", { batch: otherBatchId });

  await Subject.create({
    _id: aiSubjectId,
    name: "AI Scoped Subject",
    level: "Level 4",
    doctor: doctorUser._id,
    batches: [testBatchId]
  });
  await Subject.create({
    _id: aiOtherSubjectId,
    name: "AI Other Subject",
    level: "Level 4",
    doctor: otherDoctor.user._id,
    batches: [otherBatchId]
  });
  await Lecture.create({
    _id: aiLectureId,
    title: "AI Scoped Lecture",
    subject: aiSubjectId,
    extractedText: "هذه محاضرة اختبارية عن قواعد البيانات والعلاقات بين الجداول والفهارس."
  });

  await t.test("subject-context allows the assigned batch and denies another batch", async () => {
    const allowed = await apiCall(`/api/ai/subject-context/${aiSubjectId}`, { token: studentToken });
    const denied = await apiCall(`/api/ai/subject-context/${aiSubjectId}`, { token: otherStudent.token });
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual(allowed.data.success, true);
    assert.strictEqual(denied.status, 403);
  });

  await t.test("subject-context restricts doctors to owned subjects", async () => {
    const allowed = await apiCall(`/api/ai/subject-context/${aiSubjectId}`, { token: doctorToken });
    const denied = await apiCall(`/api/ai/subject-context/${aiSubjectId}`, { token: otherDoctor.token });
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual(denied.status, 403);
  });

  await t.test("lecture-context follows the linked subject scope", async () => {
    const allowed = await apiCall(`/api/ai/lecture-context/${aiLectureId}`, { token: studentToken });
    const deniedStudent = await apiCall(`/api/ai/lecture-context/${aiLectureId}`, { token: otherStudent.token });
    const deniedDoctor = await apiCall(`/api/ai/lecture-context/${aiLectureId}`, { token: otherDoctor.token });
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual(allowed.data.hasText, true);
    assert.strictEqual(deniedStudent.status, 403);
    assert.strictEqual(deniedDoctor.status, 403);
  });

  await t.test("selected-subject chat cannot enumerate another batch", async () => {
    const allowed = await apiCall("/api/ai/ask", {
      method: "POST",
      token: studentToken,
      body: { prompt: "اخترت مادة", selectedSubjectId: aiSubjectId }
    });
    const denied = await apiCall("/api/ai/ask", {
      method: "POST",
      token: otherStudent.token,
      body: { prompt: "اخترت مادة", selectedSubjectId: aiSubjectId }
    });
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual(allowed.data.interactive?.type, "select_scope");
    assert.strictEqual(denied.status, 403);
  });
});

// 4. Auth Module Tests
test("Auth Module Tests", async (t) => {
  await t.test("POST /api/auth/login - Success with correct credentials", async () => {
    const res = await apiCall("/api/auth/login", {
      method: "POST",
      body: { email: "dean@college.edu", password: "password123" }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.token);
    // Login rotates the active session; subsequent dean requests must use the
    // new token, just as the browser client does.
    deanToken = res.data.token;
  });
  
  await t.test("POST /api/auth/login - Failure with incorrect password", async () => {
    const res = await apiCall("/api/auth/login", {
      method: "POST",
      body: { email: "dean@college.edu", password: "wrongpassword" }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
  });

  await t.test("POST /api/auth/register - Success (dean only)", async () => {
    const res = await apiCall("/api/auth/register", {
      method: "POST",
      token: deanToken,
      body: {
        name: "New Student",
        email: "newstudent@college.edu",
        password: "password123",
        roles: ["student"],
        batch: testBatchId
      }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
  });
  
  await t.test("POST /api/auth/register - Forbidden for non-dean (student)", async () => {
    const res = await apiCall("/api/auth/register", {
      method: "POST",
      token: studentToken,
      body: {
        name: "New Student 2",
        email: "newstudent2@college.edu",
        password: "password123",
        roles: ["student"],
        batch: testBatchId
      }
    });
    assert.strictEqual(res.status, 403);
  });
});

// 3. Users Module Tests
test("Users Module Tests", async (t) => {
  await t.test("GET /api/users - Success for dean", async () => {
    const res = await apiCall("/api/users", { token: deanToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.users));
  });

  await t.test("GET /api/users - Forbidden for student", async () => {
    const res = await apiCall("/api/users", { token: studentToken });
    assert.strictEqual(res.status, 403);
  });

  await t.test("POST /api/users - Create User as Dean", async () => {
    const res = await apiCall("/api/users", {
      method: "POST",
      token: deanToken,
      body: {
        name: "Created User",
        email: "created@college.edu",
        password: "password123",
        roles: ["student"]
      }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
  });
});

// 4. Subjects Module Tests
test("Subjects Module Tests", async (t) => {
  await t.test("POST /api/subjects - Create subject as Dean", async () => {
    const res = await apiCall("/api/subjects", {
      method: "POST",
      token: deanToken,
      body: {
        name: "Web Development",
        level: "Level 3",
        doctor: doctorUser._id.toString()
      }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.subject._id);
    subjectId = res.data.data.subject._id;
  });

  await t.test("GET /api/subjects - Get subjects list", async () => {
    const res = await apiCall("/api/subjects", { token: studentToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.subjects.length > 0);
  });
});

// 5. Lectures Module Tests
test("Lectures Module Tests", async (t) => {
  await t.test("POST /api/lectures - Create lecture as Doctor", async () => {
    const formData = new FormData();
    formData.append("title", "Introduction to HTML");
    formData.append("subject", subjectId);
    formData.append("videoUrl", "https://example.com/html-intro");
    
    const res = await apiCall("/api/lectures", {
      method: "POST",
      token: doctorToken,
      body: formData
    });
    
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.data._id);
  });

  await t.test("GET /api/lectures - List lectures", async () => {
    const res = await apiCall("/api/lectures", { token: studentToken });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data));
  });
});

// 6. Assignments Module Tests
test("Assignments Module Tests", async (t) => {
  await t.test("POST /api/assignments - Create assignment as Doctor", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDateStr = tomorrow.toISOString().split("T")[0]; // YYYY-MM-DD
    
    const formData = new FormData();
    formData.append("title", "HTML Basics Assignment");
    formData.append("description", "Build a basic HTML page");
    formData.append("type", "exercise");
    formData.append("subject", subjectId);
    formData.append("dueDate", dueDateStr);
    formData.append("dueTime", "23:59");
    formData.append("batches", JSON.stringify([testBatchId]));
    
    // Append dummy file
    formData.append("file", new Blob(["Assignment doc"], { type: "text/plain" }), "assignment.txt");

    const res = await apiCall("/api/assignments", {
      method: "POST",
      token: doctorToken,
      body: formData
    });
    
    assert.strictEqual(res.status, 201);
    assert.ok(res.data.data.assignment._id);
    assignmentId = res.data.data.assignment._id;
  });
});

// 7. Submissions Module Tests
test("Submissions Module Tests", async (t) => {
  await t.test("POST /api/submissions/submit - Submit assignment as Student", async () => {
    const formData = new FormData();
    formData.append("assignmentId", assignmentId);
    formData.append("submissionType", "exercise");
    formData.append("notes", "Here is my submission");
    formData.append("file", new Blob(["My index.html code"], { type: "text/plain" }), "index.html");

    const res = await apiCall("/api/submissions/submit", {
      method: "POST",
      token: studentToken,
      body: formData
    });
    
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.submission._id);
    submissionId = res.data.data.submission._id;
  });

  await t.test("PUT /api/submissions/:id/grade - Grade submission as Doctor", async () => {
    const res = await apiCall(`/api/submissions/${submissionId}/grade`, {
      method: "PUT",
      token: doctorToken,
      body: {
        grade: 95,
        feedback: "Excellent work!"
      }
    });
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
  });
});

// 8. Financials Module Tests
test("Financials Module Tests", async (t) => {
  let feeId;

  await t.test("POST /api/financials/fees - Create fee as Dean", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 10);
    const dueDateStr = tomorrow.toISOString().split("T")[0];

    const res = await apiCall("/api/financials/fees", {
      method: "POST",
      token: deanToken,
      body: {
        studentId: studentUser._id.toString(),
        title: "Semester 1 Tuition",
        amount: 5000,
        dueDate: dueDateStr
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.fee._id);
    feeId = res.data.fee._id;
  });

  await t.test("POST /api/financials/payments - Record payment as Dean & verify FIFO allocation", async () => {
    const res = await apiCall("/api/financials/payments", {
      method: "POST",
      token: deanToken,
      body: {
        studentId: studentUser._id.toString(),
        amount: 3000,
        paymentMethod: "bank_transfer",
        reference: "TXN10001",
        notes: "Deposit payment"
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    
    // Fetch fee in memory to check if it was partially paid
    const Fee = mongoose.model("Fee");
    const feeObj = await Fee.findById(feeId);
    assert.strictEqual(feeObj.paidAmount, 3000);
    assert.strictEqual(feeObj.status, "partially_paid");
  });

  await t.test("GET /api/financials/balance/:studentId - Get balance details", async () => {
    const res = await apiCall(`/api/financials/balance/${studentUser._id.toString()}`, {
      token: studentToken
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.totalFees, 5000);
    assert.strictEqual(res.data.totalPaid, 3000);
    assert.strictEqual(res.data.balance, 2000);
  });

  await t.test("overpayment credit covers a fee added later", async () => {
    const pay = await apiCall("/api/financials/payments", {
      method: "POST",
      token: deanToken,
      body: { studentId: studentUser._id.toString(), amount: 2500, paymentMethod: "cash", reference: "TXN10002" }
    });
    assert.strictEqual(pay.status, 201);
    assert.strictEqual(pay.data.remainingPayment, 500); // 2000 left on the fee, 500 extra

    const due = new Date(Date.now() - 2 * 864e5).toISOString().split("T")[0]; // already past due
    const fee = await apiCall("/api/financials/fees", {
      method: "POST",
      token: deanToken,
      body: { studentId: studentUser._id.toString(), title: "Lab fee", amount: 400, dueDate: due }
    });
    assert.strictEqual(fee.status, 201);

    const Fee = mongoose.model("Fee");
    const labFee = await Fee.findById(fee.data.fee._id);
    assert.strictEqual(labFee.status, "paid");
    assert.strictEqual(labFee.paidAmount, 400);

    const overdue = await apiCall("/api/financials/overdue-report", { token: deanToken });
    const mine = overdue.data.data.students.find(s => String(s.student._id) === studentUser._id.toString());
    assert.ok(!mine, "a fee paid from credit must not appear as overdue");
  });

  await t.test("GET /api/financials/overdue-report - Overdue fees report (Dean)", async () => {
    const res = await apiCall("/api/financials/overdue-report", { token: deanToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.data.students));
  });
});

// 9. Notifications Module Tests
test("Notifications Module Tests", async (t) => {
  await t.test("POST /api/notifications - Create notification as Dean", async () => {
    const res = await apiCall("/api/notifications", {
      method: "POST",
      token: deanToken,
      body: {
        title: "Semester Exams Scheduled",
        message: "The final exams are scheduled starting from next month.",
        type: "normal",
        target: "students",
        batches: [testBatchId]
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.data.data.notification._id);
    notificationId = res.data.data.notification._id;
  });

  await t.test("GET /api/notifications - List notifications for student", async () => {
    const res = await apiCall("/api/notifications", { token: studentToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.length > 0);
  });

  await t.test("POST /api/notifications/read/:id - Mark notification as read", async () => {
    const res = await apiCall(`/api/notifications/read/${notificationId}`, {
      method: "POST",
      token: studentToken
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, "تم تحديد التنبيه كمقروء");
  });
});

// 10. App Version Tracking & Update Modal Module Tests
test("App Version Module Tests", async (t) => {
  await t.test("GET /api/app-version/check - Public check without params", async () => {
    const res = await apiCall("/api/app-version/check");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.latestVersion, "2.3.0");
    assert.strictEqual(res.data.data.latestVersionCode, 30);
  });

  await t.test("GET /api/app-version/check - Outdated client version detected", async () => {
    const res = await apiCall("/api/app-version/check?v=2.0.5&code=27");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.isOutdated, true);
    assert.strictEqual(res.data.data.isMandatory, true);
    assert.ok(Array.isArray(res.data.data.releaseNotes));
  });

  await t.test("GET /api/app-version/check - Up-to-date client version detected", async () => {
    const res = await apiCall("/api/app-version/check?v=2.3.0&code=30");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.isOutdated, false);
    assert.strictEqual(res.data.data.isMandatory, false);
  });

  await t.test("GET /api/app-version/check - Web platform is never outdated or mandatory", async () => {
    const res = await apiCall("/api/app-version/check?v=1.0.0&code=1&platform=web");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.isOutdated, false);
    assert.strictEqual(res.data.data.isMandatory, false);
  });

  await t.test("GET /api/app-version/admin - Forbidden for student", async () => {
    const res = await apiCall("/api/app-version/admin", { token: studentToken });
    assert.strictEqual(res.status, 403);
  });

  await t.test("GET /api/app-version/admin - Allowed for Dean", async () => {
    const res = await apiCall("/api/app-version/admin", { token: deanToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.latestVersion, "2.3.0");
  });

  await t.test("POST /api/app-version/admin - Update version settings as Dean", async () => {
    const res = await apiCall("/api/app-version/admin", {
      method: "POST",
      token: deanToken,
      body: {
        latestVersion: "2.3.0",
        latestVersionCode: 30,
        minSupportedVersion: "2.1.0",
        minSupportedVersionCode: 28,
        forceUpdate: true,
        title: "تحديث أمني إجباري",
        releaseNotes: ["ترقية الواجهات بالكامل", "تأمين الجلسات وتحديث النظام"]
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.forceUpdate, true);
    assert.strictEqual(res.data.data.title, "تحديث أمني إجباري");
  });
});

