/**
 * scripts/seed-review-accounts.js
 *
 * ينشئ حسابات مراجع App Store (طالب، دكتور، مدير) داخل دفعة نموذجية معزولة
 * فيها مادة ومحاضرات واختبار مفتوح، كي يجرّب المراجع التطبيق بمحتوى فعلي
 * دون أن يرى الطالب أو الدكتور بيانات أي طالب حقيقي.
 *
 * كلمات المرور تُولَّد عشوائياً وتُكتب في ملف محلي (لا تُطبع ولا تُرفع):
 *   review-accounts.local.txt   ← مُستثنى في .gitignore
 * انسخ محتواه في App Store Connect > App Review Information.
 *
 * الاستخدام:
 *   node scripts/seed-review-accounts.js            ← إنشاء/تحديث (يعيد توليد كلمات المرور)
 *   node scripts/seed-review-accounts.js --cleanup  ← حذف كل ما أنشئ بعد قبول التطبيق
 */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const User = require("../models/User");
const Batch = require("../models/Batch");
const Subject = require("../models/Subject");
const Lecture = require("../models/Lecture");
const Quiz = require("../models/Quiz");

const BATCH_CODE = "APPREVIEW";
const ACCOUNTS = [
  { key: "student", email: "review.student@elnasrcsit.website", name: "طالب تجريبي (مراجعة المتجر)", roles: ["student"] },
  { key: "doctor",  email: "review.doctor@elnasrcsit.website",  name: "د. دكتور تجريبي (مراجعة المتجر)", roles: ["doctor"] },
  { key: "admin",   email: "review.admin@elnasrcsit.website",   name: "مدير تجريبي (مراجعة المتجر)", roles: ["admin"] },
];
const OUT_FILE = path.join(__dirname, "..", "review-accounts.local.txt");

// بلا أحرف ملتبسة (0/O، 1/l) لأن المراجع ينسخها يدوياً أحياناً
function makePassword() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(14);
  return "Rv-" + [...bytes].map(b => abc[b % abc.length]).join("");
}

async function upsertUser({ email, name, roles }, password, batchId) {
  let user = await User.findOne({ email });
  if (!user) user = new User({ email });
  Object.assign(user, {
    name, roles, password,
    isActive: true, firstLogin: false, isPendingRegistration: false, deletedAt: null,
    batch: roles.includes("student") ? batchId : null,
    batches: roles.includes("doctor") ? [batchId] : [],
  });
  await user.save(); // خطّاف pre('save') يشفّر كلمة المرور
  return user;
}

async function seed() {
  let batch = await Batch.findOne({ code: BATCH_CODE });
  if (!batch) batch = await Batch.create({ name: "دفعة تجريبية - مراجعة المتجر", code: BATCH_CODE, status: "active" });

  const creds = {};
  const users = {};
  for (const acc of ACCOUNTS) {
    creds[acc.key] = makePassword();
    users[acc.key] = await upsertUser(acc, creds[acc.key], batch._id);
  }

  let subject = await Subject.findOne({ name: "مقدمة في البرمجة (تجريبية)", batches: batch._id });
  if (!subject) {
    subject = await Subject.create({ name: "مقدمة في البرمجة (تجريبية)", level: "المستوى الأول", doctor: users.doctor._id, batches: [batch._id] });
  }

  const lectures = [
    ["المحاضرة 1: المتغيرات وأنواع البيانات", "المتغير اسم يشير إلى قيمة في الذاكرة. أنواع البيانات الأساسية: الأعداد الصحيحة، الأعداد العشرية، النصوص، والقيم المنطقية (صح/خطأ)."],
    ["المحاضرة 2: الجمل الشرطية والحلقات", "الجملة الشرطية if تنفّذ أوامر عند تحقق شرط. الحلقة for تكرر أوامر عدداً محدداً من المرات، والحلقة while تكرر ما دام الشرط صحيحاً."],
  ];
  for (const [i, [title, text]] of lectures.entries()) {
    if (!(await Lecture.findOne({ subject: subject._id, title }))) {
      await Lecture.create({ title, subject: subject._id, uploadedBy: users.doctor._id, extractedText: text, order: i + 1 });
    }
  }

  // اختبار مفتوح طوال فترة المراجعة (30 يوماً)
  const quizTitle = "اختبار قصير: أساسيات البرمجة";
  await Quiz.deleteMany({ batch: batch._id, title: quizTitle });
  await Quiz.create({
    title: quizTitle, subject: subject._id, batch: batch._id, createdBy: users.doctor._id, published: true,
    startsAt: new Date(Date.now() - 60 * 60 * 1000), endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), durationMinutes: 10,
    questions: [
      { text: "أي حلقة تتكرر ما دام الشرط صحيحاً؟", options: ["for", "while", "if"], correctOption: 1 },
      { text: "ما نوع القيمة true؟", options: ["نص", "عدد صحيح", "قيمة منطقية"], correctOption: 2 },
    ],
  });

  const lines = [
    "App Store review demo accounts (generated " + new Date().toISOString() + ")",
    "",
    ...ACCOUNTS.map(a => `${a.key.padEnd(8)} ${a.email}   ${creds[a.key]}`),
    "",
    "Sign-in information field (use the student account):",
    `User name: ${ACCOUNTS[0].email}`,
    `Password:  ${creds.student}`,
  ];
  fs.writeFileSync(OUT_FILE, lines.join("\n") + "\n", "utf8");
  console.log(`✓ ${ACCOUNTS.length} حسابات + دفعة ${BATCH_CODE} + مادة ومحاضرتان واختبار مفتوح.`);
  console.log("كلمات المرور في: " + OUT_FILE);
}

async function cleanup() {
  const batch = await Batch.findOne({ code: BATCH_CODE });
  if (batch) {
    const subjects = await Subject.find({ batches: batch._id }).select("_id");
    const ids = subjects.map(s => s._id);
    await Lecture.deleteMany({ subject: { $in: ids } });
    await Quiz.deleteMany({ batch: batch._id });
    await Subject.deleteMany({ _id: { $in: ids } });
    await Batch.deleteOne({ _id: batch._id });
  }
  const removed = await User.collection.deleteMany({ email: { $in: ACCOUNTS.map(a => a.email) } });
  if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);
  console.log(`✓ حُذفت الدفعة النموذجية و${removed.deletedCount} حساب.`);
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
