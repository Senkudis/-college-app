const mongoose = require("mongoose");

async function createIndexes() {
  const indexes = [
    // Quiz indexes
    { model: 'Quiz', index: { batch: 1, published: 1, startsAt: 1 } },
    { model: 'Quiz', index: { subject: 1, batch: 1 } },
    
    // Fee indexes
    { model: 'Fee', index: { student: 1, status: 1 } },
    { model: 'Fee', index: { batch: 1, status: 1 } },
    { model: 'Fee', index: { dueDate: 1, status: 1 } },
    
    // Payment indexes
    { model: 'Payment', index: { student: 1, paymentDate: -1 } },
    { model: 'Payment', index: { reference: 1 }, options: { unique: true } },
    
    // User indexes
    { model: 'User', index: { email: 1 }, options: { unique: true } },
    { model: 'User', index: { batch: 1 } },
    { model: 'User', index: { roles: 1 } },
    { model: 'User', index: { deletedAt: 1 } },
    
    // Notification indexes
    { model: 'Notification', index: { type: 1, createdAt: -1 } },
    { model: 'Notification', index: { createdBy: 1, createdAt: -1 } },
    { model: 'Notification', index: { readBy: 1 } },
    { model: 'Notification', index: { recipients: 1 } },
    { model: 'Notification', index: { batches: 1 } },
    { model: 'Notification', index: { createdAt: 1 }, options: { expireAfterSeconds: 30 * 24 * 60 * 60 } }, // TTL 30 days
    
    // Assignment indexes
    { model: 'Assignment', index: { subject: 1, batches: 1 } },
    { model: 'Assignment', index: { addedBy: 1 } },
    { model: 'Assignment', index: { dueDate: 1 } },
    
    // Submission indexes
    { model: 'StudentSubmission', index: { assignment: 1, student: 1 }, options: { unique: true } },
    { model: 'StudentSubmission', index: { student: 1, status: 1 } },
    { model: 'StudentSubmission', index: { assignment: 1, status: 1 } },
    
    // Video indexes
    { model: 'Video', index: { subject: 1, createdAt: -1 } },
    { model: 'Video', index: { status: 1 } },
    { model: 'Video', index: { batches: 1 } },
    { model: 'Video', index: { uploadId: 1 }, options: { unique: true } },
    
    // Lecture indexes
    { model: 'Lecture', index: { subject: 1, createdAt: -1 } },
    { model: 'Lecture', index: { uploadedBy: 1 } },
    
    // Attendance indexes
    { model: 'Attendance', index: { subject: 1, date: 1, recordedBy: 1 }, options: { unique: true } },
    { model: 'Attendance', index: { recordedBy: 1 } },
    
    // AcademicEvent indexes
    { model: 'AcademicEvent', index: { batch: 1, startsAt: 1 } },
    { model: 'AcademicEvent', index: { subject: 1 } },
    
    // Reference indexes
    { model: 'Reference', index: { subject: 1 } },
    
    // ActivityLog indexes
    { model: 'ActivityLog', index: { user: 1, createdAt: -1 } },
    { model: 'ActivityLog', index: { batch: 1, action: 1 } },
    
    // QuizAttempt indexes
    { model: 'QuizAttempt', index: { quiz: 1, student: 1 }, options: { unique: true } },
    { model: 'QuizAttempt', index: { student: 1 } },
    
    // Batch indexes
    { model: 'Batch', index: { code: 1 }, options: { unique: true } },
    { model: 'Batch', index: { status: 1 } },
    
    // Subject indexes
    { model: 'Subject', index: { doctor: 1 } },
    { model: 'Subject', index: { batches: 1 } },
    { model: 'Subject', index: { level: 1 } }
  ];

  // تحميل جميع النماذج مسبقاً لتجنب تحذير Schema hasn't been registered
  for (const { model, index, options } of indexes) {
    try {
      if (!mongoose.models[model]) {
        try { require(`../models/${model}`); } catch (e) {}
      }
      if (mongoose.models[model]) {
        const Model = mongoose.model(model);
        await Model.collection.createIndex(index, options);
        console.log(`✅ Index created: ${model} ${JSON.stringify(index)}`);
      }
    } catch (err) {
      if (err.code !== 85 && err.code !== 86) { // Ignore IndexOptionsConflict and IndexKeySpecsConflict
        console.warn(`⚠️ Index warning ${model}:`, err.message);
      }
    }
  }
}

async function connectDB() {
  if (process.env.NODE_ENV === "test") {
    console.log("ℹ️ Skipping MongoDB connection check in test mode");
    return;
  }
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI غير موجود في متغيرات البيئة");
    process.exit(1);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const options = {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 30000,
    tls: true,
    // tlsInsecure فقط في بيئة التطوير لتجنب مشاكل الشهادات المحلية
    // في الإنتاج يجب التحقق الكامل من الشهادة
    tlsInsecure: !isProduction,
    family: 4
  };

  /* mongoose يعيد الاتصال تلقائياً بعد نجاح أول اتصال، لكنه لا يعيد المحاولة
     إذا فشلت المحاولة الأولى. كان الكود ينفّذ process.exit(1) هناك، فأي
     انقطاع شبكة لحظي وقت الإقلاع (أو تأخر DNS) يُسقط الخادم كلياً — ولو لم
     يكن خلف مدير عمليات يعيد تشغيله، يبقى الموقع متوقفاً حتى تدخّل يدوي.
     الآن نعيد المحاولة بتباعد متزايد ولا نُنهي العملية أبداً. */
  let attempt = 0;
  const MAX_DELAY_MS = 60_000;

  const tryConnect = async () => {
    attempt++;
    try {
      await mongoose.connect(uri, options);
      console.log(`✅ DB Connected${attempt > 1 ? ` (بعد ${attempt} محاولات)` : ''}`);
      attempt = 0;
      await createIndexes();
    } catch (err) {
      // تباعد أسّي بحد أقصى دقيقة: 2، 4، 8، 16، 32، 60، 60...
      const delay = Math.min(2 ** attempt * 1000, MAX_DELAY_MS);
      console.error(`❌ فشل الاتصال بقاعدة البيانات (محاولة ${attempt}): ${err.message}`);
      console.error(`   إعادة المحاولة بعد ${Math.round(delay / 1000)} ثانية...`);
      setTimeout(tryConnect, delay).unref?.();
    }
  };

  // لا ننتظر نجاح الاتصال حتى لا يتعطل إقلاع الخادم؛ الطلبات التي تحتاج
  // القاعدة سترد بخطأ واضح حتى يكتمل الاتصال، وصفحات الواجهة تُخدم فوراً.
  tryConnect();
}

/* حالة الاتصال — يستخدمها فحص الصحة ليعكس الواقع بدل ادعاء السلامة دائماً */
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = connectDB;
module.exports.isDbConnected = isDbConnected;