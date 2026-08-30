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

/* حصة واحدة لكل مادة في اليوم — لا سجل لكل راصد.
   إدراج recordedBy في الفهرس كان يجعل التفرّد "لكل شخص": الدكتور والليدر
   كلاهما مخوّل برصد الحضور، فإن رصدا اليوم نفسه ظهر سجلان وحُسبت الحصة
   مرتين. النسبة الناتجة تغذّي تحذيرات الغياب وتقرير الإنذار المبكر وحالة
   "معرّض للخطر" في السجل الأكاديمي — فالخطأ كان ينتشر في كل مكان. */
AttendanceSchema.index({ subject: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", AttendanceSchema);
