const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const firstError = errors.array()[0];
    return res.status(400).json({
      success: false,
      message: firstError.msg,
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

// Common validation rules
const commonRules = {
  email: body('email').isEmail().normalizeEmail().withMessage('بريد إلكتروني غير صحيح'),
  password: body('password').isLength({ min: 6 }).withMessage('كلمة المرور 6 أحرف على الأقل'),
  name: body('name').trim().isLength({ min: 2, max: 100 }).withMessage('الاسم 2-100 حرف'),
  objectId: (field) => param(field).isMongoId().withMessage(`معرف ${field} غير صالح`),
  objectIdBody: (field) => body(field).isMongoId().withMessage(`معرف ${field} غير صالح`),
  positiveNumber: (field) => body(field).isFloat({ min: 0 }).withMessage(`${field} يجب أن يكون رقم موجب`),
  positiveInt: (field) => body(field).isInt({ min: 1 }).withMessage(`${field} يجب أن يكون عدد صحيح موجب`),
  date: (field) => body(field).isISO8601().withMessage(`${field} تاريخ غير صالح`),
  optionalString: (field, max = 500) => body(field).optional().trim().isLength({ max }).withMessage(`${field} طويل جداً`),
  enum: (field, values) => body(field).isIn(values).withMessage(`${field} يجب أن يكون أحد: ${values.join(', ')}`),
  roleArray: body('roles').isArray({ min: 1 }).withMessage('الأدوار مطلوبة')
    .custom((val) => {
      const valid = ['student', 'leader', 'doctor', 'dean', 'admin'];
      if (!val.every(r => valid.includes(r))) throw new Error('أدوار غير صحيحة');
      return true;
    })
};

const authValidation = {
  login: [
    commonRules.email,
    commonRules.password
  ],
  register: [
    commonRules.name,
    commonRules.email,
    commonRules.password,
    commonRules.roleArray
  ],
  forgotPassword: [
    commonRules.email
  ],
  verifyResetCode: [
    commonRules.email,
    body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('كود 6 أرقام مطلوب')
  ],
  resetPassword: [
    body('tempToken').notEmpty().withMessage('رمز مؤقت مطلوب'),
    body('newPassword').isLength({ min: 6 }).withMessage('كلمة المرور 6 أحرف على الأقل'),
    body('confirmPassword').custom((val, { req }) => val === req.body.newPassword).withMessage('كلمتا المرور غير متطابقتين')
  ],
  changePassword: [
    body('currentPassword').notEmpty().withMessage('كلمة المرور الحالية مطلوبة'),
    body('newPassword').isLength({ min: 6 }).withMessage('كلمة المرور الجديدة 6 أحرف على الأقل'),
    body('confirmPassword').custom((val, { req }) => val === req.body.newPassword).withMessage('كلمتا المرور غير متطابقتين')
  ],
  forceChangePassword: [
    body('currentPassword').notEmpty().withMessage('كلمة المرور الحالية مطلوبة'),
    body('newPassword').isLength({ min: 6 }).withMessage('كلمة المرور الجديدة 6 أحرف على الأقل'),
    body('confirmPassword').custom((val, { req }) => val === req.body.newPassword).withMessage('كلمتا المرور غير متطابقتين')
  ]
};

const subjectValidation = {
  create: [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('اسم المادة 2-100 حرف'),
    body('level').trim().notEmpty().withMessage('المستوى مطلوب'),
    body('doctor').optional().isMongoId().withMessage('معرف الدكتور غير صالح')
  ],
  update: [
    body('name').optional().trim().isLength({ min: 2, max: 100 }).withMessage('اسم المادة 2-100 حرف'),
    body('level').optional().trim().notEmpty().withMessage('المستوى مطلوب')
  ]
};

const assignmentValidation = {
  create: [
    body('title').trim().isLength({ min: 3, max: 150 }).withMessage('العنوان 3-150 حرف'),
    body('type').isIn(['exercise', 'research', 'project']).withMessage('نوع غير صالح'),
    body('subject').isMongoId().withMessage('مادة غير صالحة'),
    body('dueDate').isISO8601().withMessage('تاريخ التسليم غير صالح'),
    body('dueTime').optional().matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('صيغة الوقت HH:mm')
  ],
  update: [
    body('title').optional().trim().isLength({ min: 3, max: 150 }),
    body('description').optional().trim().isLength({ max: 2000 }),
    body('dueDate').optional().isISO8601(),
    body('dueTime').optional().matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  ]
};

const videoValidation = {
  initUpload: [
    body('title').trim().isLength({ min: 3, max: 150 }),
    body('subject').isMongoId(),
    body('fileName').trim().notEmpty(),
    body('fileSize').isInt({ min: 1, max: 2 * 1024 * 1024 * 1024 }),
    body('totalChunks').isInt({ min: 1, max: 10000 }),
    body('batches').optional().isArray(),
    body('batches.*').optional().isMongoId()
  ]
};

const financialValidation = {
  createFee: [
    body('title').trim().isLength({ min: 3, max: 100 }),
    body('amount').isFloat({ min: 0 }),
    body('dueDate').isISO8601(),
    body('studentId').optional().isMongoId(),
    body('batchId').optional().isMongoId(),
    body().custom((val, { req }) => req.body.studentId || req.body.batchId).withMessage('يجب تحديد الطالب أو الدفعة')
  ],
  createPayment: [
    body('studentId').isMongoId(),
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').isIn(['cash', 'bank_transfer', 'card', 'deposit']),
    body('reference').trim().notEmpty(),
    body('notes').optional().trim().isLength({ max: 500 })
  ]
};

module.exports = {
  handleValidationErrors,
  commonRules,
  authValidation,
  subjectValidation,
  assignmentValidation,
  videoValidation,
  financialValidation
};