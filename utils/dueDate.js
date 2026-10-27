/* موعد تسليم التكليف بالتوقيت المحلي للكلية لا بتوقيت الخادم.
   dueDate يُخزَّن كتاريخ فقط (منتصف الليل UTC) وdueTime نص "HH:mm" بالتوقيت
   المحلي. كان كل مسار يحسبه بطريقته: التسليم بإزاحة الكلية، ولوحة الطالب
   والتقويم بـ setHours على ساعة الخادم — فيختلف الموعد المعروض عن المطبَّق
   بساعتين على خادم يعمل بـ UTC. مصدر واحد للحقيقة هنا. */
const COLLEGE_UTC_OFFSET_HOURS = Number(process.env.COLLEGE_UTC_OFFSET || 2);

function resolveDueDateTime(assignment) {
  if (!assignment?.dueDate) return null;
  const due = new Date(assignment.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(assignment.dueTime || "23:59"));
  const hours = m ? Number(m[1]) : 23;
  const minutes = m ? Number(m[2]) : 59;
  due.setUTCHours(hours - COLLEGE_UTC_OFFSET_HOURS, minutes, 0, 0);
  return due;
}

module.exports = { resolveDueDateTime, COLLEGE_UTC_OFFSET_HOURS };
