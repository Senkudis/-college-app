/**
 * scripts/seed-review-demo.js
 *
 * يزرع بلاغاً نموذجياً واحداً في طابور المراجعة، ليجد مراجع App Store
 * صفحة /moderation.html وفيها محتوى فعلي بدل قائمة فارغة.
 *
 * لماذا: مراجع آبل يتحقق من بند 1.2 بالتجربة لا بالوصف. الصفحة الفارغة
 * تُقرأ أحياناً كميزة معطّلة أو غير منفَّذة، وهو سبب رفض شائع. البلاغ
 * النموذجي يُظهر الطابور وأزرار الإجراء وسلوك الإزالة كاملاً.
 *
 * البيانات المزروعة موسومة بوضوح كنموذج، ولا تمسّ أي طالب حقيقي:
 * الحساب المُبلَّغ عنه والمُبلِّغ كلاهما حساب نموذجي يُنشأ هنا.
 *
 * الاستخدام:
 *   node scripts/seed-review-demo.js            ← زرع البلاغ
 *   node scripts/seed-review-demo.js --cleanup  ← إزالة كل ما زُرع
 *
 * شغّله مرة واحدة قبل الإرسال، ونظّفه بعد قبول التطبيق.
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const User = require("../models/User");
const VideoComment = require("../models/VideoComment");
const ContentReport = require("../models/ContentReport");

/* بريدان ثابتان كي يبقى السكربت قابلاً لإعادة التشغيل بلا تكرار. */
const DEMO_AUTHOR_EMAIL   = "demo-flagged@review.local";
const DEMO_REPORTER_EMAIL = "demo-reporter@review.local";

const SAMPLE_TEXT =
  "[محتوى نموذجي لغرض مراجعة المتجر] هذا تعليق يوضّح كيف يظهر المحتوى " +
  "المُبلَّغ عنه أمام الإدارة. اضغط «إزالة المحتوى» لتجربة الإجراء كاملاً.";

async function findOrCreateUser(email, name) {
  // نتجاوز خطّاف الحذف الناعم كي نلتقط أي نسخة سابقة زُرعت ثم حُذفت
  const existing = await User.collection.findOne({ email });
  if (existing) return existing;

  const user = await User.create({
    name,
    email,
    // كلمة مرور عشوائية: هذان الحسابان لا يُسجَّل بهما دخول إطلاقاً
    password: require("crypto").randomBytes(24).toString("hex"),
    roles: ["student"],
    isActive: true,
    firstLogin: false
  });
  return user.toObject();
}

async function seed() {
  const author   = await findOrCreateUser(DEMO_AUTHOR_EMAIL,   "طالب نموذجي (بيانات مراجعة)");
  const reporter = await findOrCreateUser(DEMO_REPORTER_EMAIL, "مُبلِّغ نموذجي (بيانات مراجعة)");

  let comment = await VideoComment.findOne({ author: author._id, text: SAMPLE_TEXT });
  if (!comment) {
    comment = await VideoComment.create({
      // فيديو وهمي: صفحة المراجعة تعرض نسخة النص المحفوظة في البلاغ نفسه
      video: new mongoose.Types.ObjectId(),
      author: author._id,
      text: SAMPLE_TEXT
    });
  }

  const existingReport = await ContentReport.findOne({
    targetType: "comment", targetId: comment._id, reportedBy: reporter._id
  });

  if (existingReport) {
    if (existingReport.status !== "pending") {
      existingReport.status = "pending";
      existingReport.reviewedBy = null;
      existingReport.reviewedAt = null;
      existingReport.reviewNote = "";
      await existingReport.save();
      console.log("↻ أُعيد البلاغ النموذجي إلى حالة «قيد المراجعة».");
    } else {
      console.log("✓ البلاغ النموذجي موجود بالفعل وقيد المراجعة.");
    }
  } else {
    await ContentReport.create({
      targetType: "comment",
      targetId: comment._id,
      targetAuthor: author._id,
      snapshot: SAMPLE_TEXT,
      reportedBy: reporter._id,
      reason: "harassment",
      details: "بلاغ نموذجي لغرض مراجعة المتجر — يمكن رفضه أو إزالته بأمان."
    });
    console.log("✓ زُرع بلاغ نموذجي واحد في طابور المراجعة.");
  }

  console.log("\nافتح /moderation.html بحساب العميد لتراه.");
  console.log("بعد قبول التطبيق:  node scripts/seed-review-demo.js --cleanup");
}

async function cleanup() {
  const emails = [DEMO_AUTHOR_EMAIL, DEMO_REPORTER_EMAIL];
  const users = await User.collection.find({ email: { $in: emails } }).toArray();
  const ids = users.map(u => u._id);

  const reports  = await ContentReport.deleteMany({
    $or: [{ reportedBy: { $in: ids } }, { targetAuthor: { $in: ids } }]
  });
  const comments = await VideoComment.deleteMany({ author: { $in: ids } });
  const removed  = await User.collection.deleteMany({ email: { $in: emails } });

  console.log(`✓ حُذف: ${reports.deletedCount} بلاغ، ${comments.deletedCount} تعليق، ${removed.deletedCount} حساب نموذجي.`);
}

(async () => {
  try {
    await connectDB();
    if (!mongoose.connection.readyState) throw new Error("تعذّر الاتصال بقاعدة البيانات");

    if (process.argv.includes("--cleanup")) await cleanup();
    else await seed();
  } catch (err) {
    console.error("✗ فشل:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
})();
