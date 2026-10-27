const Fee = require("../models/Fee");

/**
 * Fee Allocation Utility - FIFO (First In, First Out) Logic
 * Allocates payment amount to pending fees in order of dueDate (oldest first)
 */

/**
 * Allocates payment amount to student's pending fees using FIFO
 * @param {ObjectId} studentId - Student ObjectId
 * @param {Number} amount - Payment amount to allocate
 * @param {Object} session - Optional Mongoose session for transactions
 * @returns {Object} Allocation result with updated fees and remaining amount
 */
async function allocatePaymentToFees(studentId, amount, session = null) {
  if (!amount || amount <= 0) {
    throw new Error("مبلغ الدفع يجب أن يكون أكبر من صفر");
  }

  // Find all pending fees for student, sorted by dueDate (oldest first)
  const query = Fee.find({
    student: studentId,
    status: { $ne: "paid" }
  }).sort({ dueDate: 1 });

  if (session) query.session(session);

  const pendingFees = await query;

  if (pendingFees.length === 0) {
    return {
      updatedFees: [],
      remainingPayment: amount
    };
  }

  let remainingPayment = amount;
  const updatedFees = [];

  for (const fee of pendingFees) {
    if (remainingPayment <= 0) break;

    const netAmount = Math.max(0, (fee.amount || 0) - (fee.discount || 0));
    const feeRemaining = Math.max(0, netAmount - (fee.paidAmount || 0));

    if (feeRemaining <= 0) {
      fee.paidAmount = netAmount;
      fee.status = "paid";
    } else if (remainingPayment >= feeRemaining) {
      // Fully pay this fee
      fee.paidAmount = netAmount;
      fee.status = "paid";
      remainingPayment -= feeRemaining;
    } else {
      // Partially pay this fee
      fee.paidAmount = (fee.paidAmount || 0) + remainingPayment;
      fee.status = fee.paidAmount >= netAmount ? "paid" : "partially_paid";
      remainingPayment = 0;
    }

    if (session) {
      await fee.save({ session });
    } else {
      await fee.save();
    }
    updatedFees.push(fee);
  }

  return {
    updatedFees,
    remainingPayment
  };
}

/**
 * Calculates student balance summary
 * @param {ObjectId} studentId - Student ObjectId
 * @returns {Object} Balance summary
 */
async function getStudentBalanceSummary(studentId) {
  const [fees, payments] = await Promise.all([
    Fee.find({ student: studentId }).lean(),
    require("../models/Payment").find({ student: studentId }).lean()
  ]);

  const totalFees = fees.reduce((sum, f) => sum + Math.max(0, (f.amount || 0) - (f.discount || 0)), 0);
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const balance = Math.max(0, totalFees - totalPaid);

  return {
    studentId,
    totalFees,
    totalPaid,
    balance,
    pendingFeesCount: fees.filter(f => f.status !== "paid").length,
    paidFeesCount: fees.filter(f => f.status === "paid").length,
    fees: fees.map(f => ({
      _id: f._id,
      title: f.title,
      amount: f.amount,
      discount: f.discount || 0,
      netAmount: Math.max(0, (f.amount || 0) - (f.discount || 0)),
      paidAmount: f.paidAmount || 0,
      status: f.status,
      dueDate: f.dueDate
    }))
  };
}

/**
 * يطبّق رصيد الطالب الدائن (ما دفعه زيادة على رسومه السابقة) على رسومه المفتوحة.
 * الفائض عند الدفع كان يبقى معلّقاً: الرصيد الإجمالي صحيح، لكن أي رسم يُضاف
 * لاحقاً يظهر "غير مدفوع" ويدخل تقرير المتأخرات رغم أن الطالب سدّده سلفاً.
 * يُستدعى بعد إنشاء رسوم جديدة.
 */
async function applyStudentCredit(studentId, session = null) {
  const Payment = require("../models/Payment");
  const feesQ = Fee.find({ student: studentId }).select("paidAmount").lean();
  const paysQ = Payment.find({ student: studentId }).select("amount").lean();
  if (session) { feesQ.session(session); paysQ.session(session); }
  const [fees, payments] = await Promise.all([feesQ, paysQ]);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const allocated = fees.reduce((s, f) => s + (f.paidAmount || 0), 0);
  const credit = totalPaid - allocated;
  if (credit <= 0) return { applied: 0 };
  const { remainingPayment } = await allocatePaymentToFees(studentId, credit, session);
  return { applied: credit - remainingPayment };
}

module.exports = {
  allocatePaymentToFees,
  applyStudentCredit,
  getStudentBalanceSummary
};