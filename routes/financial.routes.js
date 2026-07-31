const router = require("express").Router();
const mongoose = require("mongoose");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const User = require("../models/User");
const Fee = require("../models/Fee");
const Payment = require("../models/Payment");
const PaymentRequest = require("../models/PaymentRequest");
const upload = require("../config/multer");
const { success, fail, serverError } = require("../utils/response");
const { allocatePaymentToFees, getStudentBalanceSummary } = require("../utils/feeAllocation");

// 1. POST /api/financials/fees (dean only)
router.post("/fees", auth, role("dean", "admin"), async (req, res) => {
  try {
    const { studentId, batchId, title, dueDate, feeType, notes } = req.body;
    const amount = Number(req.body.amount);
    const discount = Number(req.body.discount || 0);

    if (!title || req.body.amount === undefined || !dueDate) {
      return fail(res, "العنوان والقيمة وتاريخ الاستحقاق حقول مطلوبة", 400);
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return fail(res, "قيمة الرسوم يجب أن تكون رقماً أكبر من صفر", 400);
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > amount) {
      return fail(res, "قيمة الخصم غير صالحة أو تتجاوز قيمة الرسم", 400);
    }
    if (Number.isNaN(new Date(dueDate).getTime())) {
      return fail(res, "تاريخ الاستحقاق غير صالح", 400);
    }

    if (!studentId && !batchId) {
      return fail(res, "يجب تحديد الطالب أو الدفعة", 400);
    }

    const createdBy = req.user.id;
    const feeBase = { title, amount, discount, dueDate, createdBy,
      feeType: feeType || "tuition",
      notes: notes || ""
    };

    if (studentId) {
      // Create fee for individual student
      const studentObj = await User.findById(studentId);
      if (!studentObj) {
        return fail(res, "الطالب غير موجود", 404);
      }

      const fee = await Fee.create({
        ...feeBase,
        student: studentId,
        batch: studentObj.batch
      });

      return res.status(201).json({
        success: true,
        message: "تم إضافة الرسوم بنجاح للطالب",
        fee,
        count: 1
      });
    } else {
      // Create fee batch-wide
      const students = await User.find({
        batch: batchId,
        roles: { $in: ["student", "leader"] },
        isActive: true
      });

      if (students.length === 0) {
        return fail(res, "لا يوجد طلاب نشطين في هذه الدفعة", 404);
      }

      const feeDocs = students.map((student) => ({
        ...feeBase,
        student: student._id,
        batch: batchId
      }));

      const createdFees = await Fee.insertMany(feeDocs);

      return res.status(201).json({
        success: true,
        message: `تم إضافة الرسوم بنجاح لـ ${createdFees.length} طالب`,
        count: createdFees.length
      });
    }
  } catch (err) {
    return serverError(res, err, "إنشاء الرسوم الدراسية");
  }
});

// 2. POST /api/financials/payments (dean only)
router.post("/payments", auth, role("dean", "admin"), async (req, res) => {
  try {
    const { studentId, paymentMethod, reference, notes } = req.body;
    const amount = Number(req.body.amount);

    if (!studentId || req.body.amount === undefined || !paymentMethod || !reference) {
      return fail(res, "جميع الحقول (studentId, amount, paymentMethod, reference) مطلوبة", 400);
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return fail(res, "قيمة الدفع يجب أن تكون رقماً أكبر من صفر", 400);
    }

    // Check if student exists
    const studentExists = await User.findById(studentId);
    if (!studentExists) {
      return fail(res, "الطالب غير موجود", 404);
    }

    // Check if reference is unique
    const existingPayment = await Payment.findOne({ reference: reference.trim() });
    if (existingPayment) {
      return fail(res, "رقم المرجع/الإيصال مسجل مسبقاً", 400);
    }

    // Create the Payment record
    const payment = await Payment.create({
      student: studentId,
      amount,
      paymentMethod,
      reference,
      notes,
      recordedBy: req.user.id
    });

    // تخصيص الدفعة على الرسوم بأسلوب FIFO باستخدام الدالة المشتركة
    const { remainingPayment } = await allocatePaymentToFees(studentId, amount);

    return res.status(201).json({
      success: true,
      message: "تم تسجيل الدفع بنجاح وتحديث الرسوم المتعلقة",
      payment,
      remainingPayment
    });
  } catch (err) {
    return serverError(res, err, "تسجيل الدفعة المالية");
  }
});

// 3. GET /api/financials/registry (dean only) — optimized with aggregation
router.get("/registry", auth, role("dean", "admin"), async (req, res) => {
  try {
    let balances = [];
    if (typeof User.aggregate === 'function') {
      balances = await User.aggregate([
        { $match: { roles: { $in: ["student", "leader"] } } },
        {
          $lookup: {
            from: "fees",
            localField: "_id",
            foreignField: "student",
            as: "fees"
          }
        },
        {
          $lookup: {
            from: "payments",
            localField: "_id",
            foreignField: "student",
            as: "payments"
          }
        },
        {
          $project: {
            student: {
              _id: "$_id",
              name: "$name",
              email: "$email",
              batch: "$batch"
            },
            totalFees: { $sum: "$fees.amount" },
            totalPaid: { $sum: "$payments.amount" },
            balance: {
              $max: [
                0,
                { $subtract: [{ $sum: "$fees.amount" }, { $sum: "$payments.amount" }] }
              ]
            }
          }
        },
        { $sort: { "student.name": 1 } }
      ]);
      if (typeof User.populate === 'function') {
        balances = await User.populate(balances, { path: "student.batch", select: "name code" });
      }
    } else {
      const students = await User.find({ roles: { $in: ["student", "leader"] } }).populate("batch", "name code").lean();
      const allFees = await Fee.find().lean();
      const allPayments = await Payment.find().lean();

      balances = students.map(st => {
        const sFees = allFees.filter(f => f.student?.toString() === st._id.toString());
        const sPays = allPayments.filter(p => p.student?.toString() === st._id.toString());
        const totalFees = sFees.reduce((sum, f) => sum + (f.amount || 0), 0);
        const totalPaid = sPays.reduce((sum, p) => sum + (p.amount || 0), 0);
        return {
          student: st,
          totalFees,
          totalPaid,
          balance: Math.max(0, totalFees - totalPaid)
        };
      });
    }

    success(res, balances);
  } catch (err) {
    serverError(res, err, "جلب سجل الأرصدة");
  }
});

// 4. GET /api/financials/balance/:studentId (dean/admin or specific student)
router.get("/balance/:studentId", auth, async (req, res) => {
  try {
    const { studentId } = req.params;

    // Check authorization: only dean, admin, or the student themselves can check
    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    if (req.user.id !== studentId && !isDeanOrAdmin) {
      return fail(res, "ليس لديك صلاحية للوصول إلى هذا المورد", 403);
    }

    const [fees, payments] = await Promise.all([
      Fee.find({ student: studentId }).sort({ createdAt: -1 }),
      Payment.find({ student: studentId }).sort({ createdAt: -1 })
    ]);

    const totalFees = fees.reduce((sum, f) => sum + f.amount, 0);
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = Math.max(0, totalFees - totalPaid);

    return res.json({
      success: true,
      studentId,
      totalFees,
      totalPaid,
      balance,
      fees,
      payments
    });
  } catch (err) {
    return serverError(res, err, "جلب الرصيد المالي");
  }
});

// 5. POST /api/financials/payment-requests (student) - Upload a receipt
router.post("/payment-requests", auth, role("student", "leader"), upload.single("receiptFile"), async (req, res) => {
  try {
    const { reference, notes, paymentMethod } = req.body;
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return fail(res, "يجب إدخال مبلغ صحيح أكبر من الصفر", 400);
    }
    if (!paymentMethod || !["cash", "bank_transfer", "card", "deposit"].includes(paymentMethod)) {
      return fail(res, "طريقة الدفع غير صحيحة. القيم المسموحة: cash, bank_transfer, card, deposit", 400);
    }

    if (!req.file) {
      return fail(res, "يرجى إرفاق إيصال الدفع", 400);
    }

    const request = await PaymentRequest.create({
      student: req.user.id,
      amount,
      reference,
      receiptFile: req.file.filename,
      notes,
      paymentMethod
    });

    return res.status(201).json({
      success: true,
      message: "تم رفع إشعار السداد بنجاح وجاري مراجعته من الإدارة",
      request
    });
  } catch (err) {
    return serverError(res, err, "رفع إشعار سداد");
  }
});

// 5.5 GET /api/financials/payment-requests/my (student) - Get own payment requests
router.get("/payment-requests/my", auth, role("student", "leader"), async (req, res) => {
  try {
    const requests = await PaymentRequest.find({ student: req.user.id })
      .sort({ createdAt: -1 });

    return success(res, { requests });
  } catch (err) {
    return serverError(res, err, "جلب طلبات السداد الخاصة بي");
  }
});

// 6. GET /api/financials/payment-requests (dean only) - Get all pending requests
router.get("/payment-requests", auth, role("dean", "admin"), async (req, res) => {
  try {
    const { status = "pending" } = req.query;
    const requests = await PaymentRequest.find({ status })
      .populate("student", "name email")
      .sort({ createdAt: -1 });

    return success(res, { requests });
  } catch (err) {
    return serverError(res, err, "جلب طلبات السداد");
  }
});

// 7. POST /api/financials/payment-requests/:id/action (dean only) - Approve or Reject
router.post("/payment-requests/:id/action", auth, role("dean", "admin"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { action, rejectionReason } = req.body; // action: "approve" or "reject"
    if (!["approve", "reject"].includes(action)) {
      await session.abortTransaction();
      session.endSession();
      return fail(res, "إجراء غير صالح", 400);
    }

    const request = await PaymentRequest.findById(req.params.id).session(session);
    if (!request) {
      await session.abortTransaction();
      session.endSession();
      return fail(res, "طلب السداد غير موجود", 404);
    }

    if (request.status !== "pending") {
      await session.abortTransaction();
      session.endSession();
      return fail(res, "تمت معالجة هذا الطلب مسبقاً", 400);
    }

    if (action === "reject") {
      request.status = "rejected";
      request.rejectionReason = rejectionReason;
      request.reviewedBy = req.user.id;
      request.reviewDate = Date.now();
      await request.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.json({ success: true, message: "تم رفض طلب السداد" });
    }

    // If Approve -> Create Payment and update Fee balances
    // 1. Create Payment
    const payment = await Payment.create([{
      student: request.student,
      amount: request.amount,
      paymentMethod: request.paymentMethod,
      reference: request.reference || `PRQ-${request._id}`,
      notes: request.notes,
      recordedBy: req.user.id
    }], { session });

    // 2. تخصيص الرسوم باستخدام الدالة المشتركة (FIFO)
    const { remainingPayment, updatedFees } = await allocatePaymentToFees(request.student, request.amount, session);

    // 3. Mark request as approved
    request.status = "approved";
    request.reviewedBy = req.user.id;
    request.reviewDate = Date.now();
    await request.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: "تم قبول إشعار السداد وتحديث أرصدة الرسوم بنجاح",
      payment: payment[0],
      updatedFeesCount: updatedFees.length,
      remainingPayment
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return serverError(res, err, "معالجة طلب السداد");
  }
});

// 8. GET /api/financials/overdue-report (dean only) - Students with overdue fees
router.get("/overdue-report", auth, role("dean", "admin"), async (req, res) => {
  try {
    const now = new Date();
    const { batchId } = req.query;

    // Find all fees that are overdue (dueDate < now and status != paid)
    const feeFilter = {
      dueDate: { $lt: now },
      status: { $ne: "paid" }
    };
    if (batchId) feeFilter.batch = batchId;

    const overdueFees = await Fee.find(feeFilter)
      .populate("student", "name email batch")
      .populate("batch", "name code")
      .sort({ dueDate: 1 });

    // Group by student
    const studentsMap = new Map();
    for (const fee of overdueFees) {
      const studentId = fee.student._id.toString();
      if (!studentsMap.has(studentId)) {
        studentsMap.set(studentId, {
          student: fee.student,
          batch: fee.batch,
          overdueFees: [],
          totalOverdueAmount: 0,
          overdueCount: 0
        });
      }
      const studentData = studentsMap.get(studentId);
      studentData.overdueFees.push({
        _id: fee._id,
        title: fee.title,
        amount: fee.amount,
        paidAmount: fee.paidAmount,
        remainingAmount: fee.amount - fee.paidAmount,
        dueDate: fee.dueDate,
        status: fee.status
      });
      studentData.totalOverdueAmount += fee.amount - fee.paidAmount;
      studentData.overdueCount++;
    }

    const overdueStudents = Array.from(studentsMap.values())
      .sort((a, b) => b.totalOverdueAmount - a.totalOverdueAmount);

    success(res, {
      reportDate: now,
      totalOverdueStudents: overdueStudents.length,
      totalOverdueAmount: overdueStudents.reduce((sum, s) => sum + s.totalOverdueAmount, 0),
      students: overdueStudents
    });
  } catch (err) {
    return serverError(res, err, "جلب تقرير المتأخرات");
  }
});

module.exports = router;

