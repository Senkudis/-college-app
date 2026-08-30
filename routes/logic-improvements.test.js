/**
 * logic-improvements.test.js
 * اختبارات التحسينات المنطقية ومعالجة الأخطاء
 * 1. حسابات الرسوم و FIFO مع الخصومات (Fee Allocation & Discounts)
 * 2. منع ازدواجية احتساب النقاط عند إعادة تقييم الواجبات (Submission Points Deduplication)
 * 3. حماية تقرير المتأخرات من حسابات الطلاب المحذوفة/الفارغة
 * 4. توحيد صيغة الاستجابة ومعالجة الأخطاء (Response Standardization)
 */

const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { resetDB, startServer, stopServer, seedUser } = require("./test-helper");
const { allocatePaymentToFees, getStudentBalanceSummary } = require("../utils/feeAllocation");
const { success, fail, notFound, serverError } = require("../utils/response");

let port, baseUrl;
let deanToken, doctorToken, studentToken;
let deanUser, doctorUser, studentUser;
let testBatchId, testSubjectId;
// raw user objects (not wrapped in {user, token})
let deanObj, doctorObj, studentObj;

async function apiCall(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { ...options.headers };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
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

test("Logic Improvements: Database Seeding", async () => {
  resetDB();

  const Batch = mongoose.model("Batch");
  const batch = await Batch.create({
    name: "دفعة المنطق المتقدم",
    code: "LOGIC2026",
    themeColor: "#2563eb",
    status: "active"
  });
  testBatchId = batch._id;

  const User = mongoose.model("User");
  ({ user: deanObj, token: deanToken }   = await seedUser("عميد الكلية",  "dean_logic@elnasr.edu",    "Password123!", ["dean"]));
  ({ user: doctorObj, token: doctorToken } = await seedUser("دكتور المادة", "doc_logic@elnasr.edu",  "Password123!", ["doctor"]));
  ({ user: studentObj, token: studentToken } = await seedUser("طالب مجتهد", "student_logic@elnasr.edu", "Password123!", ["student"]));

  // keep backward-compat aliases
  deanUser    = deanObj;
  doctorUser  = doctorObj;
  studentUser = studentObj;

  await User.findByIdAndUpdate(doctorObj._id,  { batches: [testBatchId] });
  await User.findByIdAndUpdate(studentObj._id, { batch: testBatchId, points: 0 });

  const Subject = mongoose.model("Subject");
  const subject = await Subject.create({
    name: "هندسة البرمجيات المتقدمة",
    code: "CS401",
    level: 1,
    doctor: doctorObj._id,
    batches: [testBatchId]
  });
  testSubjectId = subject._id;

  assert.ok(deanToken && doctorToken && studentToken, "Tokens should be generated");
});

test("1. Financial FIFO Allocation accounts for discount correctly", async () => {
  const Fee = mongoose.model("Fee");

  // رسم 1: المبلغ 1000، الخصم 300 => الصافي المطلوب 700
  const fee1 = await Fee.create({
    student: studentObj._id,
    batch: testBatchId,
    title: "رسوم الفصل الدراسي الأول",
    amount: 1000,
    discount: 300,
    paidAmount: 0,
    dueDate: new Date(Date.now() - 86400000), // بالأمس
    status: "pending",
    createdBy: deanObj._id
  });

  // رسم 2: المبلغ 500، بدون خصم => الصافي المطلوب 500
  const fee2 = await Fee.create({
    student: studentObj._id,
    batch: testBatchId,
    title: "رسوم معمل",
    amount: 500,
    discount: 0,
    paidAmount: 0,
    dueDate: new Date(Date.now() + 86400000), // غداً
    status: "pending",
    createdBy: deanObj._id
  });

  // سداد 700 ج.س (يجب أن يسدد fee1 بالكامل ولا يتبقى منه شيء، لأن الصافي 700)
  const result1 = await allocatePaymentToFees(studentObj._id, 700);
  assert.strictEqual(result1.remainingPayment, 0, "No remaining payment");
  assert.strictEqual(result1.updatedFees.length, 1, "One fee updated");
  
  const updatedFee1 = await Fee.findById(fee1._id);
  assert.strictEqual(updatedFee1.paidAmount, 700, "Paid amount matches netAmount (1000 - 300 = 700)");
  assert.strictEqual(updatedFee1.status, "paid", "Fee status is paid");

  // التحقق من ملخص الرصيد
  const balanceSummary = await getStudentBalanceSummary(studentObj._id);
  // إجمالي الرسوم الصافية: 700 + 500 = 1200
  assert.strictEqual(balanceSummary.totalFees, 1200, "Total net fees should be 1200");
  assert.strictEqual(balanceSummary.totalPaid, 0, "No Payment record added yet, summary totalPaid 0");
  assert.strictEqual(balanceSummary.pendingFeesCount, 1, "1 fee remaining pending");
  assert.strictEqual(balanceSummary.paidFeesCount, 1, "1 fee is paid");
});

test("2. Submission grading awards points only once per passing grade", async () => {
  const Assignment = mongoose.model("Assignment");
  const StudentSubmission = mongoose.model("StudentSubmission");
  const User = mongoose.model("User");
  const { getStore } = require("./test-helper");

  // إنشاء تكليف
  const assignment = await Assignment.create({
    title: "مشروع البرمجيات",
    type: "exercise",
    subject: testSubjectId,
    batches: [testBatchId],
    file: "uploads/assignments/test_assignment.pdf",
    addedBy: doctorObj._id,
    dueDate: new Date(Date.now() + 86400000),
    createdBy: doctorObj._id
  });

  // حقن تسليم مباشرة في المخزن (bypass schema validation)
  const mongoose2 = require("mongoose");
  const subId = new mongoose2.Types.ObjectId().toString();
  const submissionStore = getStore("StudentSubmission");
  submissionStore.push({
    _id: subId,
    assignment: assignment._id.toString(),
    student: studentObj._id.toString(),
    submissionType: "exercise",
    file: "uploads/submissions/test.pdf",
    fileType: "pdf",
    status: "pending",
    pointsAwarded: false,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const studentInitial = await User.findById(studentObj._id);
  const initialPoints = studentInitial.points || 0;

  // تقييم التكليف أول مرة بدرجة 85 (>= 60) => يجب إضافة 10 نقاط
  const resGrade1 = await apiCall(`/api/submissions/${subId}/grade`, {
    method: "PUT",
    token: doctorToken,
    body: { grade: 85, feedback: "عمل ممتاز" }
  });

  assert.strictEqual(resGrade1.status, 200, `Grade 1 should return 200, got ${resGrade1.status}: ${JSON.stringify(resGrade1.data)}`);
  assert.strictEqual(resGrade1.data.success, true);

  const studentAfter1 = await User.findById(studentObj._id);
  assert.strictEqual(studentAfter1.points, initialPoints + 10, "Student should receive 10 points after first grade");

  // إعادة تقييم التكليف (تعديل الدرجة إلى 90) => يجب ألا تُضاف النقاط مرة ثانية
  const resGrade2 = await apiCall(`/api/submissions/${subId}/grade`, {
    method: "PUT",
    token: doctorToken,
    body: { grade: 90, feedback: "تم تعديل الملاحظات" }
  });

  assert.strictEqual(resGrade2.status, 200, `Grade 2 should return 200, got ${resGrade2.status}`);
  assert.strictEqual(resGrade2.data.success, true);

  const studentAfter2 = await User.findById(studentObj._id);
  assert.strictEqual(studentAfter2.points, initialPoints + 10, "Student points must NOT increment again on re-grade");
});

test("3. Overdue report handles orphaned or null student gracefully", async () => {
  const Fee = mongoose.model("Fee");
  const orphanedStudentId = new mongoose.Types.ObjectId();

  // رسم دراسي لطالب غير موجود في قاعدة البيانات (محذوف)
  await Fee.create({
    student: orphanedStudentId,
    batch: testBatchId,
    title: "رسم لطالب غير مسجل",
    amount: 800,
    discount: 100,
    paidAmount: 0,
    dueDate: new Date(Date.now() - 86400000), // متأخر
    status: "pending",
    createdBy: deanObj._id
  });

  // طلب تقرير المتأخرات كعميد — يجب ألا ينهار السيرفر بـ TypeError
  const res = await apiCall("/api/financials/overdue-report", {
    method: "GET",
    token: deanToken
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.success, true);
  assert.ok(Array.isArray(res.data.data.students));
});

test("4. Standard response helpers format output and errors consistently", () => {
  let statusSet = null;
  let jsonOutput = null;
  const mockRes = {
    req: { id: "test-req-1234" },
    status: function(code) { statusSet = code; return this; },
    json: function(data) { jsonOutput = data; return this; }
  };

  // نجاح
  success(mockRes, { item: "ok" }, "تم الحفظ بنجاح");
  assert.strictEqual(statusSet, 200);
  assert.strictEqual(jsonOutput.success, true);
  assert.strictEqual(jsonOutput.requestId, "test-req-1234");
  assert.strictEqual(jsonOutput.data.item, "ok");

  // فشل تحقق
  fail(mockRes, "بيانات غير صحيحة", 400);
  assert.strictEqual(statusSet, 400);
  assert.strictEqual(jsonOutput.success, false);
  assert.strictEqual(jsonOutput.requestId, "test-req-1234");
  assert.strictEqual(jsonOutput.message, "بيانات غير صحيحة");

  // مورد غير موجود
  notFound(mockRes, "العنصر غير موجود");
  assert.strictEqual(statusSet, 404);
  assert.strictEqual(jsonOutput.success, false);
  assert.strictEqual(jsonOutput.message, "العنصر غير موجود");

  // خطأ تحقق ValidationError
  const valError = new mongoose.Error.ValidationError();
  valError.errors = { title: { message: "العنوان مطلوب" } };
  serverError(mockRes, valError);
  assert.strictEqual(statusSet, 400);
  assert.strictEqual(jsonOutput.success, false);
  assert.ok(jsonOutput.message.includes("العنوان مطلوب"));
});
