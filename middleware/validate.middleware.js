/**
 * validate.middleware.js
 * دوال مساعدة للتحقق من صحة المدخلات
 */

// التحقق من وجود حقول مطلوبة
function requiredFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter(f => {
      const val = req.body[f];
      return val === undefined || val === null || val === '';
    });
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `الحقول التالية مطلوبة: ${missing.join('، ')}`
      });
    }
    next();
  };
}

// التحقق من صحة البريد الإلكتروني
function validEmail(field = 'email') {
  return (req, res, next) => {
    const val = req.body[field];
    if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      return res.status(400).json({
        success: false,
        message: 'صيغة البريد الإلكتروني غير صحيحة'
      });
    }
    next();
  };
}

// التحقق من طول كلمة المرور
function minLength(field, min, label) {
  return (req, res, next) => {
    const val = req.body[field];
    if (val && val.length < min) {
      return res.status(400).json({
        success: false,
        message: `${label} يجب أن يكون ${min} أحرف على الأقل`
      });
    }
    next();
  };
}

// التحقق من ObjectId صالح
function validObjectId(paramName) {
  return (req, res, next) => {
    const mongoose = require('mongoose');
    const id = req.params[paramName];
    if (id && !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: `معرف غير صالح: ${paramName}`
      });
    }
    next();
  };
}

module.exports = { requiredFields, validEmail, minLength, validObjectId };
