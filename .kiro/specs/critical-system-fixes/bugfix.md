# وثيقة متطلبات الإصلاح — المشاكل الحرجة الأربع

## Introduction

يوثّق هذا المستند أربع مشاكل حرجة مترابطة في نظام إدارة كلية تقنية المعلومات (Node.js + Express + MongoDB + Vanilla JS + Capacitor):

- **الخطأ الأول:** سكربت `build-mobile.js` يمسح `www/` ويستبدله بملفات قديمة من المجلد الجذري، مما يتلف الواجهة المتقدمة (885 سطر من `app.js` تُحذَف).
- **الخطأ الثاني:** `server.js` يُخدّم ملفات HTML من المجلد الجذري القديم للمتصفح، بينما `www/` هو المصدر الحديث والمكتمل.
- **الخطأ الثالث:** `batchMiddleware` مُطبَّق فقط في `video.routes.js`، وغائب عن `attendance`, `subject`, `lecture`, `assignment` مما يُفشل عزل البيانات بين الدفعات.
- **الخطأ الرابع:** مسار `GET /api/notifications/new` مفقود كلياً في الخلفية رغم استدعائه في كل دورة polling في `www/js/app.js`، مما يُصمت نظام الإشعارات بالكامل.

الإصلاح مطلوب بأسلوب منهجي لضمان عدم تدمير أي وظيفة قائمة.

---

## Bug Analysis

### Current Behavior (Defect)

**الخطأ الأول — `build-mobile.js` يدمّر `www/`:**

1.1 WHEN تشغيل `node build-mobile.js` THEN يقوم النظام بمسح مجلد `www/` بالكامل وإعادة بنائه من ملفات HTML قديمة في المجلد الجذري.

1.2 WHEN تشغيل `node build-mobile.js` THEN يستبدل `public/js/app.js` (254 سطر) ملف `www/js/app.js` (885 سطر)، محذوفاً منطق FCM وشريط التنقل السفلي وتكامل Capacitor بالكامل.

1.3 WHEN تشغيل `node build-mobile.js` THEN تُستبدل ملفات HTML المتقدمة في `www/` (لوحة الشرف، شريط الإحصائيات، التصميم المتقدم) بملفات HTML مبسّطة من المجلد الجذري.

1.4 WHEN تشغيل `node build-mobile.js` THEN لا يوجد أي تحقق أو تحذير يُنبّه المطوّر بأن `www/` يحتوي على إصدارات أحدث قبل المسح.

**الخطأ الثاني — `server.js` يُخدّم الواجهة القديمة:**

1.5 WHEN طلب HTTP GET لأي ملف HTML عبر المتصفح THEN يُخدّم الخادم الملف من المجلد الجذري أو `public/` قبل `www/` بسبب ترتيب `express.static`.

1.6 WHEN استعراض الواجهة عبر المتصفح THEN يحصل المستخدم على النسخة القديمة البسيطة بدلاً من الواجهة المتقدمة في `www/` (غياب لوحة الشرف، شريط التنقل، والإحصائيات).

1.7 WHEN وجود ملف HTML بنفس الاسم في المجلد الجذري وفي `www/` THEN يُقدَّم الملف الجذري بسبب أولويته في التهيئة الحالية.

**الخطأ الثالث — غياب `batchMiddleware` في مسارات حرجة:**

1.8 WHEN طلب `GET /api/attendance/students` THEN يُرجع الخادم قائمة جميع طلاب الكلية دون أي تصفية حسب الدفعة.

1.9 WHEN طلب `GET /api/subjects/` THEN يُرجع الخادم جميع المواد لجميع الدفعات دون تصفية.

1.10 WHEN طلب `GET /api/lectures/` أو `GET /api/lectures/by-subject/:id` THEN يُرجع الخادم محاضرات جميع الدفعات دون تصفية.

1.11 WHEN طلب `GET /api/assignments/type/:type` أو `GET /api/assignments/by-subject/:id/:type` THEN يُرجع الخادم تكاليف جميع الدفعات دون تصفية.

1.12 WHEN إنشاء سجل حضور عبر `POST /api/attendance/` THEN لا تُسجَّل الدفعة المعنية في السجل، مما يُخلّ بارتباط الحضور بدفعة محددة.

**الخطأ الرابع — مسار الإشعارات `new` مفقود:**

1.13 WHEN استدعاء `checkNewNotifications()` في `app.js` THEN يُرسَل طلب إلى `GET /api/notifications/new` الذي يُرجع `404 Not Found` لأن المسار غير معرَّف في `notification.routes.js`.

1.14 WHEN كل دورة polling (كل 15 ثانية على الموبايل أو 30 على الويب) THEN تفشل جميع محاولات جلب الإشعارات الجديدة بصمت.

1.15 WHEN إنشاء إشعار جديد في قاعدة البيانات THEN لا يصل أي toast أو إشعار محلي للمستخدم رغم اكتمال البنية التحتية للإشعارات.

---

### Expected Behavior (Correct)

**إصلاح الخطأ الأول — `build-mobile.js`:**

2.1 WHEN تشغيل `node build-mobile.js` THEN يجب على النظام أن يُزامن محتوى `www/` مع مجلد الأصول Android فقط، دون المساس بمحتوى `www/` نفسه.

2.2 WHEN تشغيل `node build-mobile.js` THEN يجب أن تظل `www/js/app.js` (885 سطر) سليمة ولا تُستبدَل بالنسخة المبسّطة.

2.3 WHEN تشغيل `node build-mobile.js` THEN يجب أن يُنبّه السكربت المطوّر صراحةً بأن `www/` هو المصدر الحقيقي ولا تُعدَّل ملفاته.

2.4 WHEN تشغيل `node build-mobile.js` THEN يجب أن ينسخ السكربت محتوى `www/` إلى `android/app/src/main/assets/public/` بدلاً من إعادة بناء `www/`.

**إصلاح الخطأ الثاني — `server.js`:**

2.5 WHEN طلب HTTP GET لأي ملف HTML THEN يجب أن يُخدّمه الخادم من `www/` فقط كمصدر وحيد للواجهة.

2.6 WHEN تعارض ملفات HTML بنفس الاسم في مجلدات مختلفة THEN يجب أن تكون الأولوية دائماً لـ `www/` ولا يُخدَّم ملف من المجلد الجذري مباشرةً.

2.7 WHEN الوصول لمسارات CSS وJS THEN يجب أن يُخدَّم من `www/css/` و`www/js/` كبديل موحّد.

**إصلاح الخطأ الثالث — `batchMiddleware`:**

2.8 WHEN طلب `GET /api/attendance/students` THEN يجب على الخادم أن يُرجع فقط الطلاب المنتسبين إلى `req.activeBatch`.

2.9 WHEN طلب `GET /api/subjects/` THEN يجب على الخادم أن يُرجع فقط المواد المرتبطة بـ `req.activeBatch`.

2.10 WHEN طلب `GET /api/lectures/` أو `GET /api/lectures/by-subject/:id` THEN يجب على الخادم أن يُرجع فقط المحاضرات المرتبطة بـ `req.activeBatch`.

2.11 WHEN طلب `GET /api/assignments/type/:type` أو `GET /api/assignments/by-subject/:id/:type` THEN يجب على الخادم أن يُرجع فقط التكاليف المرتبطة بـ `req.activeBatch`.

2.12 WHEN إنشاء سجل حضور أو مادة أو محاضرة أو تكليف THEN يجب على الخادم أن يحفظ `req.activeBatch` ضمن السجل الجديد.

**إصلاح الخطأ الرابع — مسار الإشعارات:**

2.13 WHEN إرسال `GET /api/notifications/new?lastCheck=<timestamp>` THEN يجب أن يُرجع الخادم مصفوفة بالإشعارات (عادية وطارئة) التي أُنشئت بعد `lastCheck`.

2.14 WHEN وجود بارامتر `batch` في الطلب THEN يجب على الخادم أن يُصفّي الإشعارات لتشمل فقط ما يخص تلك الدفعة والإشعارات العامة.

2.15 WHEN عدم وجود إشعارات جديدة منذ `lastCheck` THEN يجب أن يُرجع المسار مصفوفة فارغة `[]` دون خطأ.

2.16 WHEN وجود إشعارات جديدة وتوافر المسار THEN يجب أن تعمل آلية `checkNewNotifications()` على إظهار toast وإشعار Capacitor المحلي بشكل صحيح.

---

---

### Model Prerequisites (Required for Bug 3 Fix)

**يجب إضافة حقل `batch` لنماذج البيانات التالية قبل تطبيق الفلترة:**

P.1 نموذج `Attendance` يجب أن يحتوي على حقل `batch: { type: ObjectId, ref: 'Batch', required: true }`.

P.2 نموذج `Subject` يجب أن يحتوي على حقل `batch: { type: ObjectId, ref: 'Batch', required: true }`.

P.3 نموذج `Lecture` يجب أن يحتوي على حقل `batch: { type: ObjectId, ref: 'Batch', required: true }`.

P.4 نموذج `Assignment` يجب أن يحتوي على حقل `batches: [{ type: ObjectId, ref: 'Batch' }]` لدعم التكليفات الموجهة لدفعات متعددة.

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN تشغيل `node build-mobile.js` THEN يجب أن يستمر النظام في نسخ ملف `capacitor.config.json` والأصول الثابتة (`assets/`, `sounds/`) إلى المجلد المستهدف.

3.2 WHEN تشغيل `npx cap sync` بعد السكربت THEN يجب أن يستمر تحديث `android/app/src/main/assets/public/` بنجاح.

3.3 WHEN الوصول لمسارات `/uploads/` THEN يجب أن يستمر الخادم في تقديم الملفات المرفوعة دون تأثير.

3.4 WHEN الوصول لمسارات API تبدأ بـ `/api/` THEN يجب ألا يتأثر أي مسار API بالتغييرات في مصادر الملفات الثابتة.

3.5 WHEN وصول عميد أو دكتور مُسنَد لدفعة واحدة THEN يجب أن يستمر النظام في خدمتهم بدون إلزامهم باختيار دفعة يدوياً (auto-select في `batchMiddleware`).

3.6 WHEN وصول طالب أو ليدر THEN يجب أن يستمر النظام في تحديد دفعتهم تلقائياً من ملفهم في قاعدة البيانات.

3.7 WHEN وصول عميد بصلاحيات كاملة THEN يجب أن يستمر في إمكانية الوصول لبيانات أي دفعة بمجرد تمرير `?batch=ID`.

3.8 WHEN طلب `GET /api/notifications/emergency/new` THEN يجب أن يستمر المسار الحالي في العمل دون أي تغيير.

3.9 WHEN طلب `GET /api/notifications/unread-count` THEN يجب أن يستمر مسار العدد غير المقروء في العمل دون تأثير.

3.10 WHEN طلب `GET /api/notifications/` THEN يجب أن يستمر جلب جميع الإشعارات دون تأثير.

3.11 WHEN وصول مسارات الفيديو `GET /api/videos/` THEN يجب أن يستمر `batchMiddleware` الموجود فيها في العمل كما هو.
