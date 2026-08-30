const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const StudyPod = require('../models/StudyPod');
const User = require('../models/User');
const auth = require('../middleware/auth.middleware');
const { success, fail, notFound, serverError } = require('../utils/response');

/* ── مساعد: هل المستخدم عميد أو أدمن؟ ── */
function isAdmin(user) {
  const roles = user?.roles || [];
  return roles.some(r => ['dean', 'admin'].includes(r));
}

/* دفعات المستخدم: الطالب والليدر لهم دفعة واحدة، والدكتور عدة دفعات. */
async function userBatchIds(user) {
  if (user?.roles?.includes('doctor')) {
    const doctor = await User.findById(user.id).select('batches').lean();
    return (doctor?.batches || []).map(String);
  }
  return user?.batch ? [String(user.batch)] : [];
}

/* حارس الوصول لغرفة بعينها. كانت كل مسارات التعديل (الانضمام والمهام
   والمؤقّت) تكتفي بـ auth بلا أي فحص دفعة: بمعرّف غرفة فقط كان أي مستخدم
   من أي دفعة ينضم، ويضيف مهاماً، ويقلب إنجاز مهام غيره، ويعيد ضبط مؤقّت
   مجموعة لا ينتمي إليها. */
async function loadPodForUser(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    fail(res, 'معرف الغرفة غير صالح');
    return null;
  }
  const pod = await StudyPod.findById(req.params.id);
  if (!pod) {
    notFound(res, 'غرفة المذاكرة غير موجودة');
    return null;
  }
  if (isAdmin(req.user)) return pod;

  const mine = await userBatchIds(req.user);
  if (!pod.batch || !mine.includes(String(pod.batch))) {
    fail(res, 'هذه الغرفة تخص دفعة أخرى', 403);
    return null;
  }
  return pod;
}

// جلب جلسات المذاكرة — العميد والأدمن يريان الكل، الطلاب يرون دفعتهم فقط
router.get('/', auth, async (req, res) => {
  try {
    const filter = {};
    if (!isAdmin(req.user)) {
      /* الطالب والليدر والدكتور: غرف دفعاتهم فقط.
         كان الفلتر يعتمد على req.user.batch وحده — والدكتور لا يملك هذا
         الحقل (بل batches) — فيبقى الفلتر فارغاً ويرى كل غرف الكلية،
         عكس ما يقوله التعليق تماماً. */
      const mine = await userBatchIds(req.user);
      if (!mine.length) return success(res, { pods: [] });
      filter.batch = { $in: mine };
    }
    // العميد/الأدمن: filter يبقى فارغاً → يجلب الكل

    const pods = await StudyPod.find(filter)
      .populate('subject', 'name code')
      .populate('batch', 'name')
      .populate('createdBy', 'name')
      .sort({ updatedAt: -1 })
      .lean();

    return success(res, { pods });
  } catch (err) {
    return serverError(res, err);
  }
});

// إنشاء غرفة مذاكرة جماعية جديدة
router.post('/', auth, async (req, res) => {
  try {
    const { title, subject, batch } = req.body;
    const targetBatch = batch || req.user?.batch || req.user?.batchId;

    if (!title || !subject || !targetBatch) {
      return fail(res, 'العنوان والمادة والدفعة حقول مطلوبة');
    }

    /* الدفعة كانت تُؤخذ من الجسم بلا تحقق، فيُنشئ الطالب غرفة داخل دفعة
       لا ينتمي إليها. العميد والأدمن وحدهما يتجاوزان هذا القيد. */
    if (!isAdmin(req.user)) {
      const mine = await userBatchIds(req.user);
      if (!mine.includes(String(targetBatch))) {
        return fail(res, 'لا يمكنك إنشاء غرفة في دفعة لا تنتمي إليها', 403);
      }
    }

    const pod = await StudyPod.create({
      title,
      subject,
      batch: targetBatch,
      activeUsers: [{ user: req.user.id, name: req.user.name, joinedAt: new Date() }],
      tasks: [],
      createdBy: req.user.id
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`batch:${targetBatch}`).emit('studypod:created', { podId: pod._id, title: pod.title });
    }

    return success(res, { pod }, 'تم إنشاء غرفة المذاكرة بنجاح', 201);
  } catch (err) {
    return serverError(res, err);
  }
});

// الانضمام لغرفة المذاكرة
router.post('/:id/join', auth, async (req, res) => {
  try {
    const pod = await loadPodForUser(req, res);
    if (!pod) return;
    await pod.populate('subject', 'name');
    await pod.populate('createdBy', 'name');

    const alreadyJoined = pod.activeUsers.some(u => String(u.user) === String(req.user.id));
    if (!alreadyJoined) {
      pod.activeUsers.push({ user: req.user.id, name: req.user.name, joinedAt: new Date() });
      await pod.save();
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`pod:${pod._id}`).emit('studypod:user-joined', { userId: req.user.id, name: req.user.name });
    }

    return success(res, { pod });
  } catch (err) {
    return serverError(res, err);
  }
});

// مغادرة غرفة المذاكرة — يُزيل المستخدم من activeUsers على الخادم
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const pod = await loadPodForUser(req, res);
    if (!pod) return;

    pod.activeUsers = pod.activeUsers.filter(u => String(u.user) !== String(req.user.id));
    await pod.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`pod:${pod._id}`).emit('studypod:user-left', { userId: req.user.id, name: req.user.name });
    }

    return success(res, null, 'تمت المغادرة بنجاح');
  } catch (err) {
    return serverError(res, err);
  }
});

// حذف غرفة المذاكرة — منشئها أو العميد/الأدمن فقط
router.delete('/:id', auth, async (req, res) => {
  try {
    const pod = await loadPodForUser(req, res);
    if (!pod) return;

    const isCreator = String(pod.createdBy) === String(req.user.id);
    if (!isAdmin(req.user) && !isCreator) {
      return fail(res, 'لا تملك صلاحية حذف هذه الغرفة', 403);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`pod:${pod._id}`).emit('studypod:deleted', { podId: pod._id });
    }

    await pod.deleteOne();
    return success(res, null, 'تم حذف غرفة المذاكرة');
  } catch (err) {
    return serverError(res, err);
  }
});

// إضافة مهمة دراسية مشتركة
router.post('/:id/tasks', auth, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) return fail(res, 'عنوان المهمة مطلوب');

    const pod = await loadPodForUser(req, res);
    if (!pod) return;

    // سقف يمنع تضخّم المستند بمهام لا نهائية
    if (pod.tasks.length >= 200) {
      return fail(res, 'بلغت الغرفة الحد الأقصى للمهام (200)');
    }

    const task = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim(),
      completed: false,
      completedBy: null
    };

    pod.tasks.push(task);
    await pod.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`pod:${pod._id}`).emit('studypod:task-added', { task });
    }

    return success(res, { task });
  } catch (err) {
    return serverError(res, err);
  }
});

// تبديل حالة إنجاز المهمة المشتركة
router.put('/:id/tasks/:taskId', auth, async (req, res) => {
  try {
    const pod = await loadPodForUser(req, res);
    if (!pod) return;

    const task = pod.tasks.find(t => t.id === req.params.taskId);
    if (!task) return notFound(res, 'المهمة غير موجودة');

    task.completed = !task.completed;
    task.completedBy = task.completed ? req.user.name : null;
    await pod.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`pod:${pod._id}`).emit('studypod:task-toggled', { taskId: task.id, completed: task.completed, by: task.completedBy });
    }

    return success(res, { task });
  } catch (err) {
    return serverError(res, err);
  }
});

// تحديث ومزامنة مؤقت بومودورو
router.post('/:id/timer', auth, async (req, res) => {
  try {
    const { status, remainingSeconds } = req.body;
    const pod = await loadPodForUser(req, res);
    if (!pod) return;

    pod.timerState = {
      status: status || 'running',
      remainingSeconds: remainingSeconds || 1500,
      startedAt: new Date()
    };
    await pod.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`pod:${pod._id}`).emit('studypod:timer-sync', pod.timerState);
    }

    return success(res, { timerState: pod.timerState });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
