const router = require("express").Router();
const Quiz = require("../models/Quiz");
const QuizAttempt = require("../models/QuizAttempt");
const Subject = require("../models/Subject");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const batch = require("../middleware/batch.middleware");
const { success, fail, notFound, serverError } = require("../utils/response");
const { logActivity } = require("../utils/activityLogger");

const publicQuiz = (quiz) => ({
  _id: quiz._id, title: quiz.title, description: quiz.description, subject: quiz.subject,
  startsAt: quiz.startsAt, endsAt: quiz.endsAt, durationMinutes: quiz.durationMinutes,
  published: quiz.published, createdBy: quiz.createdBy,
  questions: quiz.questions.map(({ text, options, points }) => ({ text, options, points }))
});

router.use(auth, batch);

router.get("/", async (req, res) => {
  try {
    const isStaff = req.user.roles.some(r => ["dean", "doctor", "leader"].includes(r));
    const filter = { batch: req.activeBatch };
    if (!isStaff) filter.published = true;
    
    if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      const Subject = require("../models/Subject");
      const mySubjects = await Subject.find({ doctor: req.user.id }).select("_id");
      filter.subject = { $in: mySubjects.map(s => s._id) };
    }
    
    const quizzes = await Quiz.find(filter).populate("subject", "name").populate("createdBy", "name").sort({ startsAt: 1 }).lean();
    // الليدر هو طالب أيضاً — اجلب محاولاته مثل الطالب
    const isStudentLike = req.user.roles.includes("student") || req.user.roles.includes("leader");
    const attempts = isStudentLike
      ? await QuizAttempt.find({ student: req.user.id, quiz: { $in: quizzes.map(q => q._id) } }).select("quiz score maxScore submittedAt").lean()
      : [];
    const attemptByQuiz = Object.fromEntries(attempts.map(a => [a.quiz.toString(), a]));
    success(res, { quizzes: quizzes.map(q => ({ ...publicQuiz(q), attempt: attemptByQuiz[q._id.toString()] || null })) });
  } catch (err) { serverError(res, err, "جلب الاختبارات"); }
});

router.post("/", role("dean", "doctor", "leader"), async (req, res) => {
  try {
    const { title, description, subject, startsAt, endsAt, durationMinutes, published, questions } = req.body;
    if (!title || !subject || !startsAt || !endsAt || !durationMinutes || !Array.isArray(questions) || !questions.length) return fail(res, "أكمل بيانات الاختبار والأسئلة");
    if (new Date(startsAt) >= new Date(endsAt)) return fail(res, "نهاية الاختبار يجب أن تكون بعد بدايته");
    const validQuestions = questions.every(q => q.text && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.correctOption) && q.correctOption >= 0 && q.correctOption < q.options.length);
    if (!validQuestions) return fail(res, "تحقق من الخيارات والإجابة الصحيحة لكل سؤال");
    const course = await Subject.findOne({ _id: subject, batches: req.activeBatch });
    if (!course) return fail(res, "المادة غير متاحة لهذه الدفعة", 403);
    const quiz = await Quiz.create({ title, description, subject, batch: req.activeBatch, startsAt, endsAt, durationMinutes, published: Boolean(published), questions, createdBy: req.user.id });
    success(res, { quiz: publicQuiz(quiz.toObject()) }, "تم إنشاء الاختبار", 201);
  } catch (err) { serverError(res, err, "إنشاء اختبار"); }
});

router.post("/:id/attempt", role("student", "leader"), async (req, res) => {
  try {
    const quiz = await Quiz.findOne({ _id: req.params.id, batch: req.activeBatch, published: true });
    if (!quiz) return notFound(res, "الاختبار غير متاح");
    const now = new Date();
    if (now < quiz.startsAt || now > quiz.endsAt) return fail(res, "الاختبار ليس متاحاً في هذا الوقت", 403);
    if (await QuizAttempt.exists({ quiz: quiz._id, student: req.user.id })) return fail(res, "تم تسليم محاولتك مسبقاً", 409);
    const received = new Map((req.body.answers || []).map(a => [Number(a.questionIndex), Number(a.selectedOption)]));
    let score = 0, maxScore = 0;
    quiz.questions.forEach((q, index) => { maxScore += q.points; if (received.get(index) === q.correctOption) score += q.points; });
    const attempt = await QuizAttempt.create({ quiz: quiz._id, student: req.user.id, answers: [...received].map(([questionIndex, selectedOption]) => ({ questionIndex, selectedOption })), score, maxScore });
    logActivity(req.user.id, "QUIZ_ATTEMPTED", { quizId: quiz._id, title: quiz.title, score, maxScore });
    success(res, { attempt: { score, maxScore, submittedAt: attempt.submittedAt } }, "تم تسليم الاختبار بنجاح");
  } catch (err) { serverError(res, err, "تسليم الاختبار"); }
});

router.get("/:id/results", role("dean", "doctor", "leader"), async (req, res) => {
  try {
    const quiz = await Quiz.findOne({ _id: req.params.id, batch: req.activeBatch });
    if (!quiz) return notFound(res, "الاختبار غير موجود");
    const attempts = await QuizAttempt.find({ quiz: quiz._id }).populate("student", "name email").sort({ score: -1, submittedAt: 1 }).lean();
    success(res, { quiz: { _id: quiz._id, title: quiz.title, maxScore: quiz.questions.reduce((sum, q) => sum + q.points, 0) }, attempts });
  } catch (err) { serverError(res, err, "جلب نتائج الاختبار"); }
});
router.delete("/:id", role("dean", "doctor", "admin"), async (req, res) => {
  try {
    const quiz = await Quiz.findOne({ _id: req.params.id, batch: req.activeBatch });
    if (!quiz) return notFound(res, "الاختبار غير موجود");
    
    if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      if (quiz.createdBy.toString() !== req.user.id) {
        return fail(res, "غير مصرح لك بحذف هذا الاختبار", 403);
      }
    }

    await QuizAttempt.deleteMany({ quiz: quiz._id });
    await Quiz.findByIdAndDelete(req.params.id);
    success(res, null, "تم حذف الاختبار بنجاح");
  } catch (err) { serverError(res, err, "حذف الاختبار"); }
});

module.exports = router;
