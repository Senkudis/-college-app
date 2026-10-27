const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const CourseSurvey = require('../models/CourseSurvey');
const Subject = require('../models/Subject');
const auth = require('../middleware/auth.middleware');
const { success, fail, notFound, serverError } = require('../utils/response');

/* العام الأكاديمي يحدده الخادم (سبتمبر–أغسطس): كان القيمة من العميل وافتراضها
   '2025/2026' ثابت — فيكفي تغيير النص لإعادة تقييم المقرر مرات بلا حد. */
function currentAcademicYear(d = new Date()) {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 8 ? y : y - 1; // سبتمبر = 8
  return `${start}/${start + 1}`;
}

/* بصمة منع التكرار بمفتاح سري (HMAC): sha256 العارية لمعرّف الطالب+المقرر
   يحسبها أي مطّلع على القاعدة لكل طالب فيعرف صاحب كل تقييم "مجهول". */
const SURVEY_KEY = process.env.SURVEY_SECRET || process.env.JWT_SECRET || 'survey';
const surveyHash = (userId, subjectId, year) =>
  crypto.createHmac('sha256', SURVEY_KEY).update(`${userId}-${subjectId}-${year}`).digest('hex');

const isStudentLike = (user) => (user?.roles || []).some(r => r === 'student' || r === 'leader');

// جلب المقررات المتاحة للتقييم مع التحقق من التقديم المسبق
router.get('/active', auth, async (req, res) => {
  try {
    const batchId = req.user?.batch;
    const academicYear = currentAcademicYear();
    // التقييم للطلاب عن مقررات دفعتهم فقط (لا يقيّم الدكتور نفسه)
    if (!isStudentLike(req.user) || !batchId) {
      return success(res, { subjects: [], academicYear });
    }

    const subjects = await Subject.find({ batches: batchId })
      .select('name code doctor').populate('doctor', 'name').lean();

    const userSubmissions = await CourseSurvey.find({
      submittedByHash: {
        $in: subjects.map(s => surveyHash(req.user.id, s._id, academicYear))
      }
    }).lean();

    const submittedHashes = new Set(userSubmissions.map(s => s.submittedByHash));

    const result = subjects.map(s => {
      const hash = surveyHash(req.user.id, s._id, academicYear);
      return {
        _id: s._id,
        name: s.name,
        code: s.code,
        doctor: s.doctor?.name || 'أستاذ المقرر',
        alreadySubmitted: submittedHashes.has(hash)
      };
    });

    return success(res, { subjects: result, academicYear });
  } catch (err) {
    return serverError(res, err);
  }
});

// إرسال استبيان تقييم مجهول الهوية
router.post('/submit', auth, async (req, res) => {
  try {
    const { subjectId, ratings = {}, feedbackText = '', semester = 1 } = req.body;
    const academicYear = currentAcademicYear();
    if (!isStudentLike(req.user)) {
      return fail(res, 'تقييم المقررات متاح للطلاب فقط', 403);
    }
    if (!subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
      return fail(res, 'معرف المقرر مطلوب');
    }

    const { contentClarity, teachingMethod, labUsefulness, examFairness } = ratings;
    const ratingValues = [contentClarity, teachingMethod, labUsefulness, examFairness];
    const allValid = ratingValues.every(v => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5);
    if (!allValid) {
      return fail(res, 'يجب تعبئة كافة معايير التقييم بأرقام صحيحة من 1 إلى 5');
    }

    const subject = await Subject.findById(subjectId);
    if (!subject) return notFound(res, 'المقرر غير موجود');
    if (!req.user.batch || !(subject.batches || []).some(b => String(b) === String(req.user.batch))) {
      return fail(res, 'لا يمكنك تقييم مقرر خارج دفعتك', 403);
    }

    // إنشاء توقيع تشفير مجهول لمنع التكرار
    const hash = surveyHash(req.user.id, subjectId, academicYear);

    const existing = await CourseSurvey.findOne({ submittedByHash: hash });
    if (existing) {
      return fail(res, 'لقد قمت بإرسال تقييمك لهذا المقرر مسبقاً');
    }

    const targetBatch = req.user.batch;
    const survey = await CourseSurvey.create({
      subject: subjectId,
      batch: targetBatch,
      semester: [1, 2, 3].includes(parseInt(semester, 10)) ? parseInt(semester, 10) : 1,
      academicYear,
      ratings: {
        contentClarity: Number(contentClarity),
        teachingMethod: Number(teachingMethod),
        labUsefulness: Number(labUsefulness),
        examFairness: Number(examFairness)
      },
      feedbackText: String(feedbackText || '').slice(0, 1000),
      submittedByHash: hash
    });

    return success(res, { surveyId: survey._id }, 'تم تسجيل تقييمك بنجاح وبسرية تامة', 201);
  } catch (err) {
    return serverError(res, err);
  }
});

// إحصاءات وتحليلات تقييم المقررات (للعميد وأساتذة المقررات)
router.get('/analytics', auth, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    if (!userRoles.some(r => ['dean', 'doctor', 'admin'].includes(r))) {
      return fail(res, 'غير مصرح لك بعرض تحليلات الاستبيانات', 403);
    }

    const { subjectId } = req.query;
    const filter = {};
    const isStaff = userRoles.some(r => ['dean', 'admin'].includes(r));

    if (!isStaff && userRoles.includes('doctor')) {
      const mySubjects = await Subject.find({ doctor: req.user.id }).distinct('_id');
      const mySubjStrs = new Set(mySubjects.map(id => id.toString()));
      if (subjectId) {
        if (!mySubjStrs.has(subjectId)) {
          return fail(res, 'غير مصرح لك بعرض تحليلات هذا المقرر', 403);
        }
        filter.subject = subjectId;
      } else {
        filter.subject = { $in: mySubjects };
      }
    } else if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
      filter.subject = subjectId;
    }

    const surveys = await CourseSurvey.find(filter).populate('subject', 'name code').lean();

    if (!surveys.length) {
      return success(res, {
        totalEvaluations: 0,
        averageRatings: { contentClarity: 0, teachingMethod: 0, labUsefulness: 0, examFairness: 0, overall: 0 },
        satisfactionIndex: 0,
        feedbacks: []
      });
    }

    let sumClarity = 0, sumTeaching = 0, sumLabs = 0, sumExams = 0;
    const feedbacks = [];

    surveys.forEach(s => {
      sumClarity += s.ratings.contentClarity || 0;
      sumTeaching += s.ratings.teachingMethod || 0;
      sumLabs += s.ratings.labUsefulness || 0;
      sumExams += s.ratings.examFairness || 0;
      if (s.feedbackText && s.feedbackText.trim()) {
        feedbacks.push({
          subjectName: s.subject?.name || 'المقرر',
          text: s.feedbackText,
          createdAt: s.createdAt
        });
      }
    });

    const count = surveys.length;
    const avgClarity = Number((sumClarity / count).toFixed(2));
    const avgTeaching = Number((sumTeaching / count).toFixed(2));
    const avgLabs = Number((sumLabs / count).toFixed(2));
    const avgExams = Number((sumExams / count).toFixed(2));
    const overall = Number(((avgClarity + avgTeaching + avgLabs + avgExams) / 4).toFixed(2));
    const satisfactionIndex = Math.round((overall / 5) * 100);

    return success(res, {
      totalEvaluations: count,
      averageRatings: {
        contentClarity: avgClarity,
        teachingMethod: avgTeaching,
        labUsefulness: avgLabs,
        examFairness: avgExams,
        overall
      },
      satisfactionIndex,
      feedbacks: feedbacks.slice(0, 50)
    });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
