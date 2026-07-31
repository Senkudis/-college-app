const mongoose = require("mongoose");

const PaymentRequestSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: [true, "المبلغ المدفوع مطلوب"],
      min: [0.01, "المبلغ يجب أن يكون أكبر من صفر"]
    },
    paymentMethod: {
      type: String,
      required: true,
      default: "bank_transfer",
      enum: ["cash", "bank_transfer", "card", "deposit"]
    },
    reference: {
      type: String,
      trim: true
    },
    receiptFile: {
      type: String, // Filename of the uploaded receipt image/pdf
      required: true
    },
    notes: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    reviewDate: {
      type: Date
    },
    rejectionReason: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentRequest", PaymentRequestSchema);
