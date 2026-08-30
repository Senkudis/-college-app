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
const { log, recordRequest, snapshot } = require("./utils/observability");

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
      // ce.judge0.com يترجم وينفّذ C++ في مختبر البرمجة (لا يوجد مترجم C++ داخل المتصفح)
      connectSrc: ["'self'", "ws:", "wss:", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://ce.judge0.com"],
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
// HPP protection: manually sanitize duplicate query params (express-rate-limit/Express 5 safe alternative)
app.use((req, res, next) => {
  // Keep only the last value of any duplicated query param (prevents HPP attacks)
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      if (Array.isArray(req.query[key])) {
        req.query[key] = req.query[key][req.query[key].length - 1];
      }
    }
  }
  next();
});
app.use(requestId);
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const meta = recordRequest(req, res, durationMs);
    if (meta.status >= 400) log(meta.status >= 500 ? 'error' : 'warn', 'request_completed', { ...meta, requestId: req.id });
  });
  next();
});

/* ===== أصول مسموح بها =====
   الأصول الخاصة بالتطبيق نفسه يجب أن تُقبل دائماً دون الاعتماد على ضبط
   CORS_ORIGIN، لأن نسيانه كان يعطّل WebSocket بالكامل في الإنتاج:
   طلبات polling تُرسل من نفس النطاق فلا يضع المتصفح ترويسة Origin وتنجح،
   بينما مصافحة WebSocket ترسل Origin **دائماً** — فتُرفض بـ400 ويبقى
   الاتصال اللحظي معطلاً مع تكرار الأخطاء في الطرفية.
   أصول localhost هنا ليست ثغرة: هكذا يقدّم Capacitor صفحات التطبيق داخل
   الجهاز (http/https/capacitor://localhost) وليست مواقع على الإنترنت. */
const APP_ORIGINS = [
  'https://elnasrcsit.website',
  'https://www.elnasrcsit.website',
  'http://elnasrcsit.website',
  'http://www.elnasrcsit.website',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost'
];

const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',').map(o => o.trim()).filter(Boolean);

const allowedOriginSet = new Set([...APP_ORIGINS, ...configuredOrigins]);

function isOriginAllowed(origin) {
  // طلبات بلا Origin (تطبيقات أصلية، curl، طلبات من نفس النطاق عبر XHR)
  if (!origin) return true;
  if (allowedOriginSet.has(origin)) return true;
  // أي منفذ على localhost أثناء التطوير
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }
  return false;
}

function corsOriginCallback(origin, callback) {
  if (isOriginAllowed(origin)) return callback(null, true);
  console.warn('[CORS] أصل مرفوض:', origin);
  callback(new Error('Not allowed by CORS'));
}

// ===== Socket.io Setup =====
const io = new SocketServer(httpServer, {
  cors: {
    origin: corsOriginCallback,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 30000,
  pingInterval: 10000,
  connectTimeout: 20000,
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
  console.log(`[Socket] Connected: ${socket.id} â€” user: ${socket.user?.email}`);

  socket.on('join:user', (userId) => {
    // A client may only subscribe to its own private notification room.
    if (String(userId) === String(socket.user.id)) {
      socket.join(`user:${userId}`);
    }
  });

  socket.on('join:batch', async (batchId) => {
    try {
      const roles = socket.user?.roles || [];
      // "admin" يُعامَل معاملة العميد في كل النظام — وكان مفقوداً هنا وحده
      let allowed = roles.includes('dean') || roles.includes('admin');
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

  /* كان الانضمام بلا أي تحقق: معرّف غرفة يكفي للتنصّت على كل أحداث مجموعة
     مذاكرة لا ينتمي إليها المستخدم (المهام والمؤقّت والداخلون). نطبّق نفس
     قيد الدفعة المطبَّق على مسارات REST. */
  socket.on('join:pod', async (podId) => {
    try {
      if (!podId) return;
      const roles = socket.user?.roles || [];
      if (roles.includes('dean') || roles.includes('admin')) {
        return socket.join(`pod:${podId}`);
      }

      const StudyPod = require('./models/StudyPod');
      const pod = await StudyPod.findById(podId).select('batch').lean();
      if (!pod || !pod.batch) return;

      const user = await User.findById(socket.user.id).select('batch batches').lean();
      const mine = roles.includes('doctor')
        ? (user?.batches || []).map(String)
        : (user?.batch ? [String(user.batch)] : []);

      if (mine.includes(String(pod.batch))) socket.join(`pod:${podId}`);
    } catch (err) {
      console.warn('[Socket] Failed to authorize pod room:', err.message);
    }
  });

  socket.on('leave:pod', (podId) => {
    if (podId) socket.leave(`pod:${podId}`);
  });

  socket.on('disconnect', () => {
    // console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

// ===== Core Middleware =====
/* نفس منطق socket.io أعلاه — كان الاثنان مختلفَين: الـAPI يسمح للجميع عند
   خلوّ CORS_ORIGIN بينما socket.io يرفض الجميع، فيعمل الـAPI ويفشل السوكِت. */
app.use(cors({
  origin: corsOriginCallback,
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

/* XSS protection.
   القائمة السابقة كانت قائمة حظر تُزيل <script> و javascript: ومعالجات
   الأحداث *المقتبسة* فقط — والنمط كان يشترط علامات الاقتباس، فيمرّ
   <img src=x onerror=alert(1)> سليماً. كما كانت تُطبَّق على req.body وحده
   دون query أو params.
   الحل الجذري هو ترميز المخرجات عند العرض (الواجهة تستخدم CBS.escapeHTML)،
   وهذه الطبقة دفاع إضافي: نحيّد المحارف البانية للوسوم بدل مطاردة أنماط. */
app.use((req, res, next) => {
  const neutralize = (str) => str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/\bon\w+\s*=/gi, 'data-blocked-handler=');

  function sanitizeXSS(obj, depth = 0) {
    if (depth > 5 || !obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (typeof value === 'string') {
        obj[key] = neutralize(value);
      } else if (value && typeof value === 'object') {
        sanitizeXSS(value, depth + 1);
      }
    }
  }
  if (req.body) sanitizeXSS(req.body);
  if (req.params) sanitizeXSS(req.params);
  /* req.query في Express 5 قارئ فقط — نُعقّم محتواه دون إعادة تعيينه */
  if (req.query) sanitizeXSS(req.query);
  next();
});

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
/* الملفات الخاصة (تسليمات الطلاب وإيصالات السداد) لا تُخدَم للعموم: اسم
   الملف ليس سرّاً، وتخمينه كان يكفي لتنزيل عمل طالب أو صورة تحويل بنكي.
   نطلب توكناً صالحاً قبل تسليمها — والمحتوى الأكاديمي العام يبقى كما هو. */
const authMiddleware = require('./middleware/auth.middleware');
const PRIVATE_UPLOAD_DIRS = ['submissions', 'receipts'];

app.use('/uploads/lectures', express.static(path.join(__dirname, 'uploads/lectures'), uploadsStaticOptions));
app.use('/uploads/assignments', express.static(path.join(__dirname, 'uploads/assignments'), uploadsStaticOptions));
app.use('/uploads/references', express.static(path.join(__dirname, 'uploads/references'), uploadsStaticOptions));
app.use('/uploads/past-exams', express.static(path.join(__dirname, 'uploads/past-exams'), uploadsStaticOptions));
app.use('/uploads/misc', express.static(path.join(__dirname, 'uploads/misc'), uploadsStaticOptions));
app.use('/uploads/submissions', authMiddleware, express.static(path.join(__dirname, 'uploads/submissions'), uploadsStaticOptions));
app.use('/uploads/receipts', authMiddleware, express.static(path.join(__dirname, 'uploads/receipts'), uploadsStaticOptions));

/* الحارس السابق كان مسار /uploads العام المُسجَّل بعد الخاص، فيلتقط
   /uploads/submissions/<ملف> قبل أن يصل إليه أي تحقق. نمنع ذلك صراحة. */
app.use("/uploads", (req, res, next) => {
  const firstSegment = req.path.split('/').filter(Boolean)[0];
  if (PRIVATE_UPLOAD_DIRS.includes(firstSegment)) {
    return res.status(404).end();
  }
  next();
});
app.use("/uploads", express.static(path.join(__dirname, "uploads"), uploadsStaticOptions));

// Fallback search inside subdirectories if file is requested directly under /uploads/
const fs = require('fs');
app.use("/uploads", (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const filename = path.basename(req.path);
  if (!filename) return next();
  /* المجلدات الخاصة مستبعدة هنا: البحث الاحتياطي بالاسم المجرّد كان طريقاً
     جانبياً يتخطى حارس المصادقة أعلاه. */
  const subdirs = ['lectures', 'assignments', 'references', 'past-exams', 'misc'];

  for (const sub of subdirs) {
    const fullPath = path.join(__dirname, 'uploads', sub, filename);
    if (fs.existsSync(fullPath)) {
      /* sendFile لا يعرف الخيار setHeaders — يقبل { headers } فقط. تمريره
         كان يُسقط Content-Disposition: attachment و nosniff بصمت، فيُعرض
         ملف .html أو .svg مرفوع داخل نطاق التطبيق: XSS مخزّن يسرق الجلسات. */
      const inlineSafe = INLINE_SAFE_EXT.has(path.extname(fullPath).toLowerCase());
      return res.sendFile(fullPath, {
        headers: inlineSafe
          ? { 'X-Content-Type-Options': 'nosniff' }
          : {
              'X-Content-Type-Options': 'nosniff',
              'Content-Disposition': 'attachment',
              'Content-Type': 'application/octet-stream'
            }
      });
    }
  }
  next();
});
// ملف الـ Service Worker يجب ألا يُخزَّن مؤقتاً، وإلا بقي المستخدمون على نسخة
// قديمة منه (ومعها أخطاؤها) حتى بعد النشر. المتصفح يعيد التحقق منه في كل مرة.
// ===== Dynamic Open Graph (Social Sharing / WhatsApp Link Previews) =====
const PublicNews = require('./models/PublicNews');
const PublicGallery = require('./models/PublicGallery');
const mongoose = require('mongoose');

function escapeHtmlStr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function serveHtmlWithOg(req, res, pageFile) {
  try {
    const filePath = path.join(__dirname, 'www', pageFile);
    if (!fs.existsSync(filePath)) {
      return res.sendFile(path.join(__dirname, 'www', 'index.html'));
    }

    let html = fs.readFileSync(filePath, 'utf8');

    // Force HTTPS if request is secure or forwarded
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'elnasrcsit.website';
    const currentDomain = `${proto.startsWith('https') ? 'https' : 'http'}://${host}`;
    const domain = (process.env.PUBLIC_DOMAIN || currentDomain).replace(/\/$/, '');

    let title = 'جامعة النصر التقنية | Al-Nasr University';
    let description = 'البوابة الإلكترونية لجامعة النصر التقنية - الأخبار، الإعلانات، المحاضرات، والمحتوى الأكاديمي.';
    let imageUrl = `${domain}/assets/icon-512.png`;
    let canonicalUrl = `${domain}${req.originalUrl}`;
    let imageType = 'image/png';
    let imageWidth = 600;
    let imageHeight = 600;

    // Extract newsId or imageId from query parameters or URL path
    const pathNewsMatch = req.path ? req.path.match(/\/news\/([a-f0-9]{24})/i) : null;
    const pathImgMatch = req.path ? req.path.match(/\/gallery\/([a-f0-9]{24})/i) : null;

    const newsId = req.query.newsId || req.params.newsId || (pathNewsMatch ? pathNewsMatch[1] : null);
    const imageId = req.query.imageId || req.params.imageId || (pathImgMatch ? pathImgMatch[1] : null);

    if (newsId && mongoose.Types.ObjectId.isValid(newsId)) {
      const news = await PublicNews.findById(newsId).lean();
      if (news) {
        title = `${news.title} | جامعة النصر التقنية`;
        if (news.summary) {
          description = news.summary.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
        } else if (news.body) {
          description = news.body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
        }
        if (news.imageUrl) {
          imageUrl = news.imageUrl.startsWith('http') ? news.imageUrl : `${domain}${news.imageUrl.startsWith('/') ? '' : '/'}${news.imageUrl}`;
          imageWidth = 1200;
          imageHeight = 630;
          if (imageUrl.toLowerCase().endsWith('.png')) imageType = 'image/png';
          else if (imageUrl.toLowerCase().endsWith('.jpg') || imageUrl.toLowerCase().endsWith('.jpeg')) imageType = 'image/jpeg';
          else if (imageUrl.toLowerCase().endsWith('.webp')) imageType = 'image/webp';
        }
      }
    } else if (imageId && mongoose.Types.ObjectId.isValid(imageId)) {
      const item = await PublicGallery.findById(imageId).lean();
      if (item) {
        title = item.caption ? `${item.caption.slice(0, 60)} | معرض جامعة النصر` : 'معرض الصور | جامعة النصر التقنية';
        if (item.caption) {
          description = item.caption.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
        } else {
          description = 'صورة مميزة من معرض الأنشطة والمباني بجامعة النصر التقنية.';
        }
        if (item.imageUrl) {
          imageUrl = item.imageUrl.startsWith('http') ? item.imageUrl : `${domain}${item.imageUrl.startsWith('/') ? '' : '/'}${item.imageUrl}`;
          imageWidth = 1200;
          imageHeight = 630;
          if (imageUrl.toLowerCase().endsWith('.png')) imageType = 'image/png';
          else if (imageUrl.toLowerCase().endsWith('.jpg') || imageUrl.toLowerCase().endsWith('.jpeg')) imageType = 'image/jpeg';
          else if (imageUrl.toLowerCase().endsWith('.webp')) imageType = 'image/webp';
        }
      }
    }

    const ogMeta = `
  <!-- Open Graph / WhatsApp Link Previews -->
  <meta property="og:site_name" content="جامعة النصر التقنية">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="ar_SD">
  <meta property="og:url" content="${escapeHtmlStr(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtmlStr(title)}">
  <meta property="og:description" content="${escapeHtmlStr(description)}">
  <meta property="og:image" content="${escapeHtmlStr(imageUrl)}">
  <meta property="og:image:secure_url" content="${escapeHtmlStr(imageUrl)}">
  <meta property="og:image:type" content="${imageType}">
  <meta property="og:image:width" content="${imageWidth}">
  <meta property="og:image:height" content="${imageHeight}">
  <meta property="og:image:alt" content="${escapeHtmlStr(title)}">

  <!-- Twitter Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${escapeHtmlStr(canonicalUrl)}">
  <meta name="twitter:title" content="${escapeHtmlStr(title)}">
  <meta name="twitter:description" content="${escapeHtmlStr(description)}">
  <meta name="twitter:image" content="${escapeHtmlStr(imageUrl)}">
`;

    html = html.replace(/<title>.*?<\/title>/i, `<title>${escapeHtmlStr(title)}</title>${ogMeta}`);

    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
  } catch (err) {
    console.error('[OG Middleware] Error:', err.message);
    res.sendFile(path.join(__dirname, 'www', pageFile));
  }
}

// Custom Routes for Rich Link Previews
app.get(['/', '/index.html'], (req, res, next) => {
  if (req.query.newsId || req.query.imageId) {
    return serveHtmlWithOg(req, res, 'welcome.html');
  }
  serveHtmlWithOg(req, res, 'index.html');
});

app.get(['/welcome.html', '/welcome'], (req, res) => {
  serveHtmlWithOg(req, res, 'welcome.html');
});

app.get('/news/:newsId', (req, res) => {
  serveHtmlWithOg(req, res, 'welcome.html');
});

app.get('/gallery/:imageId', (req, res) => {
  serveHtmlWithOg(req, res, 'welcome.html');
});

/* روابط تطبيق أندرويد (App Links): أندرويد يطلب هذا الملف للتحقق أن
   النطاق يخصّ التطبيق، وبدونه تُفتح روابط الموقع في المتصفح لا في التطبيق.
   نخدمه بمسار صريح لأن express.static يتجاهل الملفات والمجلدات المخفية. */
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  // dotfiles:'allow' ضرورية — الافتراضي في sendFile يرفض أي مسار فيه مجلد مخفي
  res.sendFile(path.join(__dirname, 'www', '.well-known', 'assetlinks.json'), { dotfiles: 'allow' });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'www', 'sw.js'));
});

// System Health Diagnostics API Endpoint
app.get('/api/system/health', (req, res) => {
  const mongoose = require('mongoose');
  const memoryUsage = process.memoryUsage();
  const uptimeSeconds = Math.floor(process.uptime());

  const isDbConnected = mongoose.connection.readyState === 1;

  res.json({
    status: isDbConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
    database: {
      connected: isDbConnected,
      state: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown'
    },
    memory: {
      rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024)
    },
    environment: process.env.NODE_ENV || 'production'
  });
});

app.use(express.static(path.join(__dirname, 'www'), { maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0, setHeaders(res, filePath) { if (path.extname(filePath).toLowerCase() === '.html') res.setHeader('Cache-Control', 'no-cache'); } }));

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
app.use("/api/public",     require("./routes/public.routes.js"));
app.use("/api/admin/public", require("./routes/public-admin.routes.js"));
app.use("/api/past-exams",  require("./routes/past-exam.routes.js"));
app.use("/api/study-pods",  require("./routes/study-pod.routes.js"));
app.use("/api/surveys",     require("./routes/survey.routes.js"));
app.use("/api/ai",         require("./routes/ai.routes.js"));
app.use("/api/admin",      require("./routes/observability.routes.js"));
app.use("/api/moderation", require("./routes/moderation.routes.js"));
app.use("/api/app-version", require("./routes/app-version.routes.js"));

// ===== API Documentation =====
app.get("/api", (req, res) => {
  res.json({
    success: true,
    app: "نظام إدارة كلية النصر التقنية - جامعة النصر التقنية",
    version: "2.1.0",
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
      } catch (notifErr) {
        /* لا نُفشل بقية الطلاب بسبب واحد، لكن نُسجّل السبب: الابتلاع الصامت
           هنا أخفى لأشهرٍ أن كل هذه الإشعارات كانت تُرفض عند التحقق. */
        console.error('[FeeReminder] فشل إشعار الطالب', studentId, '—', notifErr.message);
      }
    }

    if (notifiedCount > 0) {
      console.log(`💳 تم إرسال تذكير رسوم لـ ${notifiedCount} طالب`);
    }
  } catch (err) {
    console.error("❌ فشل إرسال تذكيرات الرسوم:", err.message);
  }
});

// 3. إشعارات كيدي الذكية للتحفيز الأكاديمي وحماية الستريك (Duolingo Style) — يومياً الساعة 5:00 مساءً
cron.schedule("0 17 * * *", async () => {
  try {
    const kedyService = require("./services/kedySmartNotification.service");
    const io = app.get('io');
    const result = await kedyService.evaluateAndSendSmartNudges(io);
    if (result.sent > 0) {
      console.log(`🦉 [Kedy AI] تم إرسال ${result.sent} إشعار تحفيزي ذكي للطلاب بنجاح`);
    }
  } catch (err) {
    console.error("❌ فشل إرسال إشعارات كيدي الذكية:", err.message);
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
