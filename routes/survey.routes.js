const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const CourseSurvey = require('../models/CourseSurvey');
const Subject = require('../models/Subject');
const auth = require('../middleware/auth.middleware');
const { success, fail, notFound, serverError } = require('../utils/response');

// جلب المقررات المتاحة للتقييم مع التحقق من التقديم المسبق
router.get('/active', auth, async (req, res) => {
  try {
    const batchId = req.user?.batch || req.user?.batchId;
    const academicYear = req.query.year || '2025/2026';

    const subjects = await Subject.find({
      ...(batchId ? { batches: batchId } : {})
    }).select('name code doctor').populate('doctor', 'name').lean();

    const userSubmissions = await CourseSurvey.find({
      submittedByHash: {
        $in: subjects.map(s => crypto.createHash('sha256').update(`${req.user.id}-${s._id}-${academicYear}`).digest('hex'))
      }
    }).lean();

    const submittedHashes = new Set(userSubmissions.map(s => s.submittedByHash));

    const result = subjects.map(s => {
      const hash = crypto.createHash('sha256').update(`${req.user.id}-${s._id}-${academicYear}`).digest('hex');
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
    const { subjectId, ratings = {}, feedbackText = '', academicYear = '2025/2026', semester = 1 } = req.body;
    if (!subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
      return fail(res, 'معرف المقرر مطلوب');
    }

    const { contentClarity, teachingMethod, labUsefulness, examFairness } = ratings;
    if (!contentClarity || !teachingMethod || !labUsefulness || !examFairness) {
      return fail(res, 'يجب تعبئة كافة معايير التقييم من 1 إلى 5');
    }

    const subject = await Subject.findById(subjectId);
    if (!subject) return notFound(res, 'المقرر غير موجود');

    // إنشاء توقيع تشفير مجهول لمنع التكرار
    const hash = crypto.createHash('sha256').update(`${req.user.id}-${subjectId}-${academicYear}`).digest('hex');

    const existing = await CourseSurvey.findOne({ submittedByHash: hash });
    if (existing) {
      return fail(res, 'لقد قمت بإرسال تقييمك لهذا المقرر مسبقاً');
    }

    const targetBatch = (subject.batches && subject.batches[0]) || subject.batch || req.user.batch || req.user.batchId;
    const survey = await CourseSurvey.create({
      subject: subjectId,
      batch: targetBatch,
      semester: parseInt(semester, 10) || 1,
      academicYear,
      ratings: {
        contentClarity: Number(contentClarity),
        teachingMethod: Number(teachingMethod),
        labUsefulness: Number(labUsefulness),
        examFairness: Number(examFairness)
      },
      feedbackText: (feedbackText || '').slice(0, 1000),
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
    if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) filter.subject = subjectId;

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
