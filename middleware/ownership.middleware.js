const Subject = require('../models/Subject');

/**
 * Middleware للتحقق مما إذا كان المستخدم يملك الصلاحية لإدارة المادة المحددة.
 * الصلاحية تمنح إذا كان المستخدم: عميد، أو دكتور يدرس المادة، أو ليدر في إحدى دفعات المادة.
 *
 * يفترض هذا الميدل وير أن `req.user` موجود (عبر auth middleware) وأن `req.params.subjectId` أو `req.body.subject` يحتوي على معرف المادة.
 */
const verifySubjectAccess = async (req, res, next) => {
  try {
    const params = req.params || {};
    const body = req.body || {};
    const query = req.query || {};
    const subjectId = params.subjectId || params.id || body.subject || query.subject;
    if (!subjectId) {
      return res.status(400).json({ success: false, message: 'معرف المادة مطلوب' });
    }

    const subject = await Subject.findById(subjectId).select('doctor batches');
    if (!subject) {
      return res.status(404).json({ success: false, message: 'المادة غير موجودة' });
    }

    // إرفاق المادة بالطلب لتجنب الاستعلام عنها مرة أخرى
    req.subject = subject;

    if (req.user?.roles?.includes('dean') || req.user?.roles?.includes('admin')) {
      return next(); // العميد والأدمن يملكون كل الصلاحيات
    }

    const doctorId = subject.doctor ? subject.doctor.toString() : null;
    const userId = (req.user?._id || req.user?.id || '').toString();
    const isDoctor = req.user?.roles?.includes('doctor') && doctorId && doctorId === userId;

    const userBatch = (req.user?.batch || '').toString();
    const subjectBatches = Array.isArray(subject.batches) ? subject.batches.map(b => b.toString()) : [];
    const isLeader = req.user?.roles?.includes('leader') && userBatch && subjectBatches.includes(userBatch);

    if (!isDoctor && !isLeader) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بإدارة هذه المادة' });
    }

    // إرفاق المادة بالطلب لتجنب الاستعلام عنها مرة أخرى إن لزم الأمر
    req.subject = subject;
    next();
  } catch (error) {
    console.error('Error in verifySubjectAccess:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء التحقق من الصلاحيات' });
  }
};

module.exports = { verifySubjectAccess };
