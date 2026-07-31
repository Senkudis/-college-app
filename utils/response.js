/**
 * response.js
 * دوال مساعدة لتوحيد شكل استجابة API
 */

function success(res, data = null, message = 'تم بنجاح', status = 200) {
  const body = { success: true, message };
  if (data) body.data = data;
  return res.status(status).json(body);
}

function fail(res, message = 'حدث خطأ', status = 400, extra = {}) {
  return res.status(status).json({ success: false, message, ...extra });
}

function notFound(res, msg = 'المورد غير موجود') {
  return res.status(404).json({ success: false, message: msg });
}

function serverError(res, err, logLabel = '') {
  // نسجّل التفاصيل الكاملة على الخادم دائماً لتسهيل التشخيص
  if (logLabel) console.error(`${logLabel}:`, err?.stack || err?.message || err);

  // أخطاء التحقق من Mongoose سببها إدخال المستخدم — نُرجِعها كـ 400 برسالة واضحة
  // (رسائلها معرّفة في المخططات وآمنة للعرض، وليست 500 غامضة)
  if (err && err.name === 'ValidationError') {
    const msg = Object.values(err.errors || {}).map(e => e.message).join(' • ') || 'بيانات غير صالحة';
    return res.status(400).json({ success: false, message: msg });
  }
  if (err && err.name === 'CastError') {
    return res.status(400).json({ success: false, message: `قيمة غير صالحة للحقل «${err.path}»` });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ success: false, message: 'القيمة موجودة مسبقاً' });
  }

  return res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
}

/**
 * دالة مساعدة للـ pagination
 * @param {Model} Model - نموذج Mongoose
 * @param {Object} filter - شرط البحث
 * @param {Object} options - خيارات (page, limit, sort, select, populate)
 * @returns {Object} { data, pagination }
 */
async function paginated(Model, filter = {}, options = {}) {
  let { page = 1, limit = 20, sort = { createdAt: -1 }, select = null, populate = null } = options;
  page = Math.max(1, parseInt(page) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip = (page - 1) * limit;

  let query = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (select) query = query.select(select);
  if (populate) query = query.populate(populate);

  const [docs, total] = await Promise.all([
    query.exec(),
    Model.countDocuments(filter)
  ]);

  return {
    data: docs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasMore: page * limit < total
    }
  };
}

module.exports = { success, fail, notFound, serverError, paginated };

