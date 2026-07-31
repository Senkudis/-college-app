const express = require("express");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");
const http = require("http");
const { Server: SocketServer } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
require("dotenv").config();

const connectDB = require("./config/db");
const Notification = require("./models/Notification");
const User = require("./models/User");
const { apiLimiter, authLimiter, passwordResetLimiter, uploadLimiter } = require("./middleware/rateLimiter");
const requestId = require("./middleware/requestId");

const app = express();
app.set('trust proxy', 1); // Required for express-rate-limit behind cPanel/Litespeed proxy
const httpServer = http.createServer(app);

// ===== Security & Performance Middleware =====
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      mediaSrc: ["'self'", "blob:"],
      workerSrc: ["'self'", "blob:"],
      frameAncestors: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hidePoweredBy: true,
  noSniff: true,
  xssFilter: true,
  frameguard: { action: "sameorigin" }
}));

app.use(compression());
// app.use(hpp()); // Prevent HTTP Parameter Pollution (Incompatible with Express 5 req.query getter)
app.use(requestId);

// ===== Socket.io Setup =====
const io = new SocketServer(httpServer, {
  cors: { 
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
      // Same-origin requests do not need CORS.  In production, an empty
      // allow-list must not silently permit every website to use the API.
      if ((process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0) || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

app.set('io', io);

// Socket.io JWT Authentication
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id} — user: ${socket.user?.email}`);

  socket.on('join:user', (userId) => {
    // A client may only subscribe to its own private notification room.
    if (String(userId) === String(socket.user.id)) {
      socket.join(`user:${userId}`);
    }
  });

  socket.on('join:batch', async (batchId) => {
    try {
      const roles = socket.user?.roles || [];
      let allowed = roles.includes('dean');
      if (!allowed && (roles.includes('student') || roles.includes('leader'))) {
        const user = await User.findById(socket.user.id).select('batch').lean();
        allowed = Boolean(user?.batch && String(user.batch) === String(batchId));
      }
      if (!allowed && roles.includes('doctor')) {
        const user = await User.findById(socket.user.id).select('batches').lean();
        allowed = Boolean(user?.batches?.some(batch => String(batch) === String(batchId)));
      }
      if (allowed) socket.join(`batch:${batchId}`);
    } catch (err) {
      console.warn('[Socket] Failed to authorize batch room:', err.message);
    }
  });

  socket.on('disconnect', () => {
    // console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

// ===== Core Middleware =====
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if ((process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0) || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Secure cookie settings
app.use((req, res, next) => {
  // Ensure cookies are secure in production
  if (process.env.NODE_ENV === 'production') {
    res.cookie = function(name, value, options = {}) {
      options.secure = true;
      options.httpOnly = true;
      options.sameSite = 'strict';
      return express.response.cookie.call(this, name, value, options);
    };
  }
  next();
});

// حماية ضد هجمات حقن قواعد البيانات (NoSQL Injection)
const mongoSanitize = require("express-mongo-sanitize");
app.use((req, res, next) => {
  if (req.body) mongoSanitize.sanitize(req.body);
  if (req.params) mongoSanitize.sanitize(req.params);
  if (req.headers) mongoSanitize.sanitize(req.headers);
  if (req.query) mongoSanitize.sanitize(req.query); // يُعقّم الكائن مباشرة دون إعادة تعيينه لتفادي خطأ Express 5
  next();
});

// حماية ضد هجمات الـ XSS
// const xss = require("xss-clean");
// app.use(xss()); // Incompatible with Express 5 req.query getter

// ===== Rate Limiting =====
app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', passwordResetLimiter);
app.use('/api/auth/verify-reset-code', passwordResetLimiter);
app.use('/api/auth/reset-password', passwordResetLimiter);
app.use('/api/videos/init-upload', uploadLimiter);

// ===== Static Files =====
// الملفات المرفوعة من المستخدمين: أي صيغة قابلة للتنفيذ في المتصفح (html/svg/js...)
// تُنزَّل كمرفق ولا تُعرض من نفس النطاق — لمنع سرقة الجلسات عبر Stored XSS
const INLINE_SAFE_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.ico',
  '.mp4', '.mp3', '.wav', '.webm', '.mov', '.m4a', '.aac', '.ogg',
  '.pdf', '.txt'
]);
const uploadsStaticOptions = {
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = res.req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (!INLINE_SAFE_EXT.has(path.extname(filePath).toLowerCase())) {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Content-Type', 'application/octet-stream');
    }
  }
};
app.use('/uploads/lectures', express.static(path.join(__dirname, 'uploads/lectures'), uploadsStaticOptions));
app.use('/uploads/assignments', express.static(path.join(__dirname, 'uploads/assignments'), uploadsStaticOptions));
app.use('/uploads/submissions', express.static(path.join(__dirname, 'uploads/submissions'), uploadsStaticOptions));
app.use('/uploads/references', express.static(path.join(__dirname, 'uploads/references'), uploadsStaticOptions));
app.use('/uploads/misc', express.static(path.join(__dirname, 'uploads/misc'), uploadsStaticOptions));
app.use("/uploads", express.static(path.join(__dirname, "uploads"), uploadsStaticOptions));

// Fallback search inside subdirectories if file is requested directly under /uploads/
const fs = require('fs');
app.use("/uploads", (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const filename = path.basename(req.path);
  if (!filename) return next();
  const subdirs = ['lectures', 'assignments', 'submissions', 'references', 'misc'];
  
  for (const sub of subdirs) {
    const fullPath = path.join(__dirname, 'uploads', sub, filename);
    if (fs.existsSync(fullPath)) {
      return res.sendFile(fullPath, uploadsStaticOptions);
    }
  }
  next();
});
// ملف الـ Service Worker يجب ألا يُخزَّن مؤقتاً، وإلا بقي المستخدمون على نسخة
// قديمة منه (ومعها أخطاؤها) حتى بعد النشر. المتصفح يعيد التحقق منه في كل مرة.
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'www', 'sw.js'));
});

app.use(express.static(path.join(__dirname, "www")));

// ===== Health Check =====
app.get("/health", (req, res) => {
  res.json({ 
    success: true, 
    status: "ok", 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    requestId: req.id
  });
});

// ===== API Routes =====
app.use("/api/auth", require("./routes/auth.routes.js"));
app.use("/api/users", require("./routes/user.routes.js"));
app.get("/api/verify-token", require("./middleware/auth.middleware"), (req, res) => {
  res.json({ success: true, user: req.user });
});
app.use("/api/subjects", require("./routes/subject.routes.js"));
app.use("/api/lectures", require("./routes/lecture.routes.js"));
app.use("/api/notifications", require("./routes/notification.routes.js"));
app.use("/api/references", require("./routes/reference.routes.js"));
app.use("/api/assignments", require("./routes/assignment.routes.js"));
app.use("/api/submissions", require("./routes/submission.routes.js"));
app.use("/api/attendance", require("./routes/attendance.routes"));
app.use("/api/batches", require("./routes/batch.routes"));
app.use("/api/videos", require("./routes/video.routes"));
app.use("/api/videos", require("./routes/comment.routes"));
app.use("/api/device", require("./routes/device.routes"));
app.use("/api/academic-events", require("./routes/academic-event.routes"));
app.use("/api/campus", require("./routes/campus.routes"));
app.use("/api/quizzes", require("./routes/quiz.routes"));
app.use("/api/reports", require("./routes/report.routes"));
app.use("/api/settings", require("./routes/settings.routes.js"));
app.use("/api/student", require("./routes/student.routes.js"));
app.use("/api/leaderboard", require("./routes/leaderboard.routes.js"));
app.use("/api/calendar",   require("./routes/calendar.routes.js"));
app.use("/api/search",     require("./routes/search.routes.js"));
app.use("/api/financials", require("./routes/financial.routes.js"));
app.use("/api/public",     require("./routes/public.routes.js"));        // صفحة الاستقبال - بدون مصادقة
app.use("/api/admin/public", require("./routes/public-admin.routes.js")); // إدارة المحتوى - أدمن فقط
app.use("/api/ai",         require("./routes/ai.routes.js"));             // مساعد الدراسة بالذكاء الاصطناعي

// ===== API Documentation =====
app.get("/api", (req, res) => {
  res.json({
    success: true,
    app: "نظام إدارة كلية تقنية المعلومات - جامعة النصر التقنية",
    version: "1.4.0",
    auth: {
      register: "POST /api/auth/register (dean only)",
      login: "POST /api/auth/login",
      "forgot-password": "POST /api/auth/forgot-password",
      "verify-reset-code": "POST /api/auth/verify-reset-code",
      "reset-password": "POST /api/auth/reset-password",
      "change-password": "POST /api/auth/change-password",
      "force-change-password": "POST /api/auth/force-change-password",
    },
    users: {
      list: "GET /api/users?page=1&limit=30 (dean only)",
      get: "GET /api/users/:id (dean only)",
      create: "POST /api/users (dean only)",
      update: "PUT /api/users/:id (dean only)",
      delete: "DELETE /api/users/:id (dean only)",
      "reset-password": "POST /api/users/:id/reset-password (dean only)"
    },
    subjects: {
      list: "GET /api/subjects",
      get: "GET /api/subjects/:id",
      create: "POST /api/subjects (dean/doctor)",
      update: "PUT /api/subjects/:id (dean/doctor)",
      delete: "DELETE /api/subjects/:id (dean/doctor)"
    },
    lectures: {
      list: "GET /api/lectures",
      bySubject: "GET /api/lectures/by-subject/:subjectId",
      create: "POST /api/lectures (dean/doctor/leader)",
      delete: "DELETE /api/lectures/:id (dean/doctor/leader)"
    },
    assignments: {
      byType: "GET /api/assignments/type/:type",
      bySubject: "GET /api/assignments/by-subject/:subjectId/:type",
      create: "POST /api/assignments (dean/doctor/leader)",
      delete: "DELETE /api/assignments/:id (dean/doctor/leader)"
    },
    submissions: {
      submit: "POST /api/submissions/submit (student)",
      mySubmissions: "GET /api/submissions/my-submissions (student)",
      byAssignment: "GET /api/submissions/assignment/:assignmentId/submissions",
      grade: "PUT /api/submissions/:id/grade (dean/doctor/leader)"
    },
    attendance: {
      students: "GET /api/attendance/students",
      record: "POST /api/attendance",
      history: "GET /api/attendance/history",
      get: "GET /api/attendance/:id"
    },
    batches: {
      list: "GET /api/batches",
      get: "GET /api/batches/:id",
      create: "POST /api/batches (dean/leader)",
      update: "PUT /api/batches/:id (dean/leader)",
      delete: "DELETE /api/batches/:id (dean)"
    },
    notifications: {
      list: "GET /api/notifications?page=1&limit=20",
      create: "POST /api/notifications (dean/doctor/leader)",
      "unread-count": "GET /api/notifications/unread-count",
      "read": "POST /api/notifications/read/:id",
      "read-all": "POST /api/notifications/read-all"
    },
    financials: {
      fees: "POST /api/financials/fees (dean only)",
      payments: "POST /api/financials/payments (dean only)",
      balance: "GET /api/financials/balance/:studentId (dean or specific student)"
    },
    videos: {
      library: "GET /api/videos",
      bySubject: "GET /api/videos/by-subject/:subjectId",
      get: "GET /api/videos/:id",
      stream: "GET /api/videos/:id/stream/:variant",
      download: "GET /api/videos/:id/download/:variant",
      initUpload: "POST /api/videos/init-upload (dean/doctor/leader)"
    }
  });
});

// ===== Root =====
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.sendFile(path.join(__dirname, "www", "login.html")); 
});

// ===== Database =====
connectDB();

// ===== Cron Jobs =====

// 1. تنظيف الإشعارات القديمة يومياً عند منتصف الليل
cron.schedule("0 0 * * *", async () => {
  try {
    const result = await Notification.cleanupOldNotifications(30);
    if (result.deletedCount > 0) {
      console.log(`🧹 تم حذف ${result.deletedCount} إشعار قديم`);
    }
  } catch (err) {
    console.error("❌ فشل تنظيف الإشعارات:", err.message);
  }
});

// 2. إشعار تلقائي للطلاب ذوي الرسوم المتأخرة (يومياً الساعة 9 صباحاً)
cron.schedule("0 9 * * *", async () => {
  try {
    const Fee = require("./models/Fee");
    const now = new Date();
    const overdueFees = await Fee.find({
      dueDate: { $lt: now },
      status: { $ne: "paid" }
    }).populate("student", "_id name").lean();

    if (overdueFees.length === 0) return;

    // تجميع الطلاب الفريدين
    const studentMap = new Map();
    for (const fee of overdueFees) {
      if (fee.student?._id) {
        const sid = fee.student._id.toString();
        if (!studentMap.has(sid)) {
          studentMap.set(sid, { student: fee.student, totalDue: 0 });
        }
        const remaining = Math.max(0, fee.amount - (fee.discount || 0) - fee.paidAmount);
        studentMap.get(sid).totalDue += remaining;
      }
    }

    const io = app.get('io');
    let notifiedCount = 0;

    for (const [studentId, data] of studentMap) {
      try {
        // حفظ إشعار في قاعدة البيانات
        const notif = await Notification.create({
          title: "⚠️ تذكير: رسوم دراسية مستحقة",
          message: `لديك رسوم دراسية متأخرة بقيمة إجمالية ${data.totalDue.toFixed(2)} ج.س. يرجى التسوية في أقرب وقت ممكن.`,
          type: "normal",
          target: "custom",
          recipients: [studentId],
          createdBy: null
        });
        // إرسال فوري عبر Socket.io
        if (io) {
          io.to(`user:${studentId}`).emit('notification:new', {
            _id: notif._id,
            title: notif.title,
            message: notif.message,
            type: notif.type,
            createdAt: notif.createdAt
          });
        }
        notifiedCount++;
      } catch { /* تجاهل أخطاء الإشعار الفردية */ }
    }

    if (notifiedCount > 0) {
      console.log(`💳 تم إرسال تذكير رسوم لـ ${notifiedCount} طالب`);
    }
  } catch (err) {
    console.error("❌ فشل إرسال تذكيرات الرسوم:", err.message);
  }
});

// ===== Error Handling =====
app.use((req, res, next) => {
  if (req.accepts('html')) {
    return res.status(404).sendFile(path.join(__dirname, "www", "404.html"));
  }
  res.status(404).json({ 
    success: false, 
    message: "المسار غير موجود",
    requestId: req.id
  });
});

app.use((err, req, res, next) => {
  console.error(`[Error] ${req.id}:`, err.stack || err.message);

  if (err && (err.name === 'MulterError' || err instanceof require('multer').MulterError)) {
    let msg = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') msg = 'حجم الملف كبير جداً. الحد الأقصى المسموح به هو 500 ميجابايت';
    else if (err.code === 'LIMIT_FILE_COUNT') msg = 'عدد الملفات المرفوعة يتجاوز الحد المسموح به';
    else if (err.code === 'LIMIT_UNEXPECTED_FILE') msg = 'حقل الملف المرفوع غير متوقع أو غير صحيح';
    return res.status(400).json({ success: false, message: msg, requestId: req.id });
  }

  // Mongoose Errors
  if (err && err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'معرف غير صالح أو بيانات خاطئة', requestId: req.id });
  }
  if (err && err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    return res.status(400).json({ success: false, message: messages.join(', '), requestId: req.id });
  }
  if (err && err.code === 11000) {
    return res.status(400).json({ success: false, message: 'يوجد سجل مكرر بهذه البيانات مسبقاً', requestId: req.id });
  }

  if (err && err.message && (err.message.includes('نوع الملف غير مسموح') || err.message.includes('file extension') || err.message.includes('mimetype'))) {
    return res.status(400).json({ success: false, message: 'نوع الملف أو صيغته غير مسموحة بالرفع', requestId: req.id });
  }

  if (req.accepts('html')) {
    return res.status(err.status || 500).send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head><meta charset="UTF-8"><title>خطأ في الخادم</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:50px;">
        <h2>عذراً، حدث خطأ في الخادم (500)</h2>
        <p>${process.env.NODE_ENV === 'production' ? 'يرجى المحاولة لاحقاً.' : err.message}</p>
      </body>
      </html>
    `);
  }
  res.status(err.status || 500).json({ 
    success: false, 
    message: process.env.NODE_ENV === 'production' && !err.status ? "حدث خطأ في الخادم" : err.message,
    requestId: req.id
  });
});

// ===== Start Server =====
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ===== Global Error Handlers (Anti-Crash) =====
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
  // Do not crash the server for unhandled rejections
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err);
  // Optional: graceful shutdown logic here if needed
  // process.exit(1); 
});

module.exports = app;
