const multer = require("multer");
const path = require("path");
const fs = require("fs");

// تحديد المجلد الفرعي بناءً على المسار
function getSubdir(req) {
  const basePath = req.baseUrl || "";
  if (basePath.includes("lecture")) return "lectures";
  if (basePath.includes("assignment")) return "assignments";
  if (basePath.includes("submission")) return "submissions";
  if (basePath.includes("reference")) return "references";
  if (basePath.includes("past-exam")) return "past-exams";
  /* إيصالات السداد كانت تسقط إلى "misc" لأن /api/financials لا يطابق أي
     كلمة أعلاه — و misc يُخدَم ثابتاً بلا مصادقة، أي أن صور التحويلات
     البنكية بأرقام حساباتها كانت تُنزَّل بمعرفة الاسم وحده. */
  if (basePath.includes("financial")) return "receipts";
  return "misc";
}

// Sanitize filename to prevent path traversal
function sanitizeFilename(filename) {
  // Remove any directory components
  const basename = path.basename(filename);
  // Remove any special characters except alphanumeric, dots, underscores, hyphens
  return basename.replace(/[^a-zA-Z0-9._\-]/g, '');
}

// Validate file extension
// Validate file extension
const ALLOWED_EXTENSIONS = [
  // Documents & Office
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.csv', '.rtf', '.md',
  // Archives & Packages
  '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.iso', '.apk',
  // Images & Mobile Photos
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.bmp', '.ico', '.heic', '.heif',
  // Video & Audio (including MediaRecorder webm/mp4/ogg)
  '.mp4', '.mp3', '.wav', '.webm', '.mov', '.avi', '.mkv', '.m4a', '.aac', '.flac', '.ogg', '.3gp', '.flv', '.wmv',
  // IT College Source Code & Database files
  '.java', '.py', '.c', '.cpp', '.h', '.hpp', '.cs', '.js', '.ts', '.html', '.css', '.scss',
  '.sql', '.json', '.xml', '.yaml', '.yml', '.php', '.rb', '.kt', '.swift', '.dart', '.r', '.m', '.asm'
];

function isValidFileExtension(filename) {
  if (!filename) return false;
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sub = getSubdir(req);
    const dir = path.join("uploads", sub);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const sanitizedName = sanitizeFilename(file.originalname || "file");
    let ext = path.extname(sanitizedName);
    if (!ext || ext === '') {
      if (file.mimetype && file.mimetype.startsWith('video/')) ext = '.webm';
      else if (file.mimetype && file.mimetype.startsWith('audio/')) ext = '.webm';
      else if (file.mimetype && file.mimetype.startsWith('image/')) ext = '.png';
      else ext = '.bin';
    }
    cb(null, uniqueName + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  
  // 0. Reject dangerous executable files strictly
  const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.vbs', '.ps1', '.sh', '.com', '.scr', '.pif'];
  if (DANGEROUS_EXTENSIONS.includes(ext)) {
    return cb(new Error("الملفات التنفيذية غير مسموح بها لأسباب أمنية"), false);
  }
  
  // 1. Allow if valid extension
  if (ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(null, true);
  }
  
  // 2. Allow if no extension (e.g. browser MediaRecorder blob or camera blob) and safe mimetype
  if (!ext || ext === '') {
    if (file.mimetype && (
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('text/') ||
      file.mimetype.includes('pdf') ||
      file.mimetype.includes('zip') ||
      file.mimetype.includes('octet-stream')
    )) {
      return cb(null, true);
    }
  }

  // 3. Check allowed MIME types for IT College submissions & attachments
  const allowedMimes = [
    'application/pdf', 'application/x-pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv', 'text/html', 'text/css', 'text/javascript',
    'application/zip', 'application/x-zip-compressed',
    'application/x-rar-compressed', 'application/x-7z-compressed',
    'application/x-tar', 'application/gzip',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
    'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/x-msvideo', 'video/x-matroska', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/aac',
    'application/octet-stream', 'application/json', 'application/xml'
  ];
  
  if (allowedMimes.includes(file.mimetype) || (file.mimetype && (
    file.mimetype.startsWith('text/') ||
    file.mimetype.startsWith('video/') ||
    file.mimetype.startsWith('audio/') ||
    file.mimetype.startsWith('image/')
  ))) {
    return cb(null, true);
  }
  
  return cb(new Error("نوع الملف غير مسموح به (" + (file.originalname || file.mimetype || 'unknown') + ")"), false);
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: { 
    fileSize: 500 * 1024 * 1024, // 500MB limit for lectures and video uploads
    files: 5 // Max 5 files per request
  }
});

// دالة مساعدة لحذف ملف مرتبط بمستند عند حذفه
function removeUploadedFile(filePath) {
  if (!filePath) return;
  // Prevent path traversal
  const sanitized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(__dirname, "..", sanitized);
  try {
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (e) {
    console.warn("فشل حذف الملف:", e.message);
  }
}

module.exports = upload;
module.exports.removeUploadedFile = removeUploadedFile;