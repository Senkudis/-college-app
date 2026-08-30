const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const PastExam = require('../models/PastExam');
const upload = require('../config/multer');
const { removeUploadedFile } = require('../config/multer');
const path = require('path');
const Subject = require('../models/Subject');
const auth = require('../middleware/auth.middleware');
const { success, fail, notFound, serverError } = require('../utils/response');

// جلب نماذج الامتحانات السابقة مع التصفية
router.get('/', auth, async (req, res) => {
  try {
    const { subject, year, examType } = req.query;
    const filter = {};
    if (subject && mongoose.Types.ObjectId.isValid(subject)) filter.subject = subject;
    if (year) filter.year = year;
    if (examType) filter.examType = examType;

    const exams = await PastExam.find(filter)
      .populate('subject', 'name code')
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    return success(res, { exams, count: exams.length });
  } catch (err) {
    return serverError(res, err);
  }
});

// جلب امتحان محدد مع الأسئلة للمحاكاة
router.get('/:id', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 'معرف الامتحان غير صالح');
    }
    const exam = await PastExam.findById(req.params.id)
      .populate('subject', 'name code')
      .populate('uploadedBy', 'name')
      .lean();

    if (!exam) return notFound(res, 'الامتحان غير موجود');
    return success(res, { exam });
  } catch (err) {
    return serverError(res, err);
  }
});


/* مع multipart تصل الحقول نصوصاً، فقد تأتي الأسئلة كسلسلة JSON. */
function parseQuestions(q) {
  if (Array.isArray(q)) return q;
  if (typeof q === 'string' && q.trim()) {
    try { const parsed = JSON.parse(q); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

/* صلاحية التعديل والحذف: الطاقم، على أن يقتصر الدكتور والليدر على ما رفعاه
   بأنفسهم — العميد والأدمن يديران الجميع. */
function canManageExam(user, exam) {
  const roles = user?.roles || [];
  if (roles.some(r => ['dean', 'admin'].includes(r))) return true;
  if (!roles.some(r => ['doctor', 'leader'].includes(r))) return false;
  return String(exam.uploadedBy?._id || exam.uploadedBy) === String(user.id);
}

// إضافة نموذج امتحان سابق (عميد، دكتور، ليدر)
router.post('/', auth, upload.single('pdfFile'), async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    if (!userRoles.some(r => ['dean', 'doctor', 'leader', 'admin'].includes(r))) {
      return fail(res, 'غير مصرح لك بإضافة نماذج امتحانات سابقة', 403);
    }

    const { title, subject, year, semester, examType, questions = [] } = req.body;
    // الملف يصل عبر multipart، ويبقى الحقل النصي مقبولاً للتوافق الخلفي
    const pdfFile = req.file ? req.file.filename : (req.body.pdfFile || null);
    if (!title || !subject || !year) {
      return fail(res, 'العنوان والمادة والسنة الأكاديمية حقول مطلوبة');
    }

    const exam = await PastExam.create({
      title,
      subject,
      year,
      semester: parseInt(semester, 10) || 1,
      examType: examType || 'final',
      pdfFile: pdfFile || null,
      questions: parseQuestions(questions),
      uploadedBy: req.user.id
    });

    return success(res, { exam }, 'تمت إضافة نموذج الامتحان بنجاح', 201);
  } catch (err) {
    return serverError(res, err);
  }
});

// تعديل نموذج امتحان سابق (مع إمكانية استبدال الملف)
router.put('/:id', auth, upload.single('pdfFile'), async (req, res) => {
  try {
    const exam = await PastExam.findById(req.params.id);
    if (!exam) return notFound(res, 'الامتحان غير موجود');
    if (!canManageExam(req.user, exam)) {
      return fail(res, 'لا تملك صلاحية تعديل هذا النموذج', 403);
    }

    const { title, subject, year, semester, examType, questions } = req.body;
    if (title !== undefined) exam.title = title;
    if (subject !== undefined) exam.subject = subject;
    if (year !== undefined) exam.year = year;
    if (semester !== undefined) exam.semester = parseInt(semester, 10) || 1;
    if (examType !== undefined) exam.examType = examType;
    if (questions !== undefined) exam.questions = parseQuestions(questions);

    // ملف جديد يحل محل القديم، ونحذف القديم من القرص كي لا تتراكم الملفات اليتيمة
    if (req.file) {
      const previous = exam.pdfFile;
      exam.pdfFile = req.file.filename;
      if (previous) removeUploadedFile(path.join('uploads', 'past-exams', previous));
    }

    await exam.save();
    return success(res, { exam }, 'تم تحديث نموذج الامتحان بنجاح');
  } catch (err) {
    return serverError(res, err);
  }
});

// محاكاة الامتحان وتصحيح الإجابات مع تشخيص كيدي
router.post('/:id/simulate', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 'معرف الامتحان غير صالح');
    }
    const exam = await PastExam.findById(req.params.id).populate('subject', 'name').lean();
    if (!exam) return notFound(res, 'الامتحان غير موجود');

    const userAnswers = req.body.answers || {}; // { questionIndex: selectedOption }
    const questions = exam.questions || [];

    if (!questions.length) {
      return fail(res, 'هذا الامتحان لا يحتوي على أسئلة تفاعلية للمحاكاة بعد');
    }

    let correctCount = 0;
    let totalPoints = 0;
    let earnedPoints = 0;
    const review = [];

    questions.forEach((q, idx) => {
      const selected = userAnswers[idx] !== undefined ? Number(userAnswers[idx]) : -1;
      const isCorrect = selected === q.correctOption;
      const points = q.points || 1;
      totalPoints += points;

      if (isCorrect) {
        correctCount++;
        earnedPoints += points;
      }

      review.push({
        questionIndex: idx,
        questionText: q.text,
        selectedOption: selected,
        correctOption: q.correctOption,
        isCorrect,
        explanation: q.explanation || ''
      });
    });

    const percentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    const passed = percentage >= 50;

    let aiDiagnosis = '';
    if (percentage >= 85) {
      aiDiagnosis = 'أداء ممتاز واستيعاب متكامل لمفاهيم الامتحان ومفردات المقرر.';
    } else if (percentage >= 60) {
      aiDiagnosis = 'مستوى جيد، ولكن يُنصح بمراجعة الأسئلة التي بها التباس في شيتات المحاضرات التابعة للمقرر.';
    } else {
      aiDiagnosis = 'تحتاج إلى تكثيف المراجعة والتركيز على المفاهيم الجوهرية والأسئلة الشائعة قبل دخول الامتحان الفعلي.';
    }

    return success(res, {
      score: earnedPoints,
      total: totalPoints,
      percentage,
      passed,
      correctCount,
      totalQuestions: questions.length,
      aiDiagnosis,
      review
    }, 'تم تصحيح المحاكاة بنجاح');
  } catch (err) {
    return serverError(res, err);
  }
});

// حذف امتحان
router.delete('/:id', auth, async (req, res) => {
  try {
    const exam = await PastExam.findById(req.params.id);
    if (!exam) return notFound(res, 'الامتحان غير موجود');
    if (!canManageExam(req.user, exam)) {
      return fail(res, 'لا تملك صلاحية حذف هذا النموذج', 403);
    }
    if (exam.pdfFile) removeUploadedFile(path.join('uploads', 'past-exams', exam.pdfFile));
    await exam.deleteOne();
    return success(res, null, 'تم حذف نموذج الامتحان بنجاح');
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
