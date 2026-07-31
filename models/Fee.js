const mongoose = require("mongoose");

const FeeSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    title: {
      type: String,
      required: [true, "عنوان الرسم مطلوب"],
      trim: true
    },
    feeType: {
      type: String,
      enum: ["tuition", "services", "fine", "other"],
      default: "tuition"
    },
    amount: {
      type: Number,
      required: [true, "القيمة مطلوبة"],
      min: [0, "القيمة لا يمكن أن تكون سالبة"]
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, "الخصم لا يمكن أن يكون سالباً"],
      validate: {
        validator: function(v) { return v <= this.amount; },
        message: "الخصم لا يمكن أن يتجاوز قيمة الرسم"
      }
    },
    notes: {
      type: String,
      trim: true,
      default: ""
    },
    dueDate: {
      type: Date,
      required: [true, "تاريخ الاستحقاق مطلوب"]
    },
    status: {
      type: String,
      enum: ["pending", "partially_paid", "paid"],
      default: "pending",
      index: true
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual property to calculate net amount after discount
FeeSchema.virtual("netAmount").get(function() {
  return Math.max(0, this.amount - (this.discount || 0));
});

// Virtual property to calculate remaining balance on the fee (after discount)
FeeSchema.virtual("remainingAmount").get(function() {
  const net = Math.max(0, this.amount - (this.discount || 0));
  return Math.max(0, net - this.paidAmount);
});

module.exports = mongoose.model("Fee", FeeSchema);
