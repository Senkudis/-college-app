const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema(
  {
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true
    },
    date: {
      type: String, // تخزين التاريخ بصيغة YYYY-MM-DD لسهولة الفرز
      required: true
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    students: [
      {
        student: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User"
        },
        status: {
          type: String,
          enum: ["present", "absent"],
          default: "absent"
        }
      }
    ]
  },
  { timestamps: true }
);

// منع تكرار تسجيل الحضور لنفس المادة في نفس اليوم من قبل نفس الشخص
AttendanceSchema.index({ subject: 1, date: 1, recordedBy: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", AttendanceSchema);
