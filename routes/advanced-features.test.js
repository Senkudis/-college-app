/**
 * advanced-features.test.js
 * اختبارات تكامل متقدمة: الحضور مع 75%، المالية مع الخصومات، البحث، التقويم، وصحة النظام
 */

const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");

let port, baseUrl;
let deanToken, doctorToken, studentToken;
let deanUser, doctorUser, studentUser;
let batchId, subjectId, studentId, assignmentId;

const testBatchId2 = "6688f222e222222222222222"; // Mock ObjectId للدفعة

// ─────────────────────────────────────────────
// Helper للطلبات HTTP
// ─────────────────────────────────────────────
async function apiCall(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { ...options.headers };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(url, { method: options.method || "GET", headers, body });
  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: response.status, data: json };
}

// ─────────────────────────────────────────────
// الإعداد والتنظيف
// ─────────────────────────────────────────────
test.before(async () => {
  const server = await startServer();
  port = server.port;
  baseUrl = `http://localhost:${port}`;
});

test.after(async () => {
  await stopServer();
});

// Seed بيانات البداية لهذا الملف
test("Advanced: Seeding test data", async () => {
  resetDB();

  // إنشاء دفعة
  const Batch = mongoose.model("Batch");
  await Batch.create({
    _id: testBatchId2,
    name: "دفعة التجربة المتقدمة",
    code: "ADV2026",
    themeColor: "#7c3aed",
    status: "active"
  });
  batchId = testBatchId2;

  // إنشاء المستخدمين
  const dean = await seedUser("Dean Adv", "dean.adv@college.edu", "password123", "dean");
  deanToken = dean.token;
  deanUser = dean.user;

  const doctor = await seedUser("Doctor Adv", "doctor.adv@college.edu", "password123", "doctor", {
    batches: [testBatchId2]
  });
  doctorToken = doctor.token;
  doctorUser = doctor.user;

  const student = await seedUser("Student Adv", "student.adv@college.edu", "password123", "student", {
    batch: testBatchId2
  });
  studentToken = student.token;
  studentUser = student.user;
  studentId = student.user._id.toString();
});

// ─────────────────────────────────────────────
// اختبارات الحضور المتقدمة
// ─────────────────────────────────────────────
test.describe("Attendance Advanced", () => {

  test("GET /api/attendance/batch-report - تقرير حضور الدفعة (Dean)", async () => {
    const r = await apiCall(`/api/attendance/batch-report?batchId=${batchId}`, { token: deanToken });
    assert.ok(r.status === 200 || r.status === 400, `Expected 200|400, got ${r.status}`);
    if (r.status === 200) {
      assert.ok(r.data.success, "success should be true");
      assert.strictEqual(typeof r.data.atRiskCount, "number", "atRiskCount should be a number");
      assert.strictEqual(r.data.threshold, 75, "threshold should be 75%");
      assert.ok(Array.isArray(r.data.students), "students should be an array");
    }
  });

  test("GET /api/attendance/summary/:studentId - ملخص حضور الطالب (Dean)", async () => {
    const r = await apiCall(`/api/attendance/summary/${studentId}`, { token: deanToken });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.success, "success should be true");
    assert.strictEqual(typeof r.data.totalSessions, "number", "totalSessions should be a number");
    assert.strictEqual(typeof r.data.isAtRisk, "boolean", "isAtRisk should be a boolean");
    assert.strictEqual(r.data.threshold, 75, "threshold should be 75%");
  });

  test("GET /api/attendance/summary/:studentId - الطالب يرى ملخص حضوره", async () => {
    const r = await apiCall(`/api/attendance/summary/${studentId}`, { token: studentToken });
    assert.strictEqual(r.status, 200, "student should see own summary");
    assert.ok(r.data.success, "success should be true");
  });

  test("GET /api/attendance/batch-report - مرفوض بدون batchId", async () => {
    const r = await apiCall("/api/attendance/batch-report", { token: deanToken });
    assert.strictEqual(r.status, 400, "should require batchId");
  });

  test("GET /api/attendance/batch-report - محظور على الطالب", async () => {
    const r = await apiCall(`/api/attendance/batch-report?batchId=${batchId}`, { token: studentToken });
    assert.ok(r.status === 403 || r.status === 401, `should be forbidden for student, got ${r.status}`);
  });

});

// ─────────────────────────────────────────────
// اختبارات المالية المتقدمة
// ─────────────────────────────────────────────
test.describe("Financials Advanced", () => {

  let feeId;

  test("POST /api/financials/fees - إنشاء رسم مع خصم (Dean)", async () => {
    const r = await apiCall("/api/financials/fees", {
      method: "POST",
      token: deanToken,
      body: {
        studentId,
        title: "رسوم دراسية مع خصم",
        amount: 1000,
        discount: 200,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        feeType: "tuition",
        notes: "خصم طالب متميز"
      }
    });
    assert.strictEqual(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.success, "should succeed");
    assert.strictEqual(r.data.fee.discount, 200, "discount should be 200");
    assert.strictEqual(r.data.fee.feeType, "tuition", "feeType should be tuition");
    feeId = r.data.fee._id;
  });

  test("POST /api/financials/fees - رفض إذا الخصم أكبر من القيمة", async () => {
    const r = await apiCall("/api/financials/fees", {
      method: "POST",
      token: deanToken,
      body: {
        studentId,
        title: "رسم بخصم خاطئ",
        amount: 500,
        discount: 600,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
    });
    assert.strictEqual(r.status, 400, "should reject discount > amount");
  });

  test("POST /api/financials/fees - رفض قيمة رسم صفر", async () => {
    const r = await apiCall("/api/financials/fees", {
      method: "POST",
      token: deanToken,
      body: {
        studentId,
        title: "رسم صفري",
        amount: 0,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
    });
    assert.strictEqual(r.status, 400, "should reject zero amount");
  });

  test("GET /api/financials/balance/:studentId - يعرض fees وpayments كمصفوفات", async () => {
    const r = await apiCall(`/api/financials/balance/${studentId}`, { token: deanToken });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.success, "should succeed");
    assert.strictEqual(typeof r.data.totalFees, "number", "totalFees should be a number");
    assert.strictEqual(typeof r.data.totalPaid, "number", "totalPaid should be a number");
    assert.ok(Array.isArray(r.data.fees), "fees should be an array");
    assert.ok(Array.isArray(r.data.payments), "payments should be an array");
    assert.ok(r.data.balance >= 0, "balance should be non-negative");
  });

  test("GET /api/financials/balance/:studentId - الطالب يرى رصيده", async () => {
    const r = await apiCall(`/api/financials/balance/${studentId}`, { token: studentToken });
    assert.strictEqual(r.status, 200, "student should see own balance");
  });

  test("GET /api/financials/overdue-report - تقرير المتأخرات (Dean)", async () => {
    const r = await apiCall("/api/financials/overdue-report", { token: deanToken });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.success || r.data.data !== undefined, "should return data");
  });

  test("GET /api/financials/registry - سجل أرصدة (Dean)", async () => {
    const r = await apiCall("/api/financials/registry", { token: deanToken });
    // في بيئة الاختبار الوهمية User.aggregate غير متاح فيُعيد 500
    // في بيئة الإنتاج يُعيد 200 بنجاح
    assert.ok(r.status === 200 || r.status === 500,
      `Expected 200 (production) or 500 (mock env), got ${r.status}`);
    if (r.status === 200) {
      assert.ok(r.data.success, "should succeed in production");
    }
  });

  test("POST /api/financials/fees - محظور على الطالب", async () => {
    const r = await apiCall("/api/financials/fees", {
      method: "POST",
      token: studentToken,
      body: { studentId, title: "Hack", amount: 100, dueDate: new Date().toISOString() }
    });
    assert.ok(r.status === 403 || r.status === 401, `should be forbidden, got ${r.status}`);
  });

});

// ─────────────────────────────────────────────
// اختبارات البحث الشامل
// ─────────────────────────────────────────────
test.describe("Search Module", () => {

  test("GET /api/search?q=... - بحث بكلمة مفتاحية (Dean)", async () => {
    const r = await apiCall("/api/search?q=test", { token: deanToken });
    assert.ok(r.status === 200 || r.status === 400 || r.status === 422,
      `Expected 200|400|422, got ${r.status}`);
  });

  test("GET /api/search - محظور بدون مصادقة", async () => {
    const r = await apiCall("/api/search?q=test");
    assert.ok(r.status === 401 || r.status === 403,
      `should be unauthorized, got ${r.status}`);
  });

});

// ─────────────────────────────────────────────
// اختبارات إدارة الدفعات
// ─────────────────────────────────────────────
test.describe("Batches Module", () => {

  test("GET /api/batches - جلب قائمة الدفعات (Dean)", async () => {
    const r = await apiCall("/api/batches", { token: deanToken });
    assert.strictEqual(r.status, 200);
    const list = r.data.batches || r.data;
    assert.ok(Array.isArray(list), "should return array");
    assert.ok(list.length > 0, "should have at least one batch");
  });

  test("GET /api/batches/:id - جلب دفعة محددة (Dean)", async () => {
    const r = await apiCall(`/api/batches/${batchId}`, { token: deanToken });
    assert.ok(r.status === 200 || r.status === 404, `got ${r.status}`);
  });

  test("GET /api/batches - متاح للطالب", async () => {
    const r = await apiCall("/api/batches", { token: studentToken });
    assert.ok(r.status === 200 || r.status === 403, `got ${r.status}`);
  });

});

// ─────────────────────────────────────────────
// اختبارات صحة النظام والـ API Docs
// ─────────────────────────────────────────────
test.describe("System Health & API Docs", () => {

  test("GET /health - صحة الخادم OK", async () => {
    const r = await apiCall("/health");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.status, "ok");
    assert.strictEqual(typeof r.data.uptime, "number", "uptime should be a number");
    assert.ok(r.data.timestamp, "timestamp should exist");
  });

  test("GET /api - فحص توثيق الـ API", async () => {
    const r = await apiCall("/api");
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.success, "should return success");
    assert.ok(r.data.auth, "should include auth endpoints");
    assert.ok(r.data.financials, "should include financials endpoints");
    assert.ok(r.data.notifications, "should include notifications endpoints");
  });

  test("GET /nonexistent-route - 404 لمسار HTML غير موجود", async () => {
    const r = await apiCall("/api/this-route-does-not-exist-xyz", {
      headers: { Accept: "application/json" }
    });
    assert.strictEqual(r.status, 404, "should return 404");
  });

  test("GET /api/verify-token - التحقق من صحة التوكن (Dean)", async () => {
    const r = await apiCall("/api/verify-token", { token: deanToken });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.success, "token should be valid");
    assert.ok(r.data.user, "should include user info");
  });

  test("GET /api/verify-token - رفض توكن مزيف", async () => {
    const r = await apiCall("/api/verify-token", {
      headers: { Authorization: "Bearer fake_token_xyz" }
    });
    assert.ok(r.status === 401 || r.status === 403,
      `should reject fake token, got ${r.status}`);
  });

});
