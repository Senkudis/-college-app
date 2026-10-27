/**
 * identity-and-login.test.js
 * - بطاقة الهوية الرقمية: رمز QR موقّع يفتح صفحة تحقق عامة (/id/:code).
 * - "كتبت كلمة المرور صح ومرفوضة": الأرقام العربية، وتعديل كلمة المرور من الإدارة.
 */

const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");

let baseUrl;
let deanToken, studentToken, studentId;
const batchId = "6688f333e333333333333333";

async function apiCall(path, options = {}) {
  const headers = { ...options.headers };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  let body = options.body;
  if (body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method: options.method || "GET", headers, body });
  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* صفحة HTML */ }
  return { status: response.status, data: json, text };
}

test.before(async () => {
  const server = await startServer();
  baseUrl = `http://localhost:${server.port}`;
});

test.after(async () => {
  await stopServer();
});

test("Identity: seeding", async () => {
  resetDB();
  await mongoose.model("Batch").create({ _id: batchId, name: "دفعة الهوية", code: "ID2026", status: "active" });
  const dean = await seedUser("Dean Id", "dean.id@college.edu", "password123", "dean");
  deanToken = dean.token;
  const student = await seedUser("Student Id", "student.id@college.edu", "123456", "student", { batch: batchId });
  studentToken = student.token;
  studentId = student.user._id.toString();
});

test.describe("Digital ID card QR", () => {
  let code;

  test("GET /api/users/me/id-card returns a signed code for the current user", async () => {
    const r = await apiCall("/api/users/me/id-card", { token: studentToken });
    assert.strictEqual(r.status, 200);
    code = r.data.data.code;
    assert.match(code, new RegExp(`^${studentId}\\.[A-Za-z0-9_-]{16}$`));
  });

  test("requires login to obtain a code", async () => {
    const r = await apiCall("/api/users/me/id-card");
    assert.strictEqual(r.status, 401);
  });

  test("public verify shows holder identity without private data", async () => {
    const r = await apiCall(`/api/public/verify-id/${code}`);
    assert.strictEqual(r.status, 200);
    const d = r.data.data;
    assert.strictEqual(d.valid, true);
    assert.strictEqual(d.status, "active");
    assert.strictEqual(d.holder.name, "Student Id");
    assert.strictEqual(d.holder.roleTitle, "طالب");
    assert.strictEqual(d.holder.batchName, "دفعة الهوية");
    const raw = JSON.stringify(r.data);
    assert.ok(!raw.includes("student.id@college.edu"), "email must not leak");
    assert.ok(!raw.includes(studentId), "internal id must not be echoed");
  });

  test("a forged code (someone else's id, copied signature) is rejected", async () => {
    const forged = "6688f333e333333333333334." + code.split(".")[1];
    const r = await apiCall(`/api/public/verify-id/${forged}`);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.data.valid, false);
  });

  test("a suspended account shows as not active", async () => {
    await mongoose.model("User").findByIdAndUpdate(studentId, { $set: { isActive: false } });
    const r = await apiCall(`/api/public/verify-id/${code}`);
    assert.strictEqual(r.data.data.status, "suspended");
    await mongoose.model("User").findByIdAndUpdate(studentId, { $set: { isActive: true } });
  });

  test("/id/:code serves the verification page", async () => {
    const r = await apiCall(`/id/${code}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.text.includes("التحقق من بطاقة الهوية"));
  });
});

test.describe("Login: password typed correctly but rejected", () => {
  test("Arabic-keyboard digits match the same password in Latin digits", async () => {
    const r = await apiCall("/api/auth/login", {
      method: "POST",
      body: { email: "student.id@college.edu", password: "١٢٣٤٥٦" }
    });
    assert.strictEqual(r.status, 200, r.data.message);
  });

  test("password set from the admin edit form actually takes effect", async () => {
    const put = await apiCall(`/api/users/${studentId}`, {
      method: "PUT",
      token: deanToken,
      body: { name: "Student Id", email: "student.id@college.edu", roles: ["student"], password: "newpass99" }
    });
    assert.strictEqual(put.status, 200, put.data.message);

    const oldLogin = await apiCall("/api/auth/login", {
      method: "POST",
      body: { email: "student.id@college.edu", password: "123456" }
    });
    assert.strictEqual(oldLogin.status, 401);

    const newLogin = await apiCall("/api/auth/login", {
      method: "POST",
      body: { email: "student.id@college.edu", password: "newpass99" }
    });
    assert.strictEqual(newLogin.status, 200, newLogin.data.message);
    assert.strictEqual(newLogin.data.user.firstLogin, true, "student must choose their own password next");
  });
});
