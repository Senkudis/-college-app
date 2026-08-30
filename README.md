# College App (kedwebcbs)

نظام إدارة المحاضرات والطلاب والأنشطة الأكاديمية (College Management & Academic Platform).

## 🚀 المميزات الرئيسية (Features)
- 📚 **إدارة المواد والمحاضرات:** رفع واستعراض المحاضرات والملفات ومصادر التعلم.
- 🤖 **المساعد الذكي (كيدي - Kedy AI):** المساعدة في استيعاب المناهج وحل الاستفسارات وقراءة ملفات الـ PDF وتلخيصها.
- 📝 **الواجبات والتكليفات:** رفع التكليفات واستلام إجابات الطلاب وتقييمها.
- 📊 **لوحة تحكم إدارية:** إدارة الدفعات، الطلاب، المواد، الإشعارات والحضور.
- 📱 **دعم الأجهزة المتعددة:** منصة ويب (PWA) وتطبيق موبايل (Android / iOS) مدعوم عبر Capacitor.
- 🔔 **إشعارات فورية:** دعم الإشعارات اللحظية عبر WebSockets و Push Notifications.

## 🛠️ التقنيات المستخدمة (Tech Stack)
- **Backend:** Node.js, Express.js, MongoDB (Mongoose), Socket.io
- **Frontend:** Vanilla JS / Modern HTML5, CSS3, PWA (Service Workers)
- **Mobile:** Capacitor (Android & iOS)
- **AI Integration:** Google Gemini API

## ⚙️ التشغيل محلياً (Getting Started)

1. **تثبيت الحزم (Dependencies):**
   ```bash
   npm install
   ```

2. **إعداد متغيرات البيئة:**
   قم بنسخ ملف `.env.example` إلى `.env` واملأ القيم المناسبة:
   ```bash
   cp .env.example .env
   ```

3. **بدء تشغيل الخادم:**
   ```bash
   npm start
   ```
   أو في وضع التطوير:
   ```bash
   npm run dev
   ```
