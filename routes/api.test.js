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

// 2. Auth Module Tests
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
