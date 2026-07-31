# وثيقة التصميم التقني — إصلاح المشاكل الحرجة الأربع

## Architecture Overview

يعتمد الإصلاح على أربعة محاور مستقلة يمكن تنفيذها بالتسلسل:

1. **إصلاح `build-mobile.js`** — إعادة كتابة منطق السكربت ليكون `www/` المصدر لا الهدف.
2. **إصلاح `server.js`** — تغيير ترتيب `express.static` ليُقدَّم `www/` أولاً وحصرياً.
3. **إصلاح نماذج البيانات والمسارات** — إضافة حقل `batch` للنماذج الأربعة وتفعيل `batchMiddleware`.
4. **إضافة مسار `/api/notifications/new`** — تعريف المسار المفقود في `notification.routes.js`.

---

## Bug 1 Fix — إصلاح `build-mobile.js`

### المشكلة الجذرية
السكربت يعكس الاتجاه الصحيح: يمسح `www/` ثم ينسخ إليه من المجلد الجذري بدلاً من نسخ `www/` إلى Android.

### الحل

**السكربت الجديد** يقوم بـ:
1. التحقق من وجود `www/` وطباعة رسالة تأكيد بأنه المصدر الحقيقي — **لا يمسحه أبداً**.
2. نسخ محتوى `www/` بالكامل إلى `android/app/src/main/assets/public/`.
3. نسخ `capacitor.config.json` من الجذر إلى `android/app/src/main/assets/`.

```
www/                          ← المصدر الحقيقي (لا يُمس)
  ├── index.html
  ├── login.html
  ├── dashboard.html
  ├── js/app.js  (885 سطر)
  ├── css/
  ├── assets/
  └── sounds/
        ↓ نسخ كامل
android/app/src/main/assets/public/   ← الهدف
```

### الملف المُعدَّل
- `build-mobile.js` — إعادة كتابة كاملة

---

## Bug 2 Fix — إصلاح `server.js`

### المشكلة الجذرية
ترتيب `express.static` الحالي:
```javascript
app.use(express.static(path.join(__dirname, "public")));  // أولاً
app.use(express.static(path.join(__dirname, ".")));        // ثانياً → يُقدِّم الجذر
```
هذا يجعل `public/` و `.` يسبقان أي منطق يخص `www/`.

### الحل
استبدال السطرين بسطر واحد يُقدِّم `www/` فقط:
```javascript
app.use(express.static(path.join(__dirname, "www")));
```

ويُحتفظ بـ `/uploads` كما هو لأنه مسار مستقل.

### الملف المُعدَّل
- `server.js` — تعديل سطرين فقط في قسم الملفات الثابتة

---

## Bug 3 Fix — نماذج البيانات + `batchMiddleware`

### المشكلة الجذرية
1. النماذج الأربعة لا تحتوي على حقل `batch` → لا يمكن الفلترة.
2. المسارات الأربعة لا تستورد `batchMiddleware` → `req.activeBatch` غير معرَّف.
3. استعلامات `find()` لا تُضيف `{ batch: req.activeBatch }`.
4. عمليات `create()` لا تُضيف `batch: req.activeBatch`.

### التغييرات المطلوبة

#### أ. النماذج

| النموذج | الحقل المُضاف |
|---------|--------------|
| `Attendance` | `batch: { type: ObjectId, ref: 'Batch', required: true }` |
| `Subject` | `batch: { type: ObjectId, ref: 'Batch', required: true }` |
| `Lecture` | `batch: { type: ObjectId, ref: 'Batch', required: true }` |
| `Assignment` | `batches: [{ type: ObjectId, ref: 'Batch' }]` |

**ملاحظة `Assignment`:** يستخدم `batches` (مصفوفة) بدلاً من `batch` (قيمة مفردة) لأن التكليف يمكن توجيهه لدفعات متعددة. الفلترة تستخدم `{ batches: req.activeBatch }`.

#### ب. المسارات

كل مسار يستورد `batchMiddleware` ويُطبّقه على المسارات المعنية:

**`attendance.routes.js`:**
```javascript
const batchMiddleware = require("../middleware/batch.middleware");

// GET /students — إضافة batchMiddleware + فلترة batch
router.get("/students", auth, role("dean","doctor"), batchMiddleware, async (req, res) => {
  const students = await User.find({ roles: "student", batch: req.activeBatch })...
});

// POST / — حفظ batch في السجل
router.post("/", auth, role("dean","doctor"), batchMiddleware, async (req, res) => {
  await Attendance.findOneAndUpdate(
    { subject, date, recordedBy: req.user.id, batch: req.activeBatch },
    { students, batch: req.activeBatch },
    { upsert: true, new: true }
  );
});
```

**`subject.routes.js`:**
```javascript
// GET / — فلترة batch
const subjects = await Subject.find({ batch: req.activeBatch })...

// POST / — حفظ batch
await Subject.create({ name, level, doctor: req.user.id, batch: req.activeBatch });
```

**`lecture.routes.js`:**
```javascript
// GET / — فلترة batch
const lectures = await Lecture.find({ batch: req.activeBatch })...

// GET /by-subject/:id — فلترة batch
const lectures = await Lecture.find({ subject: subjectId, batch: req.activeBatch })...

// POST / — حفظ batch
await Lecture.create({ ..., batch: req.activeBatch });
```

**`assignment.routes.js`:**
```javascript
// GET /type/:type — فلترة batches
const assignments = await Assignment.find({ type, batches: req.activeBatch })...

// GET /by-subject/:id/:type — فلترة batches
const assignments = await Assignment.find({ subject, type, batches: req.activeBatch })...

// POST / — حفظ batches
await Assignment.create({ ..., batches: [req.activeBatch] });
```

### الملفات المُعدَّلة
- `models/Attendance.js`
- `models/Subject.js`
- `models/Lecture.js`
- `models/Assignment.js`
- `routes/attendance.routes.js`
- `routes/subject.routes.js`
- `routes/lecture.routes.js`
- `routes/assignment.routes.js`

---

## Bug 4 Fix — مسار `/api/notifications/new`

### المشكلة الجذرية
`checkNewNotifications()` في `www/js/app.js` تستدعي:
```
GET /api/notifications/new?lastCheck=<timestamp>&batch=<id>
```
لكن `notification.routes.js` لا يعرّف هذا المسار — يوجد فقط `/emergency/new`.

### الحل
إضافة مسار جديد في `notification.routes.js` **قبل** أي مسار يحتوي على `:id` لتجنب التعارض:

```javascript
// GET /new?lastCheck=<ms>&batch=<id>
router.get("/new", auth, async (req, res) => {
  try {
    const lastCheckTime = parseInt(req.query.lastCheck) || 0;
    const batchId = req.query.batch || null;

    // بناء فلتر الزمن
    const filter = { createdAt: { $gt: new Date(lastCheckTime) } };

    // إذا أُرسل batch → إشعارات الدفعة + الإشعارات العامة (بدون batch)
    if (batchId) {
      filter.$or = [
        { batch: batchId },
        { batch: null },
        { batch: { $exists: false } }
      ];
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .populate({ path: "createdBy", select: "name roles" })
      .limit(20);

    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**ملاحظة ترتيب المسارات:** يجب وضع `/new` قبل `/:id` وإلا سيُفسَّر `/new` على أنه معرّف.

### الملف المُعدَّل
- `routes/notification.routes.js` — إضافة مسار واحد

---

## تسلسل التنفيذ

```
المرحلة 1 (مستقلة): إصلاح build-mobile.js
المرحلة 2 (مستقلة): إصلاح server.js
المرحلة 3 (متسلسلة):
  3a → إضافة حقل batch للنماذج الأربعة (شرط مسبق)
  3b → تفعيل batchMiddleware في attendance.routes.js
  3c → تفعيل batchMiddleware في subject.routes.js
  3d → تفعيل batchMiddleware في lecture.routes.js
  3e → تفعيل batchMiddleware في assignment.routes.js
المرحلة 4 (مستقلة): إضافة مسار /api/notifications/new
```

المراحل 1، 2، 4 مستقلة ويمكن تنفيذها بالتوازي.
المرحلة 3a يجب أن تسبق 3b–3e.
