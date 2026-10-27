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
const { getManageScope, canManageSubjectContent } = require('../utils/contentPermissions');

/* الفحص قبل multer: كان الملف يُكتب على القرص أولاً ثم يُرفض الطالب،
   فيبقى ملفه يتيماً في uploads مع كل محاولة. */
function staffOnly(req, res, next) {
  const roles = req.user?.roles || [];
  if (!roles.some(r => ['dean', 'doctor', 'leader', 'admin'].includes(r))) {
    return fail(res, 'غير مصرح لك بإدارة نماذج الامتحانات السابقة', 403);
  }
  next();
}

/* الدكتور يضيف لمواده والليدر لمواد دفعته فقط — نفس قاعدة محتوى المواد */
async function canUseSubject(user, subjectId) {
  if (!mongoose.Types.ObjectId.isValid(subjectId)) return false;
  const subject = await Subject.findById(subjectId).select('doctor batches').lean();
  if (!subject) return false;
  return canManageSubjectContent(await getManageScope(user), { ownerId: null, subject });
}

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
    // الإجابات والشروحات تصل بعد التسليم من /simulate — إرسالها هنا يكشفها قبل المحاولة
    if (!canManageExam(req.user, exam)) {
      exam.questions = (exam.questions || []).map(({ correctOption, explanation, ...q }) => q);
    }
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
router.post('/', auth, staffOnly, upload.single('pdfFile'), async (req, res) => {
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
    if (!(await canUseSubject(req.user, subject))) {
      if (req.file) removeUploadedFile(path.join('uploads', 'past-exams', req.file.filename));
      return fail(res, 'لا يمكنك إضافة نماذج لهذه المادة', 403);
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
router.put('/:id', auth, staffOnly, upload.single('pdfFile'), async (req, res) => {
  try {
    const exam = await PastExam.findById(req.params.id);
    if (!exam) return notFound(res, 'الامتحان غير موجود');
    if (!canManageExam(req.user, exam)) {
      return fail(res, 'لا تملك صلاحية تعديل هذا النموذج', 403);
    }

    const { title, subject, year, semester, examType, questions } = req.body;
    if (title !== undefined) exam.title = title;
    if (subject !== undefined && String(subject) !== String(exam.subject)) {
      if (!(await canUseSubject(req.user, subject))) {
        if (req.file) removeUploadedFile(path.join('uploads', 'past-exams', req.file.filename));
        return fail(res, 'لا يمكنك نقل النموذج لهذه المادة', 403);
      }
      exam.subject = subject;
    }
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

    /* كان "تشخيص كيدي" نصاً ثابتاً من ثلاث جمل بحسب النسبة — يُعرض للطالب
       كأنه تحليل ذكي لأخطائه وهو ليس كذلك. الآن يحلل كيدي الأسئلة التي أخطأ
       فيها فعلاً؛ وإن تعذّر (لا أخطاء، أو تعطّل المزوّدون) نعرض ملاحظة عامة
       موسومة بمصدرها كي لا تُقدَّم على أنها من كيدي. */
    let aiDiagnosis = percentage >= 85
      ? 'أداء ممتاز واستيعاب متكامل لمفاهيم الامتحان.'
      : percentage >= 60
        ? 'مستوى جيد، راجع الأسئلة التي أخطأت فيها في محاضرات المقرر.'
        : 'تحتاج إلى تكثيف المراجعة والتركيز على المفاهيم الأساسية قبل الامتحان الفعلي.';
    let diagnosisSource = 'rules';
    const wrong = review.filter(r => !r.isCorrect);
    if (wrong.length && process.env.NODE_ENV !== 'test') {
      try {
        const ai = require('./ai.routes')._internals;
        const lines = wrong.slice(0, 8).map(r => {
          const q = questions[r.questionIndex] || {};
          const opts = q.options || [];
          const picked = r.selectedOption >= 0 ? (opts[r.selectedOption] ?? '—') : 'لم يُجب';
          return `- ${q.text}\n  اختار: ${picked} | الصحيح: ${opts[q.correctOption] ?? '—'}`;
        }).join('\n');
        const prompt = ai.buildAskPrompt({
          q: `حلّلت امتحان «${exam.title}» (مادة ${exam.subject?.name || '-'}) وحصلت على ${percentage}%. هذه الأسئلة التي أخطأت فيها:\n${lines}`,
          mode: { directive: 'شخّص أخطاءه في 3-5 أسطر: ما المفهوم المشترك الذي يبدو أنه لم يفهمه، ولماذا كان اختياره خاطئاً باختصار، ثم خطوتان محددتان للمراجعة قبل الامتحان. بلا عناوين ولا تكرار للأسئلة.' }
        });
        const text = await ai.askAIWithUltimateFallback(prompt, { maxOutputTokens: 1400, temperature: 0.3, budgetMs: 20_000 });
        if (text && text.trim()) { aiDiagnosis = ai.sanitizeAnswer(text).replace(/\*\*|^#+\s*/gm, ''); diagnosisSource = 'ai'; } // يُعرض نصاً عادياً
      } catch (e) {
        console.warn('[past-exam/simulate] تعذّر تشخيص كيدي:', e.message);
      }
    }

    return success(res, {
      score: earnedPoints,
      total: totalPoints,
      percentage,
      passed,
      correctCount,
      totalQuestions: questions.length,
      aiDiagnosis,
      diagnosisSource,
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
