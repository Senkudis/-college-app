/**
 * fix-emails.js — إصلاح الإيميلات الملوّثة بأحرف خفية (تكسر تسجيل الدخول)
 *
 * الاستخدام:
 *   node fix-emails.js           ← معاينة فقط (لا يكتب شيئاً) — ابدأ بهذا
 *   node fix-emails.js --apply   ← تنفيذ الإصلاح فعلياً
 *
 * يبحث عن كل مستخدم إيميله المخزَّن ≠ نسخته المطبّعة، ويصلحه.
 * لو كان الإيميل المطبّع مستخدماً من حساب آخر (تعارض) يتخطاه ويُبلغ عنه لحلّه يدوياً.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const normalizeEmail = require("./utils/normalizeEmail");

const APPLY = process.argv.includes("--apply");

function mask(e) {
  const at = String(e).indexOf("@");
  return at < 1 ? "(بلا @)" : e[0] + "***" + e.slice(at);
}

(async () => {
  if (!process.env.MONGO_URI) { console.error("❌ MONGO_URI مفقود في .env"); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection("users");

  const users = await col.find({}, { projection: { email: 1 } }).toArray();
  console.log(`المستخدمون: ${users.length} | الوضع: ${APPLY ? "تنفيذ فعلي ⚠️" : "معاينة فقط"}\n`);

  // خريطة الإيميلات المطبّعة الموجودة حالياً — لكشف التعارضات
  const normToIds = {};
  for (const u of users) {
    const n = normalizeEmail(u.email || "");
    (normToIds[n] = normToIds[n] || []).push(String(u._id));
  }

  let fixed = 0, conflicts = 0, clean = 0;
  for (const u of users) {
    const raw = u.email == null ? "" : String(u.email);
    const norm = normalizeEmail(raw);
    if (raw === norm) { clean++; continue; }

    // تعارض: يوجد حساب آخر إيميله المطبّع مطابق
    const owners = normToIds[norm] || [];
    const otherOwner = owners.find(id => id !== String(u._id));
    if (otherOwner) {
      conflicts++;
      console.log(`⚠️  تعارض: ${mask(raw)} (len ${raw.length}) ← الإيميل المطبّع مملوك لحساب آخر — يحتاج حلاً يدوياً`);
      continue;
    }

    console.log(`${APPLY ? "✔" : "•"} ${mask(raw)}  (len ${raw.length} → ${norm.length})`);
    if (APPLY) {
      await col.updateOne({ _id: u._id }, { $set: { email: norm } });
    }
    fixed++;
  }

  console.log(`\nالنتيجة: ${fixed} ${APPLY ? "أُصلحت" : "ستُصلح"} | ${conflicts} تعارض | ${clean} سليمة أصلاً`);
  if (!APPLY && fixed > 0) console.log("لتنفيذ الإصلاح فعلياً:  node fix-emails.js --apply");
  await mongoose.disconnect();
})().catch(e => { console.error("خطأ:", e.message); process.exit(1); });
