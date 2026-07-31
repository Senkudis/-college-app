const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: [true, "قيمة الدفع مطلوبة"],
      min: [0.01, "قيمة الدفع يجب أن تكون أكبر من صفر"]
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["cash", "bank_transfer", "card", "deposit"]
    },
    reference: {
      type: String,
      required: [true, "رقم المرجع/الإيصال مطلوب"],
      unique: true,
      trim: true
    },
    paymentDate: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      trim: true
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", PaymentSchema);
