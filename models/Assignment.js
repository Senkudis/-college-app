const mongoose = require("mongoose");

const AssignmentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "العنوان مطلوب"],
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    type: {
      type: String,
      enum: ["exercise", "research", "project"],
      required: [true, "نوع التكليف مطلوب"]
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "المادة الدراسية مطلوبة"]
    },
    file: {
      type: String,
      required: [true, "يجب رفع ملف التكليف"]
    },
    dueDate: {
      type: Date
    },
    // الوقت المحدد للتسليم (الساعة والدقيقة)
    dueTime: {
      type: String, // صيغة "HH:mm" مثل "23:59"
      default: "23:59"
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    batches: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch"
    }]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Assignment", AssignmentSchema);
