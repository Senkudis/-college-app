const router = require("express").Router();
const mongoose = require("mongoose");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const User = require("../models/User");
const Fee = require("../models/Fee");
const Payment = require("../models/Payment");
const PaymentRequest = require("../models/PaymentRequest");
const Notification = require("../models/Notification");
const upload = require("../config/multer");
const { success, fail, serverError } = require("../utils/response");
const { allocatePaymentToFees, applyStudentCredit, getStudentBalanceSummary } = require("../utils/feeAllocation");
const { uploadLimiter } = require("../middleware/rateLimiter");

/* ─── مساعد: إرسال إشعار مالي للطالب (DB + Socket.io لحظي) ─── */
async function notifyStudent(req, studentIds, title, message) {
  try {
    const ids = (Array.isArray(studentIds) ? studentIds : [studentIds]).map(String);
    if (!ids.length) return;
    // مستند واحد بقائمة مستلمين — كانت رسوم الدفعة تُنشئ إشعاراً منفصلاً لكل طالب
    const notif = await Notification.create({
      title,
      message,
      type: 'normal',
      target: 'custom',
      recipients: ids,
      createdBy: req.user?.id || null
    });
    const io = req.app?.get('io');
    if (io) ids.forEach(studentId => {
      io.to(`user:${studentId}`).emit('notification:new', {
        _id: notif._id,
        title: notif.title,
        message: notif.message,
        type: notif.type,
        createdAt: notif.createdAt
      });
    });
  } catch (notifErr) {
    // لا نُخفق الطلب الأصلي بسبب فشل الإشعار
    console.error('[Financial] فشل إرسال الإشعار:', notifErr.message);
  }
}

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
      const studentObj = mongoose.Types.ObjectId.isValid(studentId) ? await User.findById(studentId) : null;
      if (!studentObj || !studentObj.roles?.some(r => r === "student" || r === "leader")) {
        return fail(res, "الطالب غير موجود", 404);
      }

      const fee = await Fee.create({
        ...feeBase,
        student: studentId,
        batch: studentObj.batch
      });

      // ما دفعه الطالب زيادة سابقاً يُغطّي الرسم الجديد بدل أن يظهر متأخراً
      await applyStudentCredit(studentId);

      // إشعار الطالب بالرسوم الجديدة
      const netAmt = Math.max(0, amount - discount);
      await notifyStudent(
        req,
        studentId,
        'رسوم دراسية جديدة',
        `تمت إضافة رسوم بعنوان "${title}" بقيمة ${netAmt.toLocaleString('ar-EG-u-nu-latn')} ج.س. تاريخ الاستحقاق: ${new Date(dueDate).toLocaleDateString('ar-EG-u-nu-latn')}.`
      );

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

      // الطلاب ذوو الدفعات فقط قد يملكون رصيداً دائناً — لا داعي لفحص البقية
      const payers = await Payment.find({ student: { $in: students.map(s => s._id) } }).distinct("student");
      for (const sid of payers) await applyStudentCredit(sid);

      // إشعار كل طالب في الدفعة بالرسوم الجديدة (بدون await لتجنب التأخير)
      const netAmt = Math.max(0, amount - discount);
      const notifMsg = `تمت إضافة رسوم بعنوان "${title}" بقيمة ${netAmt.toLocaleString('ar-EG-u-nu-latn')} ج.س. تاريخ الاستحقاق: ${new Date(dueDate).toLocaleDateString('ar-EG-u-nu-latn')}.`;
      notifyStudent(req, students.map(st => st._id), 'رسوم دراسية جديدة', notifMsg).catch(() => {});

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
    const studentExists = mongoose.Types.ObjectId.isValid(studentId) ? await User.findById(studentId) : null;
    if (!studentExists) {
      return fail(res, "الطالب غير موجود", 404);
    }

    // Check if reference is unique
    const cleanRef = String(reference).trim();
    const existingPayment = await Payment.findOne({ reference: cleanRef });
    if (existingPayment) {
      return fail(res, "رقم المرجع/الإيصال مسجل مسبقاً", 400);
    }

    /* التسجيل والتخصيص عملية واحدة لا خطوتان: كان الدفع يُنشأ أولاً ثم
       تُخصَّص الرسوم، فأي فشل بينهما يترك دفعة مسجّلة ورسوماً بحالة
       "pending" — أي أن الإجمالي يقول مدفوع بينما حالة كل رسم تقول خلاف
       ذلك. نلفّهما في معاملة حيث تتوفر (Replica Set)، ونعود للسلوك
       التتابعي على النشر المستقل حيث لا معاملات. */
    let session = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch {
      session = null;
    }

    let payment;
    let remainingPayment;
    try {
      const created = await Payment.create(
        [{
          student: studentId,
          amount,
          paymentMethod,
          reference: cleanRef,
          notes,
          recordedBy: req.user.id
        }],
        session ? { session } : {}
      );
      payment = Array.isArray(created) ? created[0] : created;

      // تخصيص الدفعة على الرسوم بأسلوب FIFO باستخدام الدالة المشتركة
      ({ remainingPayment } = await allocatePaymentToFees(studentId, amount, session));

      if (session) await session.commitTransaction();
    } catch (txErr) {
      if (session) await session.abortTransaction().catch(() => {});
      throw txErr;
    } finally {
      if (session) session.endSession();
    }

    // إشعار الطالب بتسجيل دفعته
    const methodLabels = { cash: 'نقداً', bank_transfer: 'تحويل بنكي', card: 'بطاقة', deposit: 'إيداع' };
    await notifyStudent(
      req,
      studentId,
      'تم تسجيل دفعتك',
      `تم تسجيل دفعة بمبلغ ${amount.toLocaleString('ar-EG-u-nu-latn')} ج.س. بطريقة ${methodLabels[paymentMethod] || paymentMethod}. رقم المرجع: ${reference}.`
    );

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
            totalFees: {
              $sum: {
                $map: {
                  input: "$fees",
                  as: "f",
                  in: { $max: [0, { $subtract: ["$$f.amount", { $ifNull: ["$$f.discount", 0] }] }] }
                }
              }
            },
            totalPaid: { $sum: "$payments.amount" },
            balance: {
              $max: [
                0,
                {
                  $subtract: [
                    {
                      $sum: {
                        $map: {
                          input: "$fees",
                          as: "f",
                          in: { $max: [0, { $subtract: ["$$f.amount", { $ifNull: ["$$f.discount", 0] }] }] }
                        }
                      }
                    },
                    { $sum: "$payments.amount" }
                  ]
                }
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
        // استخدام القيمة الصافية (amount - discount) لحساب صحيح
        const totalFees = sFees.reduce((sum, f) => sum + Math.max(0, (f.amount || 0) - (f.discount || 0)), 0);
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

    /* الحساب يمرّ عبر getStudentBalanceSummary لا بنسخة ثانية من المنطق:
       تكرار المعادلة في مكانين كان يعني أن أي تعديل مستقبلي على طريقة
       احتساب الخصم أو الفائض يصحّ في مسار ويخطئ في الآخر. */
    const [summary, payments] = await Promise.all([
      getStudentBalanceSummary(studentId),
      Payment.find({ student: studentId }).sort({ createdAt: -1 })
    ]);

    return res.json({
      success: true,
      studentId,
      totalFees: summary.totalFees,
      totalPaid: summary.totalPaid,
      balance: summary.balance,
      // فائض السداد عن إجمالي الرسوم — رصيد دائن للطالب
      creditBalance: Math.max(0, summary.totalPaid - summary.totalFees),
      fees: summary.fees,
      payments
    });
  } catch (err) {
    return serverError(res, err, "جلب الرصيد المالي");
  }
});

// 5. POST /api/financials/payment-requests (student) - Upload a receipt
router.post("/payment-requests", auth, role("student", "leader"), uploadLimiter, upload.single("receiptFile"), async (req, res) => {
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

    /* نفس رقم التحويل مرتين = طلبان يقبلهما العميد فيُقيَّد المبلغ مرتين.
       نرفض المرجع المكرر سواء كان طلباً قيد المراجعة/مقبولاً أو دفعة مسجلة. */
    const cleanRef = String(reference || "").trim();
    if (cleanRef) {
      const [dupRequest, dupPayment] = await Promise.all([
        PaymentRequest.findOne({ reference: cleanRef, status: { $in: ["pending", "approved"] } }).select("_id").lean(),
        Payment.findOne({ reference: cleanRef }).select("_id").lean()
      ]);
      if (dupRequest || dupPayment) {
        return fail(res, "رقم المرجع هذا مستخدم في إشعار سداد سابق", 409);
      }
    }

    const request = await PaymentRequest.create({
      student: req.user.id,
      amount,
      reference: cleanRef || undefined,
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
  let session = null;
  let useTransaction = true;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch {
    useTransaction = false;
    session = null;
  }

  try {
    const { action, rejectionReason } = req.body; // action: "approve" or "reject"
    if (!["approve", "reject"].includes(action)) {
      if (session) { await session.abortTransaction(); session.endSession(); }
      return fail(res, "إجراء غير صالح", 400);
    }

    const query = PaymentRequest.findById(req.params.id);
    if (session) query.session(session);
    const request = await query;
    if (!request) {
      if (session) { await session.abortTransaction(); session.endSession(); }
      return fail(res, "طلب السداد غير موجود", 404);
    }

    if (request.status !== "pending") {
      if (session) { await session.abortTransaction(); session.endSession(); }
      return fail(res, "تمت معالجة هذا الطلب مسبقاً", 400);
    }

    if (action === "reject") {
      request.status = "rejected";
      request.rejectionReason = rejectionReason;
      request.reviewedBy = req.user.id;
      request.reviewDate = Date.now();
      await (session ? request.save({ session }) : request.save());

      if (session) {
        await session.commitTransaction();
        session.endSession();
      }

      // إشعار الطالب برفض طلبه
      const rejectMsg = rejectionReason
        ? `تم رفض طلب السداد الخاص بك بمبلغ ${request.amount.toLocaleString('ar-EG-u-nu-latn')} ج.س. السبب: ${rejectionReason}.`
        : `تم رفض طلب السداد الخاص بك بمبلغ ${request.amount.toLocaleString('ar-EG-u-nu-latn')} ج.س. يرجى التواصل مع الإدارة.`;
      await notifyStudent(req, request.student.toString(), 'رفض طلب السداد', rejectMsg);

      return res.json({ success: true, message: "تم رفض طلب السداد" });
    }

    // If Approve -> Create Payment and update Fee balances
    // 1. Create Payment
    // مرجع الطالب قد يكون سُجّل يدوياً كدفعة بعد رفع الطلب — لا نقيّده مرتين
    if (request.reference) {
      const dup = await Payment.findOne({ reference: request.reference }).select("_id").lean();
      if (dup) {
        if (session) { await session.abortTransaction(); session.endSession(); }
        return fail(res, "رقم المرجع مسجل مسبقاً كدفعة — يبدو أن هذا المبلغ قُيّد بالفعل. ارفض الطلب مع ذكر السبب.", 409);
      }
    }
    const paymentDoc = {
      student: request.student,
      amount: request.amount,
      paymentMethod: request.paymentMethod,
      reference: request.reference || `PRQ-${request._id}`,
      notes: request.notes,
      recordedBy: req.user.id
    };
    if (session) {
      await Payment.create([paymentDoc], { session });
    } else {
      await Payment.create(paymentDoc);
    }

    // 2. تخصيص الرسوم باستخدام الدالة المشتركة (FIFO)
    const { remainingPayment, updatedFees } = await allocatePaymentToFees(request.student, request.amount, session);

    // 3. Mark request as approved
    request.status = "approved";
    request.reviewedBy = req.user.id;
    request.reviewDate = Date.now();
    await (session ? request.save({ session }) : request.save());

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    // إشعار الطالب بقبول طلب سداده
    await notifyStudent(
      req,
      request.student.toString(),
      'تم قبول طلب السداد',
      `تم قبول طلب السداد الخاص بك بمبلغ ${request.amount.toLocaleString('ar-EG-u-nu-latn')} ج.س. وتحديث رصيدك. شكراً لك.`
    );

    return res.json({
      success: true,
      message: "تم قبول إشعار السداد وتحديث أرصدة الرسوم بنجاح",
      remainingPayment
    });
  } catch (err) {
    if (session) {
      try { await session.abortTransaction(); session.endSession(); } catch {}
    }
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
      if (!fee.student || !fee.student._id) continue;
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
      const netAmount = Math.max(0, (fee.amount || 0) - (fee.discount || 0));
      const remaining = Math.max(0, netAmount - (fee.paidAmount || 0));

      const studentData = studentsMap.get(studentId);
      studentData.overdueFees.push({
        _id: fee._id,
        title: fee.title,
        amount: fee.amount,
        discount: fee.discount || 0,
        netAmount,
        paidAmount: fee.paidAmount || 0,
        remainingAmount: remaining,
        dueDate: fee.dueDate,
        status: fee.status
      });
      studentData.totalOverdueAmount += remaining;
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

