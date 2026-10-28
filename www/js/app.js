/* =====================================================
   كلية تقنية المعلومات - الجافاسكربت المشترك
   ===================================================== */

// ===== API Base URL =====
// في تطبيق الهاتف الحقيقي (Capacitor Native) نتصل بالخادم المستضاف مباشرةً
// في المتصفح العادي (سواء localhost أو elnasrcsit.website) نستخدم روابط نسبية
const _IS_CAPACITOR_NATIVE = !!(window.Capacitor?.isNativePlatform?.());
const API_BASE = _IS_CAPACITOR_NATIVE ? 'https://elnasrcsit.website' : '';

const CBS = {

  VERSION: '2.7.0',
  BUILD_CODE: 38,
  ASSET_VERSION: '2026100603',

  /* ===== Auth ===== */
  getToken() { return localStorage.getItem('token'); },
  /* رابط ملف خاص (تسليم أو إيصال سداد). هذه المجلدات صارت خلف مصادقة،
     و<img src> و<a href> لا يرسلان ترويسة Authorization — فيُمرَّر التوكن
     في الرابط، وهو منفذ يقبله الخادم لمسارات /uploads وحدها. */
  privateFileUrl(dir, filename) {
    if (!filename) return '';
    return `/uploads/${dir}/${encodeURIComponent(filename)}?token=${encodeURIComponent(this.getToken() || '')}`;
  },
  getUser()  { return JSON.parse(localStorage.getItem('user') || '{}'); },
  get user() { return this.getUser(); },
  /* الخادم يعيد المستخدم بحقل id، بينما مستندات mongo تعيد _id — وحّد القراءة هنا */
  getUserId(user = this.getUser()) {
    const raw = user?.id ?? user?._id;
    return raw ? String(raw) : null;
  },
  /* يقارن معرّف مستخدم قادم من الـAPI (نص أو مستند مُعبّأ populate) بالمستخدم الحالي */
  isMe(ref) {
    const mine = this.getUserId();
    if (!mine || ref === null || ref === undefined) return false;
    const other = typeof ref === 'object' ? (ref._id ?? ref.id) : ref;
    return other ? String(other) === mine : false;
  },
  getPrimaryRole(user = this.getUser()) {
    const roles = user?.roles || [];
    // 'admin' كان ناقصاً هنا فكانت الدالة تعيد null للمسؤول، فتفشل كل الفروع المبنية عليها
    return ['admin', 'dean', 'doctor', 'leader', 'student'].find(role => roles.includes(role)) || null;
  },
  isAdminLevel(user = this.getUser()) {
    const roles = user?.roles || [];
    return roles.includes('admin') || roles.includes('dean');
  },
  /* كانت quizzes.html و subject.html تستدعيان CBS.hasRole وهي غير معرَّفة،
     فيرمى TypeError داخل دالة الرسم وتبقى الصفحة فارغة تماماً للكادر. */
  hasRole(role, user = this.getUser()) {
    const roles = user?.roles || [];
    if (Array.isArray(role)) return role.some(r => roles.includes(r));
    return roles.includes(role);
  },
  _notificationSoundEnabled() {
    return localStorage.getItem('notificationSound') !== 'off';
  },
  setNotificationSoundEnabled(enabled) {
    localStorage.setItem('notificationSound', enabled ? 'on' : 'off');
  },
  playNotificationSound(isEmergency = false) {
    if (!this._notificationSoundEnabled()) return;
    const soundUrl = isEmergency ? '/sounds/cbs_emergency.wav' : '/sounds/cbs_notif.wav';
    try {
      const audio = new Audio(soundUrl);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    } catch(e) {}
  },
  getBatchId() { 
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get('batch');
    if (fromUrl && fromUrl !== 'undefined' && fromUrl !== 'null' && fromUrl !== '[object Object]') {
      localStorage.setItem('cbs_active_batch_id', fromUrl);
      return fromUrl;
    }
    const fromStorage = localStorage.getItem('cbs_active_batch_id');
    if (fromStorage && fromStorage !== 'undefined' && fromStorage !== 'null' && fromStorage !== '[object Object]') {
      return fromStorage;
    }
    return null;
  },

  /* النطاق العام للروابط التي يشاركها المستخدم مع الآخرين.
     التعريف الفعلي في js/shared.js لأن welcome.html تحتاجه أيضاً ولا تحمّل
     هذا الملف — الاحتفاظ بنسختين هو ما جعلهما تتباعدان سابقاً. */
  get PUBLIC_BASE_URL() { return window.CBSShared.PUBLIC_BASE_URL; },

  publicBaseUrl() {
    return window.CBSShared.publicBaseUrl();
  },

  /* ===== Media & File URLs ===== */
  getMediaUrl(url) {
    if (!url) return '';
    const cleanUrl = String(url).trim();
    if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('data:')) {
      return cleanUrl;
    }
    let path = cleanUrl;
    if (!path.startsWith('/')) path = '/' + path;

    let base = typeof API_BASE !== 'undefined' && API_BASE ? API_BASE : '';
    if (!base && (window.location.hostname === 'localhost' || window.location.protocol === 'file:')) {
      base = 'https://elnasrcsit.website';
    }
    return base + path;
  },

  /* ===== Utilities =====
     التعريف في js/shared.js — تشاركه welcome.html التي لا تحمّل هذا الملف.
     ملاحظة: النسخة القديمة هنا كانت `if (!str) return ''` فتُرجع '' للرقم 0
     وللقيمة false؛ نسخة shared.js تفحص null/undefined فقط. */
  /* "د. " مرة واحدة: كثير من أسماء الدكاترة مسجلة بلقبها أصلاً فكانت تظهر "د. د. فلان" */
  doctorName(name) {
    const n = String(name || '').trim();
    if (!n) return 'غير محدد';
    return /^(د\.|د |دكتور|أ\.|بروف|Dr\.?)/i.test(n) ? n : 'د. ' + n;
  },

  escapeHTML(str) {
    return window.CBSShared.escapeHTML(str);
  },

  requireAuth() {
    if (!this.getToken()) {
      window.location.href = '/login.html';
      return false;
    }
    const user = this.getUser();
    const skipBatchPages = [
      '/batch-selector.html', 
      '/manage-batches.html', 
      '/admin_dashboard.html', 
      '/admin-content.html',
      '/manage-users.html',
      '/financials.html',
      // صفحات على مستوى الكلية أو شخصية: لا معنى لإجبار اختيار دفعة قبلها
      '/manage-subjects.html',
      '/pending-registrations.html',
      '/moderation.html',
      '/reports.html',
      '/profile.html',
      '/notifications.html',
      '/student-portfolio.html',
      '/code-lab.html',
      '/privacy.html',
      '/login.html', 
      '/forgot-password.html',
      '/force-change-password.html',
      '/reset-code.html',
      '/new-password.html',
      '/404.html'
    ];
    const onSkipPage = skipBatchPages.some(p => window.location.pathname === p);

    // إعادة توجيه غير الطلاب وغير الليدر لاختيار الدفعة إذا لم تحدَّد في الـ URL أو التخزين
    // الليدر مثل الطالب  لديه دفعة واحدة ثابتة لا يحتاج لاختيارها
    const primaryRole = this.getPrimaryRole(user);
    const needsBatchPicker = primaryRole === 'dean' || primaryRole === 'doctor';

    if (needsBatchPicker && !onSkipPage) {
      if (!this.getBatchId()) {
        if (primaryRole === 'doctor' && user && user.batches && Array.isArray(user.batches) && user.batches.length === 1) {
          const autoBatch = user.batches[0];
          if (autoBatch && autoBatch !== 'undefined' && autoBatch !== 'null') {
            localStorage.setItem('cbs_active_batch_id', autoBatch);
            return true;
          }
        }
        window.location.replace('/batch-selector.html');
        return false;
      }
    }
    return true;
  },

  async verifyToken() {
    // إذا لا يوجد توكن أصلاً  مستخدم غير مسجّل
    if (!this.getToken()) return false;

    try {
      const res = await fetch(API_BASE + '/api/verify-token', {
        headers: { Authorization: 'Bearer ' + this.getToken() }
      });
      /* 403 مع PASSWORD_CHANGE_REQUIRED ليست جلسة منتهية: الخادم صار يمنع
         كل شيء حتى تُغيَّر كلمة المرور الأولى. الخروج هنا كان سيحبس المستخدم
         في حلقة تسجيل دخول لا مخرج منها — الصحيح توجيهه إلى صفحة التغيير. */
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body.code === 'PASSWORD_CHANGE_REQUIRED') {
          if (window.location.pathname !== '/force-change-password.html') {
            window.location.replace('/force-change-password.html');
          }
          return false;
        }
        this.logout(false);
        return false;
      }
      // 401 = توكن منتهي أو مرفوض من السيرفر → خروج
      if (res.status === 401) {
        this.logout(false);
        return false;
      }
      // أي حالة أخرى (200 ، 500، timeout...) = نبقي المستخدم داخل التطبيق
      return res.ok;
    } catch {
      // فشل الشبكة (لا إنترنت) → نبقي الجلسة ولا نخرج المستخدم
      return true; // keep offline gracefully
    }
  },

  async logout(confirm_ = true) {
    if (confirm_ && !confirm('هل تريد تسجيل الخروج؟')) return;
    
    // محاولة إلغاء تسجيل FCM Token قبل مسح التوكن
    try {
      const fcmToken = localStorage.getItem('fcm_token');
      if (fcmToken) {
        await fetch(API_BASE + '/api/device/unregister', {
          method: 'DELETE',
          // نستخدم CBS لا this: لو استدعيت logout كمرجع مفصول (callback)
          // لضاع الربط وظهر "this._getHeaders is not a function"
          headers: CBS._getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ token: fcmToken })
        });
      }
    } catch { /* ignore error during logout */ }

    // Preserve important settings
    const darkMode = localStorage.getItem('darkMode');
    const rememberedEmail = localStorage.getItem('rememberedEmail');
    const biometricEntries = Object.keys(localStorage)
      .filter(key => key === 'biometricEnabled' || key.startsWith('biometricEnabled:'))
      .map(key => [key, localStorage.getItem(key)]);
    const passPrompted = localStorage.getItem('passkeyPrompted');
    const fcmT = localStorage.getItem('fcm_token');
    const emailHistory = localStorage.getItem('emailHistory');

    localStorage.clear();

    if (darkMode) localStorage.setItem('darkMode', darkMode);
    if (rememberedEmail) localStorage.setItem('rememberedEmail', rememberedEmail);
    biometricEntries.forEach(([key, value]) => localStorage.setItem(key, value));
    if (passPrompted) localStorage.setItem('passkeyPrompted', passPrompted);
    if (fcmT) localStorage.setItem('fcm_token', fcmT);
    if (emailHistory) localStorage.setItem('emailHistory', emailHistory);

    window.location.href = '/login.html';
  },

  /* ===== حفظ الملفات على الجهاز =====
     WebView أندرويد لا يدعم تنزيل blob  داخل التطبيق نكتب الملف عبر Filesystem
     ثم نفتح نافذة المشاركة (حفظ في الملفات / إرسال). في المتصفح تنزيل عادي. */
  async saveFileNative(fileName, base64Data) {
    const { Filesystem, Share } = window.Capacitor?.Plugins || {};
    if (!Filesystem) throw new Error('Filesystem plugin missing');
    const safeName = String(fileName || 'file.pdf').trim().replace(/\/+$/, '').split('/').pop();
    const write = await Filesystem.writeFile({ path: safeName, data: base64Data, directory: 'CACHE' });
    if (Share) await Share.share({ title: safeName, files: [write.uri] });
    return write.uri;
  },

  /* ===== فتح ملف لا يعرضه التطبيق داخلياً (PowerPoint / Word / Excel / أرشيف) =====
     كانت الواجهة تعرض رابط <a href="blob:..." download> وهو لا يفعل شيئاً إطلاقاً
     داخل WebView أندرويد (لا يملك منز←ّلاً للـ blob)، فيبدو للمستخدم أن ملفات
     الباوربوينت "لا تفتح". هنا نكتب الملف فعلياً ثم نفتح نافذة "فتح بواسطة/مشاركة"
     ليختار تطبيقاً يعرضه. */
  async openFileExternally(buffer, filename, url) {
    const isNative = !!(window.Capacitor?.isNativePlatform?.());

    if (isNative) {
      if (buffer && window.Capacitor?.Plugins?.Filesystem) {
        await this.saveFileNative(filename, this._abToBase64(buffer));
        return 'shared';
      }
      // بلا محتوى محفوظ: ندع النظام يتولى الرابط (متصفح/مدير تنزيل)
      window.open(url, '_system');
      return 'system';
    }

    // المتصفح: تنزيل عادي
    if (!buffer) { window.open(url, '_blank'); return 'opened'; }
    const blobUrl = URL.createObjectURL(new Blob([buffer]));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    return 'downloaded';
  },

  /* اسم ملف مقروء من الرابط، مع امتداد صالح */
  /* ===== عارض الملفات الموحّد (js/file-viewer.js) =====
     يُحمَّل عند أول فتح لملف فقط. كل الصفحات تمر من هنا — انظر اعتراض الروابط
     في آخر الملف. */
  _viewerReady: null,
  _loadViewer() {
    if (window.CBSViewer) return Promise.resolve();
    if (!this._viewerReady) {
      const v = (document.querySelector('script[src*="/js/app.js"]')?.src.split('v=')[1]) || Date.now();
      this._viewerReady = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/js/file-viewer.js?v=' + v;
        s.onload = resolve;
        s.onerror = () => { this._viewerReady = null; reject(new Error('تعذّر تحميل عارض الملفات')); };
        document.head.appendChild(s);
      });
    }
    return this._viewerReady;
  },
  /* داخل التطبيق الصفحات محلية (https://localhost) فرابط /uploads/... النسبي كان
     يشير إلى الجهاز نفسه لا إلى الخادم — الامتحانات السابقة والإيصالات لم تُفتح قط. */
  resolveFileUrl(url) {
    try {
      const u = new URL(url, location.href);
      if (API_BASE && u.origin === location.origin && u.pathname.startsWith('/uploads/')) {
        return new URL(u.pathname + u.search, API_BASE).href;
      }
      return u.href;
    } catch (e) { return url; }
  },
  async openFileViewer(url, opts = {}) {
    try { await this._loadViewer(); return window.CBSViewer.open(this.resolveFileUrl(url), opts); }
    catch (e) { window.open(this.resolveFileUrl(url), this._isCapacitor() ? '_system' : '_blank'); }
  },
  async renderFileInto(host, url, opts = {}) {
    await this._loadViewer();
    return window.CBSViewer.renderInto(host, this.resolveFileUrl(url), opts);
  },
  async openMediaLink(url, title) {
    try {
      await this._loadViewer();
      if (window.CBSViewer.openMedia(url, title)) return true;
    } catch (e) {}
    window.open(url, this._isCapacitor() ? '_system' : '_blank');
    return false;
  },

  fileNameFromUrl(url, fallback = 'file') {
    try {
      const path = new URL(url, location.origin).pathname;
      const name = decodeURIComponent(path.split('/').pop() || '');
      return name || fallback;
    } catch (e) {
      return fallback;
    }
  },

  /* ===== تصدير PDF =====
     window.print() لا يعمل داخل WebView أندرويد (زر الطباعة كان لا يفعل شيئاً على
     الهاتف)، لذلك نولّد ملف PDF دائماً عبر html2pdf ثم:
       - داخل التطبيق: نكتبه بـ Filesystem ونفتح نافذة المشاركة/الحفظ.
       - في المتصفح: تنزيل عادي.
     المحتوى يرسم دائماً في "مسرح" ثابت العرض (عرض A4) خارج الشاشة، لأن الالتقاط
     من الصفحة الحية على الهاتف كان ينتج PDF بعرض الجوال (عمود ضيق مقصوص)
     وبألوان الوضع الليلي (خلفية سوداء). */

  PDF_STAGE_WIDTH: 794,     // A4 بعرض 96dpi
  _PDF_MAX_CANVAS_PX: 12e6, // كانفاس الهاتف محدود؛ تجاوزه ينتج صفحة فارغة

  async _ensureHtml2Pdf() {
    if (window.html2pdf) return window.html2pdf;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/html2pdf.bundle.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('تعذر تحميل مكتبة توليد PDF'));
      document.head.appendChild(s);
    });
    if (!window.html2pdf) throw new Error('تعذر تحميل مكتبة توليد PDF');
    return window.html2pdf;
  },

  /* مقياس آمن: نخفّضه تلقائياً للتقارير الطويلة حتى لا يتجاوز الكانفاس حدّ الجهاز */
  _pdfScale(width, height) {
    const area = Math.max(1, width * height);
    const max  = Math.sqrt(this._PDF_MAX_CANVAS_PX / area);
    return Math.max(1, Math.min(2, max));
  },

  /* يبني حاوية خارج الشاشة بعرض ثابت وألوان فاتحة صريحة (لا تتأثر بالوضع الليلي) */
  _pdfStage(width) {
    const stage = document.createElement('div');
    stage.className = 'cbs-pdf-stage';
    stage.setAttribute('data-theme', 'light');
    // ملاحظة مهمة: لا نزيح الحاوية بعيداً (مثل right:-20000px) لأن html2canvas
    // يحسب حينها لوحة رسم بعرض عشرات الآلاف من البكسلات فيتجمّد التصدير.
    // نضعها في أعلى الصفحة خلف كل شيء (z-index سالب) كما في النمط المجرَّب.
    stage.setAttribute('dir', 'rtl');
    stage.style.cssText = [
      'position:fixed', 'top:0', 'left:0', `width:${width}px`,
      // بدون border-box يصبح العرض الفعلي width+48 (الحشو) فيقصّ الملف من الجانب
      'box-sizing:border-box',
      'background:#ffffff', 'color:#0f1928', 'direction:rtl',
      // خطوط النظام فقط: خطوط @font-face لا تحمَّل داخل صورة SVG المعزولة
      'font-family:Tahoma,Arial,"Segoe UI",sans-serif',
      'padding:24px', 'z-index:-99999', 'pointer-events:none'
    ].join(';');
    return stage;
  },

  /* ===== تحويل المحتوى إلى صورة =====
     html2canvas يرسم النص بنفسه، وهو يفسد العربية: يفقد المسافات بين الكلمات
     ("أحمدعبدالله")، ويعكس ترتيب عناصر RTL، ويقصّ المحتوى جانبياً.
     البديل: نغلّف المحتوى في <foreignObject> داخل SVG ونترك المتصفح يرسمه 
     فيخرج التشكيل والاتجاه والمسافات صحيحة تماماً. */
  /* محتوى الـ SVG معزول عن أوراق أنماط الصفحة، فأي تنسيق معتمد على الأصناف
     (.kpi-card وغيرها في صفحة التقارير) يضيع تماماً. لذلك نثبّت الأنماط
     المحسوبة داخل كل عنصر قبل التسلسل. الأنماط المضمّنة أصلاً تبقى الأقوى. */
  _PDF_INLINE_PROPS: [
    'display','position','box-sizing','width','height','min-height','max-width',
    'margin','padding',
    // getComputedStyle لا يرجع قيمة للاختصار 'border'، فنطلب الخصائص المفصّلة
    'border-top-width','border-right-width','border-bottom-width','border-left-width',
    'border-top-style','border-right-style','border-bottom-style','border-left-style',
    'border-top-color','border-right-color','border-bottom-color','border-left-color',
    'border-radius','background-color','color',
    'font-family','font-size','font-weight','line-height','text-align','direction',
    'flex','flex-direction','flex-wrap','justify-content','align-items','gap',
    'grid-template-columns','overflow','white-space','vertical-align',
    'border-collapse','opacity','letter-spacing','text-decoration'
  ],
  _inlineComputedStyles(root) {
    const nodes = [root, ...root.querySelectorAll('*')];
    nodes.forEach(node => {
      const cs = getComputedStyle(node);
      let css = '';
      for (const prop of this._PDF_INLINE_PROPS) {
        const value = cs.getPropertyValue(prop);
        if (value) css += `${prop}:${value};`;
      }
      // نلحق الأنماط الأصلية بعدها لتفوز عند التعارض
      node.setAttribute('style', css + (node.getAttribute('style') || ''));
    });
  },

  /* صورة SVG معزولة أمنياً: لا تحمَّل منها أي موارد خارجية، فالصور المشار
     إليها برابط (شعار الكلية مثلاً) تختفي تماماً. نحوّلها إلى data URI أولاً. */
  async _inlineImages(root) {
    const images = [...root.querySelectorAll('img')];
    await Promise.all(images.map(img => new Promise(resolve => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return resolve();
      const loader = new Image();
      loader.crossOrigin = 'anonymous';
      loader.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width  = loader.naturalWidth;
          c.height = loader.naturalHeight;
          c.getContext('2d').drawImage(loader, 0, 0);
          img.setAttribute('src', c.toDataURL('image/png'));
        } catch (e) { img.remove(); } // مصدر ملوّث  حذفها أفضل من مربع فارغ
        resolve();
      };
      loader.onerror = () => { img.remove(); resolve(); };
      loader.src = src;
    })));
  },

  async _rasterize(element, width, scale) {
    const height = Math.max(element.scrollHeight, element.offsetHeight);
    await this._inlineImages(element);
    this._inlineComputedStyles(element);
    // XMLSerializer ينتج XHTML صالحاً (يغلق <br/> و <img/>)  بدونه يفشل تحميل الـ SVG
    const xhtml = new XMLSerializer().serializeToString(element);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
                `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload  = () => resolve(i);
      i.onerror = () => reject(new Error('تعذر رسم المحتوى'));
      i.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);

    /* بعض إصدارات WebView تلوّث الكانفاس عند رسم SVG يحوي foreignObject،
       فيفشل استخراج الصورة لاحقاً داخل html2pdf  خارج نطاق التقاطنا للأخطاء
       فينهار التصدير كله. نتحقق هنا ليعمل التراجع إلى html2canvas بدل الانهيار. */
    canvas.toDataURL('image/png');
    return canvas;
  },

  /**
   * يصدّر محتوى إلى PDF.
   * @param {HTMLElement|string} source عنصر (يستنسخ) أو نص HTML جاهز للطباعة.
   * @param {{filename?:string, width?:number, margin?:number, orientation?:string}} options
   * @returns {Promise<'shared'|'downloaded'>}
   */
  async exportPdf(source, options = {}) {
    const html2pdfFn = await this._ensureHtml2Pdf();
    const width    = options.width || this.PDF_STAGE_WIDTH;
    const filename = options.filename || 'report.pdf';

    const stage = this._pdfStage(width);
    if (typeof source === 'string') {
      stage.innerHTML = source;
    } else if (source instanceof HTMLElement) {
      const clone = source.cloneNode(true);
      // لا معنى للأزرار وعناصر التنقل داخل ملف مطبوع
      clone.querySelectorAll(
        'button, nav, .btn, .btn-icon, .app-back-btn, #bottom-nav, .no-print, [data-html2canvas-ignore]'
      ).forEach(el => el.remove());
      // cloneNode لا ينسخ محتوى الـ canvas  بدون هذا تخرج الرسوم البيانية بيضاء
      const srcCanvases   = source.querySelectorAll('canvas');
      const clonedCanvases = clone.querySelectorAll('canvas');
      clonedCanvases.forEach((cnv, i) => {
        const src = srcCanvases[i];
        if (!src) return;
        try {
          const img = document.createElement('img');
          img.src = src.toDataURL('image/png');
          img.style.cssText = `width:${src.clientWidth || src.width}px;height:auto;display:block`;
          cnv.replaceWith(img);
        } catch (e) { /* canvas ملوّث بمصدر خارجي  نتركه كما هو */ }
      });
      stage.appendChild(clone);
    } else {
      throw new Error('exportPdf: مصدر غير صالح');
    }
    document.body.appendChild(stage);

    try {
      // نمهل المتصفح لحظة لحساب التخطيط قبل قياس الارتفاع.
      // نستخدم setTimeout لا requestAnimationFrame: الأخير يتوقف تماماً عندما
      // تكون الصفحة في الخلفية، فيتجمّد التصدير إذا خرج المستخدم من التطبيق.
      await new Promise(r => setTimeout(r, 50));
      // ننتظر تحميل الخطوط قبل القياس وإلا خرجت الأبعاد بخط احتياطي
      if (document.fonts?.ready) { try { await document.fonts.ready; } catch (e) {} }
      const height = Math.max(stage.scrollHeight, stage.offsetHeight);
      const scale  = this._pdfScale(width, height);

      const opt = {
        margin:   options.margin ?? 8,
        filename,
        image:    { type: 'jpeg', quality: 0.95 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: options.orientation || 'portrait' },
        // تحذير: وضع 'legacy' يدخل هذه النسخة من html2pdf في حلقة لا نهائية
        // تجمّد الواجهة تماماً  لا تض←فه.
        pagebreak: { mode: ['css'] }
      };

      /* نرسم المحتوى بأنفسنا عبر SVG (يحفظ العربية) ثم نسلّم الصورة الجاهزة
         لـ html2pdf ليتكفّل بتقسيم الصفحات فقط. عند فشل الرسم  كأن يكون
         WebView قديماً لا يدعم foreignObject  نعود لمسار html2canvas. */
      let source = stage, sourceType = 'element';
      try {
        source = await this._rasterize(stage, width, scale);
        sourceType = 'canvas';
      } catch (e) {
        console.warn('تعذر الرسم عبر SVG، نعود إلى html2canvas:', e.message);
        opt.html2canvas = {
          scale, useCORS: true, backgroundColor: '#ffffff',
          scrollX: 0, scrollY: 0,
          windowWidth: width, windowHeight: height, width, height,
          // html2canvas يفقد اتجاه RTL لأن المستند المستنسخ لا يرثه
          onclone: (doc) => {
            doc.documentElement.setAttribute('dir', 'rtl');
            doc.documentElement.style.direction = 'rtl';
            if (doc.body) doc.body.style.direction = 'rtl';
          }
        };
      }

      const isNative = !!(window.Capacitor?.isNativePlatform?.());
      if (isNative && window.Capacitor?.Plugins?.Filesystem) {
        const dataUri = await html2pdfFn().set(opt).from(source, sourceType).outputPdf('datauristring');
        await this.saveFileNative(filename, dataUri.split(',')[1]);
        return 'shared';
      }
      await html2pdfFn().set(opt).from(source, sourceType).save();
      return 'downloaded';
    } finally {
      stage.remove();
    }
  },

  /* غلاف مريح: يعرض رسائل التقدّم والنجاح والفشل بدل تكرارها في كل صفحة */
  async exportPdfWithFeedback(source, options = {}) {
    this.toast('جاري التحضير', 'يتم تجهيز ملف الـ PDF...', 'info', 3000);
    try {
      const result = await this.exportPdf(source, options);
      this.toast(
        'تم بنجاح',
        result === 'shared' ? 'اختر أين تحفظ الملف' : 'تم تنزيل الملف',
        'success'
      );
      return result;
    } catch (err) {
      console.error('exportPdf failed:', err);
      this.toast('تعذر تصدير الملف', err.message || 'حاول مرة أخرى', 'error');
      throw err;
    }
  },

  /* توافق خلفي مع النداءات القديمة CBS.savePdf(element, opt) */
  async savePdf(element, opt = {}) {
    return this.exportPdf(element, {
      filename: opt.filename,
      margin: typeof opt.margin === 'number' ? opt.margin : undefined,
      orientation: opt.jsPDF?.orientation,
      width: opt.html2canvas?.windowWidth
    });
  },

  /* ===== التخزين الأوفلاين للملفات =====
     التطبيق الأصلي: Capacitor Filesystem (يقرأ أوفلاين حتى للملفات عابرة الأصل).
     المتصفح/PWA: Cache API (يخدّمها service worker). طبقة موحّدة فوق الاثنين. */
  _offlineKey(url) {
    let path = url || '';
    try { path = new URL(url, location.origin).pathname; } catch (e) {}
    path = String(path).trim().replace(/\/+$/, '');
    // استخرج الامتداد الأصلي (مثل .pdf, .jpg) قبل استبدال الأحرف الخاصة
    const extMatch = path.match(/(\.[a-zA-Z0-9]{2,5})$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const base = path.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
    const cleanBase = base.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    // إذا كان الامتداد .pdf نضمن تسميته صراحةً لئلا يعامله الأندرويد كـ .bin
    const safeExt = ext === '' ? '.pdf' : ext;
    return 'off_' + cleanBase + safeExt;
  },
  _abToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000; // نتجنّب تجاوز حد المكدّس على الملفات الكبيرة
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  },
  _base64ToAb(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  },
  _offlineIndex() {
    try { return JSON.parse(localStorage.getItem('offlineFiles') || '{}'); } catch (e) { return {}; }
  },
  _offlineIndexSet(url, on) {
    const idx = this._offlineIndex();
    const path = (() => { try { return new URL(url, location.origin).pathname; } catch (e) { return url; } })();
    if (on) idx[path] = 1; else delete idx[path];
    localStorage.setItem('offlineFiles', JSON.stringify(idx));
  },

  // حفظ ملف للتصفح لاحقاً  يجب أن يكون متصلاً الآن (ينزّل الملف)
  async offlineSave(url) {
    // بلا credentials: ملفات uploads عامة، والخادم يرد ACAO:* الذي يتعارض مع credentials
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    // تحقق من نوع الملف الفعلي بقراءة البايتات الأولى (Magic Bytes)
    const magic = new Uint8Array(buf.slice(0, 5));
    const isPdf = magic[0] === 0x25 && magic[1] === 0x50 && magic[2] === 0x44 && magic[3] === 0x46; // %PDF
    const offKey = isPdf
      ? this._offlineKey(url.replace(/\.[^/.]*$/, '') + '.pdf')
      : this._offlineKey(url);
    const Filesystem = window.Capacitor?.Plugins?.Filesystem;
    if (this._isCapacitor() && Filesystem) {
      await Filesystem.writeFile({ path: offKey, data: this._abToBase64(buf), directory: 'DATA', recursive: true });
    } else {
      const cache = await caches.open('cbs-offline-files');
      await cache.put(url, new Response(buf));
    }
    this._offlineIndexSet(url, true);
    return true;
  },

  // يعيد ArrayBuffer من التخزين المحلي، أو null لو غير محفوظ
  async offlineGet(url) {
    const Filesystem = window.Capacitor?.Plugins?.Filesystem;
    try {
      if (this._isCapacitor() && Filesystem) {
        // نحاول أولاً بالامتداد .pdf (للملفات التي حفظت بعد الإصلاح)
        const pdfKey = this._offlineKey(url.replace(/\.[^/.]*$/, '') + '.pdf');
        try {
          const r = await Filesystem.readFile({ path: pdfKey, directory: 'DATA' });
          return this._base64ToAb(r.data);
        } catch (_) { /* لا يوجد بهذا المسار، جرّب المفتاح العادي */ }
        // ثم نحاول بالمفتاح العادي (ملفات محفوظة قديمة)
        const r = await Filesystem.readFile({ path: this._offlineKey(url), directory: 'DATA' });
        return this._base64ToAb(r.data);
      }
      const cache = await caches.open('cbs-offline-files');
      const hit = await cache.match(url);
      return hit ? await hit.arrayBuffer() : null;
    } catch (e) {
      return null; // غير موجود  سيحمّل من الشبكة
    }
  },

  // قائمة المسارات المحفوظة (للمؤشّر "متاح بدون نت")
  offlineList() {
    return Object.keys(this._offlineIndex());
  },

  /* ===== Dark Mode (Smart  يكتشف إعدادات النظام تلقائياً) ===== */
  initDarkMode() {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) {
      // المستخدم اختار يدوياً من قبل  احترم اختياره
      if (saved === 'true') {
        document.body.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    } else {
      // أول زيارة  اقرأ إعدادات النظام (هاتف / كمبيوتر)
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        document.body.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('darkMode', 'true');
      }
    }
    this._updateThemeIcon();
  },

  toggleDark() {
    const isDark = document.body.classList.toggle('dark');
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('darkMode', isDark);
    this._updateThemeIcon();
  },

  _updateThemeIcon() {
    // المزامنة أولاً: الصفحات التي لا تحوي زر السمة كانت تخرج قبلها
    // فيبقى شريط الحالة بلون لا يطابق التطبيق.
    this._syncStatusBarStyle();
    const icon = document.getElementById('themeIcon');
    if (!icon) return;
    const isDark = document.body.classList.contains('dark');
    icon.className = isDark ? 'ri-sun-line' : 'ri-moon-line';
  },

  /* مع "العرض حتى حافة الشاشة" ترسم أيقونات شريط الحالة فوق ترويسة التطبيق
     مباشرةً، فيجب أن يتبع لونها سمة التطبيق وإلا صارت بيضاء على ترويسة بيضاء
     (غير مرئية تماماً في الوضع الفاتح).
     نستخدم إضافة SystemBars الأصلية (مضمّنة في المشروع، بلا تبعيات)، ونقبل
     إضافة @capacitor/status-bar إن وجدت مستقبلاً. */
  _syncStatusBarStyle() {
    if (!this._isCapacitor()) return;
    const isDark = document.body.classList.contains('dark');

    const SystemBars = window.Capacitor?.Plugins?.SystemBars;
    if (SystemBars?.setAppearance) {
      // light = خلفية فاتحة ⇒ أيقونات داكنة
      SystemBars.setAppearance({ light: !isDark }).catch(() => {});
      return;
    }

    const StatusBar = window.Capacitor?.Plugins?.StatusBar;
    if (StatusBar?.setStyle) {
      // Style.Dark = خلفية داكنة => أيقونات فاتحة، والعكس
      StatusBar.setStyle({ style: isDark ? 'DARK' : 'LIGHT' }).catch(() => {});
    }
  },

  /* ===== Toast Notifications ===== */
  toast(title, body = '', type = 'info', duration = 5000) {
    // الصفحات التي نسيت <div id="toast-container"> كانت تبتلع كل الرسائل بصمت
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const icons = {
      info:      'ri-information-line',
      success:   'ri-checkbox-circle-fill',
      error:     'ri-error-warning-fill',
      warning:   'ri-alert-line',
      emergency: 'ri-alarm-warning-fill'
    };

    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.style.cursor = 'pointer';
    t.innerHTML = `
      <i class="toast-icon ${icons[type] || icons.info}"></i>
      <div style="flex:1;min-width:0">
        <div class="toast-title">${this.escapeHTML(title)}</div>
        ${body ? `<div class="toast-body">${this.escapeHTML(body)}</div>` : ''}
      </div>
      <button onclick="event.stopPropagation();this.closest('.toast').remove()" style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.5;font-size:1rem;padding:2px 4px;line-height:1;flex-shrink:0" title="إغلاق"></button>`;

    t.onclick = () => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-30px)';
      setTimeout(() => t.remove(), 300);
    };

    container.appendChild(t);

    // Trigger animation in next frame
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));

    if (duration > 0) {
      setTimeout(() => {
        if (!t.isConnected) return;
        t.classList.remove('show');
        setTimeout(() => t.remove(), 400);
      }, duration);
    }
  },

  /* ===== قراءة رد JSON مع فحص حالة HTTP =====
     كان الشائع في الصفحات: `const data = await res.json()` دون فحص res.ok،
     فيعامَل رد الخطأ ({success:false, message}) معاملة البيانات الصحيحة:
     إما تظهر "لا توجد بيانات" بدل سبب المشكلة، أو ينهار الكود عند .map()
     لأن كائن الخطأ صار هو "القائمة" في أنماط مثل (data.subjects || data).
     تستخدم داخل try/catch حتى تلتقط رسالة الخادم الحقيقية. */
  async readJson(res, fallbackMessage = 'تعذر تنفيذ الطلب') {
    let data = null;
    try { data = await res.json(); } catch (e) { /* رد غير JSON أو جسم فارغ */ }
    if (!res.ok) {
      const err = new Error(data?.message || `${fallbackMessage} (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    /* لا نعيد null أبداً عند النجاح: المستدعون يقرأون data.success مباشرةً،
       فكان رد ناجح بجسم فارغ أو غير JSON ينتج
       "Cannot read properties of null (reading 'success')" بدل رسالة مفهومة. */
    return data ?? {};
  },

  /* ===== Haptic Feedback & Physical Vibration ===== */
  haptic(type = 'light') {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    if (localStorage.getItem('hapticFeedback') === 'off') return;
    try {
      switch (type) {
        case 'light':     navigator.vibrate(12); break;
        case 'medium':    navigator.vibrate(28); break;
        case 'heavy':     navigator.vibrate(45); break;
        case 'success':   navigator.vibrate([15, 60, 20]); break;
        case 'warning':   navigator.vibrate([30, 80, 30]); break;
        case 'error':     navigator.vibrate([50, 100, 50, 100, 50]); break;
        case 'selection': navigator.vibrate(8); break;
      }
    } catch {}
  },

  initHaptics() {
    if (this._hapticsInitialized) return;
    this._hapticsInitialized = true;
    document.addEventListener('click', (e) => {
      const target = e.target.closest('.btn, button, .bottom-nav-item, .batch-card, .quiz-opt, .flashcard, .mode-toggle');
      if (target) {
        if (target.classList.contains('btn-danger') || target.dataset.action === 'delete') {
          this.haptic('warning');
        } else if (target.classList.contains('btn-success')) {
          this.haptic('success');
        } else {
          this.haptic('light');
        }
      }
    }, { passive: true });
  },

  /* اختصار برسالة واحدة: CBS.showToast('تم الحفظ', 'success'). */
  showToast(message, type = 'info', duration = 5000) {
    const alias = { danger: 'error', fail: 'error', ok: 'success' };
    const normType = alias[type] || type;
    if (normType === 'success') this.haptic('success');
    else if (normType === 'error') this.haptic('error');
    else this.haptic('light');
    return this.toast(message, '', normType, duration);
  },

  /* ===== Alerts ===== */
  showAlert(elId, message, type = 'danger') {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = `alert alert-${type} show`;
    el.innerHTML = `<i class="ri-${type === 'danger' ? 'error-warning' : type === 'success' ? 'checkbox-circle' : 'information'}-fill"></i> ${this.escapeHTML(message)}`;
  },

  hideAlert(elId) {
    const el = document.getElementById(elId);
    if (el) el.classList.remove('show');
  },

  /* ===== Modal ===== */
  modal: {
    lastFocus: null,
    trapListener: null,
    escapeListener: null
  },
  openModal(id)  {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    this.modal.lastFocus = document.activeElement;
    el.style.display = 'flex';
    el.classList.add('show');
    document.body.classList.add('modal-open');

    this.modal.escapeListener = (e) => {
      if (e.key === 'Escape') this.closeModal(id);
    };
    document.addEventListener('keydown', this.modal.escapeListener);

    const focusableElements = el.querySelectorAll('a[href], button, textarea, input:not([type="hidden"]), select, [tabindex]:not([tabindex="-1"])');
    if (focusableElements.length) {
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      this.modal.trapListener = (e) => {
        if (e.key === 'Tab') {
          if (e.shiftKey && document.activeElement === firstFocusable) {
            lastFocusable.focus();
            e.preventDefault();
          } else if (!e.shiftKey && document.activeElement === lastFocusable) {
            firstFocusable.focus();
            e.preventDefault();
          }
        }
      };
      document.addEventListener('keydown', this.modal.trapListener);
      setTimeout(() => firstFocusable.focus(), 50);
    }
  },
  formatTime(d) {
    if (!d) return '';
    try {
      return new Date(d).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  },
  closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('show');
    el.style.display = 'none';
    document.body.classList.remove('modal-open');

    if (this.modal.escapeListener) {
      document.removeEventListener('keydown', this.modal.escapeListener);
      this.modal.escapeListener = null;
    }
    if (this.modal.trapListener) {
      document.removeEventListener('keydown', this.modal.trapListener);
      this.modal.trapListener = null;
    }

    if (this.modal.lastFocus) {
      this.modal.lastFocus.focus();
      this.modal.lastFocus = null;
    }
  },
  initModalClose() {
    document.querySelectorAll('.modal-overlay, [data-modal]').forEach(overlay => {
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const title = overlay.querySelector('.modal-title, h2, h3');
      if (title) {
        if (!title.id) title.id = 'modal-title-' + Math.random().toString(36).substring(2, 9);
        overlay.setAttribute('aria-labelledby', title.id);
      }
      overlay.addEventListener('click', e => {
        if (e.target === overlay) this.closeModal(overlay.id);
      });
    });
    document.querySelectorAll('.modal-close, [data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const overlay = btn.closest('.modal-overlay');
        if (overlay) this.closeModal(overlay.id);
      });
    });
  },

  /* ===== Keyboard Suggestions & Autocomplete Enabler ===== */
  initKeyboardSuggestions() {
    const enableSuggestions = () => {
      document.querySelectorAll('input, textarea').forEach(el => {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (['password', 'hidden', 'checkbox', 'radio', 'file', 'range'].includes(type)) return;

        // Force enable text prediction and auto-completion for virtual keyboards
        if (!el.hasAttribute('autocorrect')) el.setAttribute('autocorrect', 'on');
        if (!el.hasAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'sentences');
        if (!el.hasAttribute('spellcheck') || el.getAttribute('spellcheck') === 'false') el.setAttribute('spellcheck', 'true');
        if (!el.hasAttribute('autocomplete') || el.getAttribute('autocomplete') === 'off') {
          if (type === 'email' || el.id?.includes('email')) {
            el.setAttribute('autocomplete', 'email username');
          } else {
            el.setAttribute('autocomplete', 'on');
          }
        }
      });
    };

    try {
      enableSuggestions();
      // debounce: المسح الفوري مع كل تغيير DOM كان يخنق الصفحات الكبيرة
      let pending = null;
      const observer = new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; enableSuggestions(); }, 300);
      });
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } catch(e) {
      console.warn('initKeyboardSuggestions error:', e);
    }
  },

  /* ===== Fetch Helpers ===== */
  _getHeaders(extra = {}) {
    const headers = { Authorization: 'Bearer ' + CBS.getToken(), ...extra };
    const batchId = CBS.getBatchId();
    if (batchId) headers['x-batch-id'] = batchId;
    return headers;
  },

  /* ===== Refresh Token Logic ===== */
  _isRefreshing: false,
  _refreshQueue: [],

  async _tryRefreshToken() {
    if (CBS._isRefreshing) {
      return new Promise((resolve, reject) => {
        CBS._refreshQueue.push({ resolve, reject });
      });
    }
    CBS._isRefreshing = true;
    try {
      const headers = {};
      const storedRefreshToken = localStorage.getItem('refreshToken');
      if (storedRefreshToken) {
        headers['x-refresh-token'] = storedRefreshToken;
      }
      const res = await fetch(API_BASE + '/api/auth/refresh', {
        method: 'POST',
        headers,
        credentials: 'include' // refreshToken في httpOnly cookie
      });
      if (!res.ok) throw new Error('Refresh failed');
      const data = await res.json();
      localStorage.setItem('token', data.accessToken);
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
      CBS._refreshQueue.forEach(p => p.resolve(data.accessToken));
      CBS._refreshQueue = [];
      return data.accessToken;
    } catch (err) {
      CBS._refreshQueue.forEach(p => p.reject(err));
      CBS._refreshQueue = [];
      CBS.logout(false);
      throw err;
    } finally {
      CBS._isRefreshing = false;
    }
  },

  async _fetchWithTimeout(url, options = {}) {
    const timeoutMs = options.timeout || 20000;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (document.getElementById('cbs-offline-banner') && navigator.onLine) {
        const banner = document.getElementById('cbs-offline-banner');
        if (banner) {
          banner.style.opacity = '0';
          setTimeout(() => banner.remove(), 300);
        }
      }
      return res;
    } catch (err) {
      clearTimeout(id);
      if (!navigator.onLine) {
        const error = new Error('OFFLINE');
        error.isOffline = true;
        throw error;
      }
      const error = new Error(err.name === 'AbortError' ? 'TIMEOUT' : (err.message || 'NetworkError'));
      error.isNetworkError = true;
      throw error;
    }
  },

  async apiGet(url, _retry = true) {
    // الصفحة تغادر بسبب رفض الصلاحية: لا نُطلق طلبات ستُرفض بـ403 حتماً
    if (CBS._leavingPage) return new Promise(() => {});
    let res;
    const cacheKey = 'cbs_apicache_' + url;
    try {
      res = await CBS._fetchWithTimeout(API_BASE + url, { headers: CBS._getHeaders() });
      if (res.ok) {
        res.clone().json().then(data => {
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data }));
          } catch (e) { /* storage quota */ }
        }).catch(() => {});
        return res;
      }
    } catch (err) {
      // Network failure / offline
    }

    // Try fallback from LocalStorage cache if offline or network error
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.data) {
          if (!window._offlineToastShown && !navigator.onLine) {
            window._offlineToastShown = true;
            CBS.toast('وضع بدون إنترنت', 'يتم عرض البيانات المحفوظة سابقاً', 'info');
          }
          return {
            ok: true,
            status: 200,
            json: async () => parsed.data,
            text: async () => JSON.stringify(parsed.data),
            clone: function() { return this; }
          };
        }
      } catch (e) {}
    }

    if (res) {
      if (res.status === 401 && _retry) {
        try {
          await CBS._tryRefreshToken();
          return CBS.apiGet(url, false);
        } catch { throw new Error('Unauthorized'); }
      }
      if (res.status === 401) { CBS.logout(false); throw new Error('Unauthorized'); }
      /* 400 مدرجة هنا كذلك: batch.middleware يردّ 400 لا 403 عند غياب
         الدفعة ("يرجى تحديد الدفعة أولاً")، فكان المستخدم يُترك بصفحة
         فارغة بلا رسالة ولا توجيه إلى صفحة الاختيار. */
      if (res.status === 403 || res.status === 400) {
        const onSelector = window.location.pathname === '/batch-selector.html';
        const user = CBS.getUser();
        const isLeader  = user.roles?.includes('leader');
        const isStudent = user.roles?.includes('student');
        const needsBatch = !isLeader && !isStudent && !CBS.getBatchId();
        if (!onSelector && needsBatch) {
          CBS.toast('يرجى تحديد الدفعة أولاً للوصول إلى البيانات', '', 'error');
          setTimeout(() => { location.replace('/batch-selector.html'); }, 2000);
        } else if (!onSelector && res.status === 403) {
          CBS.toast('غير مصرح لك بالوصول لهذا المحتوى أو إجراء هذه العملية في الدفعة الحالية', '', 'error');
        }
      }
      return res;
    }

    return { ok: false, status: 0, json: async () => ({}) };
  },

  async apiPost(url, body, method = 'POST', _retry = true) {
    if (CBS._leavingPage) return new Promise(() => {});
    let res;
    try {
      res = await CBS._fetchWithTimeout(API_BASE + url, {
        method,
        headers: CBS._getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        /* طلبات كيدي: الخادم يمنح السؤال حتى 50 ث ويسابق بين المزوّدين. مهلة
           20 ث الافتراضية كانت تقطع الانتظار والرد في الطريق، فيرى الطالب
           "تعذر الاتصال" ويظن أن كيدي لا يرد. */
        timeout: url.startsWith('/api/ai/') ? 75000 : undefined
      });
    } catch (err) {
      if (err.isOffline) return { ok: false, status: 0, json: async () => ({ success: false, message: 'أنت غير متصل بالإنترنت' }) };
      return { ok: false, status: 504, json: async () => ({ success: false, message: 'تعذر الاتصال بالخادم، يرجى المحاولة لاحقاً' }) };
    }
    if (res.status === 401 && _retry) {
      try {
        await CBS._tryRefreshToken();
        return CBS.apiPost(url, body, method, false);
      } catch { throw new Error('Unauthorized'); }
    }
    if (res.status === 401) { CBS.logout(false); throw new Error('Unauthorized'); }
    if (res.status === 403) { CBS.toast('غير مصرح لك بالقيام بهذا الإجراء في هذه الدفعة', '', 'error'); }
    return res;
  },

  async apiPut(url, body, _retry = true) {
    return CBS.apiPost(url, body, 'PUT', _retry);
  },

  async apiPatch(url, body, _retry = true) {
    return CBS.apiPost(url, body, 'PATCH', _retry);
  },

  async apiDelete(url, _retry = true) {
    let res;
    try {
      res = await CBS._fetchWithTimeout(API_BASE + url, {
        method: 'DELETE',
        headers: CBS._getHeaders()
      });
    } catch (err) {
      if (err.isOffline) return { ok: false, status: 0, json: async () => ({ success: false, message: 'أنت غير متصل بالإنترنت' }) };
      return { ok: false, status: 504, json: async () => ({ success: false, message: 'تعذر الاتصال بالخادم، يرجى المحاولة لاحقاً' }) };
    }
    if (res.status === 401 && _retry) {
      try {
        await CBS._tryRefreshToken();
        return CBS.apiDelete(url, false);
      } catch { throw new Error('Unauthorized'); }
    }
    if (res.status === 401) { CBS.logout(false); throw new Error('Unauthorized'); }
    return res;
  },

  /* ===== Skeleton Loaders ===== */
  skeleton(containerId, count = 3, type = 'card') {
    const el = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;
    if (!el) return;
    const templates = {
      card: `<div class="skeleton-card">
        <div class="skeleton skeleton-icon"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-line" style="width:60%;margin-bottom:8px"></div>
          <div class="skeleton skeleton-line" style="width:90%"></div>
        </div>
      </div>`,
      list: `<div class="skeleton-list-item">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-line" style="width:55%;margin-bottom:6px"></div>
          <div class="skeleton skeleton-line" style="width:80%"></div>
        </div>
      </div>`,
      stat: `<div class="skeleton" style="height:80px;border-radius:12px"></div>`
    };
    el.innerHTML = Array(count).fill(templates[type] || templates.card).join('');
  },

  /* ===================================================================
     نظام الإشعارات المحسّن  يدعم الإشعارات الحقيقية على الهاتف
     عبر Capacitor LocalNotifications مع fallback للـ toast على الويب
     =================================================================== */

  // هل الكود يعمل داخل تطبيق Capacitor؟
  _isCapacitor() {
    return typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.());
  },

  // Capacitor LocalNotifications plugin
  _getLocalNotif() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
  },

  // طلب صلاحية الإشعارات (يستدعى عند أول تشغيل)
  async requestNotifPermission() {
    const plugin = this._getLocalNotif();
    if (!plugin) return; // متصفح عادي  لا حاجة
    try {
      const { display } = await plugin.checkPermissions();
      if (display !== 'granted') {
        await plugin.requestPermissions();
      }
    } catch { /* silent */ }
  },

  // إرسال إشعار محلي حقيقي على الهاتف
  async _sendNativeNotif({ id, title, body, isEmergency = false }) {
    const plugin = this._getLocalNotif();
    if (!plugin) return false;
    try {
      await plugin.schedule({
        notifications: [{
          id:            id,
          title:         title,
          body:          body,
          smallIcon:     'ic_notification',
          iconColor:     isEmergency ? '#ef4444' : '#2563eb',
          channelId:     isEmergency ? 'cbs_emergency' : 'cbs_general',
          sound:         isEmergency ? 'cbs_emergency.wav' : 'cbs_notif.wav',
          importance:    isEmergency ? 5 : 4,
          extra:         { type: isEmergency ? 'emergency' : 'normal' }
        }]
      });
      return true;
    } catch { return false; }
  },

  /* ===== تحديث Badge الإشعارات ===== */
  async checkNotifications() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const res = await CBS.apiGet('/api/notifications/unread-count');
      if (!res || !res.ok) return;
      const { count } = await res.json();

      // Badge في الهيدر (الويب)
      const badge = document.getElementById('notifBadge');
      if (badge) {
        if (count > 0) {
          badge.textContent  = count > 9 ? '9+' : count;
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }

      // Badge شريط التنقل السفلي
      this._syncBnavBadge?.();

      // Badge أيقونة التطبيق (Capacitor Badge plugin  اختياري)
      if (this._isCapacitor() && window.Capacitor?.Plugins?.Badge) {
        try {
          if (count > 0) await window.Capacitor.Plugins.Badge.set({ count });
          else           await window.Capacitor.Plugins.Badge.clear();
        } catch { /* plugin غير مثبت */ }
      }
    } catch { /* silent */ }
  },

  /* ===== فحص الإشعارات الجديدة وإرسالها ===== */
  async checkNewNotifications() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const currentUser = this.getUser();
      const currentUserId = currentUser?.id || currentUser?._id;
      const lastCheck = parseInt(localStorage.getItem('lastNotifCheck') || '0');
      // نمرّر الدفعة الحالية للفلترة الصحيحة في السيرفر
      const batchId = this.getBatchId();
      const batchParam = batchId ? `&batch=${batchId}` : '';
      const res = await CBS.apiGet(`/api/notifications/new?lastCheck=${lastCheck}${batchParam}`);
      if (!res || !res.ok) return;
      const resData = await res.json();
      const list = Array.isArray(resData) ? resData : (resData?.data || []);
      if (!Array.isArray(list) || !list.length) return;

      const shownIds = JSON.parse(localStorage.getItem('shownNotifIds') || '[]');
      let notifCounter = parseInt(localStorage.getItem('notifIdCounter') || '1000');

      for (const n of list) {
        if (shownIds.includes(n._id)) continue;

        // لا نظه←ر إشعار للشخص الذي أنشأ الإشعار (المرس←ل لا يستقبل إشعاره بنفسه)
        const senderId = n.createdBy?._id || n.createdBy;
        if (senderId && String(senderId) === String(currentUserId)) {
          shownIds.push(n._id); // نحتفظ بالمعرف حتى لا يتكرر الفحص
          continue;
        }

        const isEmergency = n.type === 'emergency';
        const title = n.title;
        const body  = n.message;

        // ① إشعار حقيقي على الهاتف
        const sentNative = await this._sendNativeNotif({
          id:          notifCounter++,
          title,
          body,
          isEmergency
        });

        // ② Toast في التطبيق (دائماً  حتى لو على الهاتف)
        this.toast(n.title, n.message, isEmergency ? 'emergency' : 'info',
                   isEmergency ? 10000 : 6000);

        shownIds.push(n._id);
      }

      localStorage.setItem('shownNotifIds',   JSON.stringify(shownIds.slice(-100)));
      localStorage.setItem('notifIdCounter',  String(notifCounter));
      localStorage.setItem('lastNotifCheck',  String(Date.now()));
    } catch { /* silent */ }
  },

  /* ===== بدء الـ Polling ===== */
  startNotifPolling() {
    // على الموبايل polling أسرع (15 ثانية)  على الويب 30 ثانية
    const interval = this._isCapacitor() ? 15000 : 30000;

    this.checkNotifications();
    this.checkNewNotifications();

    setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      this.checkNotifications();
      this.checkNewNotifications();
    }, interval);

    // إعادة الفحص عند عودة التطبيق للواجهة (Capacitor App Resume)
    if (this._isCapacitor() && window.Capacitor?.Plugins?.App) {
      window.Capacitor.Plugins.App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          this.checkNotifications();
          this.checkNewNotifications();
        }
      });
    }

    // إعادة الفحص عند عودة الصفحة للواجهة في المتصفح
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.checkNewNotifications();
    });
  },

  /* ===== Utilities ===== */
  setYear() {
    const el = document.getElementById('year');
    if (el) el.textContent = new Date().getFullYear();
  },

  formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' }) +
           '  ' +
           d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
  },

  // ملاحظة: showLoading معرّفة أسفل الملف (نسخة الهيكل العظمي/skeleton)  كان هناك
  // تعريفان لنفس المفتاح فيطغى الأخير على الأول ويصبح هذا الأول شيفرة ميتة.

  showEmpty(containerId, msg = 'لا توجد بيانات', icon = 'ri-inbox-line') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="empty-state">
        <i class="${icon}"></i>
        <p>${msg}</p>
      </div>`;
  },

  roleLabel(role) {
    const map = { student: 'طالب', doctor: 'دكتور', leader: 'ليدر', dean: 'عميد', admin: 'مسؤول النظام' };
    return map[role] || role;
  },

  roleBadgeClass(role) {
    const map = { student: 'primary', doctor: 'accent', leader: 'success', dean: 'danger', admin: 'danger' };
    return 'badge badge-' + (map[role] || 'primary');
  },

  /* ===== Batch Switcher ===== */
  async renderBatchSwitcher() {
    const user = this.getUser();
    // يظهر فقط للعميد والدكاترة  الليدر والطالب دفعتهم ثابتة
    /* "admin" كان مفقوداً هنا، فلا يستطيع المسؤول اختيار دفعة إطلاقاً بينما
       batch.middleware يردّ 400 "يرجى تحديد الدفعة" على كل مسار مرتبط
       بدفعة — طريق مسدود بلا رسالة ولا حل. */
    const canSwitch = user && user.roles &&
      (user.roles.includes('dean') || user.roles.includes('admin') || user.roles.includes('doctor'));
    if (!canSwitch) return;

    // لا يظهر في صفحات الإعداد
    /* صفحات الإعداد + الصفحات على مستوى الكلية أو الشخصية: شريط "سياق الدفعة"
       فيها ضجيج (يظهر "لم يتم تحديد دفعة" فوق صفحة لا علاقة لها بدفعة) */
    const skip = ['/login.html', '/forgot-password.html', '/batch-selector.html',
                  '/force-change-password.html', '/reset-code.html', '/new-password.html',
                  '/admin_dashboard.html', '/manage-users.html', '/manage-batches.html',
                  '/manage-subjects.html', '/pending-registrations.html', '/moderation.html',
                  '/admin-content.html', '/financials.html', '/profile.html', '/notifications.html',
                  '/student-portfolio.html', '/code-lab.html', '/privacy.html'];
    if (skip.some(p => window.location.pathname === p)) return;

    const pageContent = document.querySelector('.page-content');
    if (!pageContent) return;

    // منع التكرار
    if (document.getElementById('batchSwitcherWrap')) return;

    try {
      const res = await fetch(API_BASE + '/api/batches?status=active', {
        headers: { Authorization: 'Bearer ' + this.getToken() }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !data.batches || data.batches.length === 0) return;

      const batches = data.batches;
      const currentBatchId = this.getBatchId();
      const currentBatch = batches.find(b => b._id === currentBatchId);

      // ===== الشريط الرئيسي (فوق البانر) =====
      const wrap = document.createElement('div');
      wrap.className = 'inline-batch-wrap';
      wrap.id = 'batchSwitcherWrap';

      const btn = document.createElement('button');
      btn.className = 'inline-batch-btn';
      btn.id = 'batchSwitcherBtn';
      btn.setAttribute('title', 'تبديل الدفعة');

      const dotColor = currentBatch?.themeColor || 'var(--primary)';
      btn.innerHTML = `
        <div class="inline-batch-info">
          <span class="inline-batch-dot" id="bsdDot" style="background:${dotColor}"></span>
          <div class="inline-batch-text">
            <span class="inline-batch-label">سياق الدفعة الحالية</span>
            <span class="inline-batch-name" id="bsdName">${currentBatch ? this.escapeHTML(currentBatch.name) : 'لم يتم تحديد دفعة'}</span>
          </div>
        </div>
        <div class="inline-batch-action">
          <span>تبديل</span>
          <i class="ri-arrow-down-s-line" id="bsdChevron"></i>
        </div>`;

      wrap.appendChild(btn);
      // الصفحة الرئيسية تخصص له مكاناً كشريحة بجانب الدور (data-batch-slot)
      const slot = document.querySelector('[data-batch-slot]');
      if (slot) slot.appendChild(wrap);
      else pageContent.insertBefore(wrap, document.querySelector('.welcome-banner') || pageContent.firstChild);

      // ===== الـ Dropdown  يلحق بـ body مباشرةً لتجنب stacking context =====
      const dropdown = document.createElement('div');
      dropdown.className = 'batch-switcher-dropdown';
      dropdown.id = 'bsdDropdown';
      dropdown.style.position = 'fixed'; // fixed بدل absolute  مستقل عن الهيدر
      document.body.appendChild(dropdown);

      dropdown.innerHTML = `
        <div class="bsd-header">
          <i class="ri-team-line"></i>
          <span class="bsd-header-text">الدفعات المتاحة</span>
        </div>
        <div class="bsd-list" id="bsdList"></div>
        <div class="bsd-footer">
          <button class="bsd-footer-btn" id="bsdManageBtn">
            <i class="ri-layout-grid-line"></i>
            <span>إدارة الدفعات</span>
          </button>
        </div>`;

      document.getElementById('bsdManageBtn').onclick = () => CBS._bsdGoToSelector();

      const list = dropdown.querySelector('#bsdList');
      const icons = ['ri-graduation-cap-line', 'ri-book-2-line', 'ri-flask-line',
                     'ri-cpu-line', 'ri-code-line', 'ri-database-2-line'];

      batches.forEach((b, i) => {
        const isActive = b._id === currentBatchId;
        const color = b.themeColor || '#2563eb';
        const icon = icons[i % icons.length];

        const item = document.createElement('button');
        item.className = 'bsd-item' + (isActive ? ' active' : '');
        item.dataset.batchId = b._id;
        item.innerHTML = `
          <div class="bsd-item-color" style="background:${color}18; color:${color}">
            <i class="${icon}"></i>
          </div>
          <div class="bsd-item-info">
            <div class="bsd-item-name">${CBS.escapeHTML(b.name)}</div>
            <div class="bsd-item-meta">${CBS.escapeHTML(b.code || '')}</div>
          </div>
          <i class="ri-check-line bsd-check"></i>`;

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          CBS._bsdSwitchBatch(b._id, b.name, color);
        });
        list.appendChild(item);
      });

      // ===== فتح/إغلاق بـ document listener (لا overlay) =====
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        CBS._bsdToggle();
      });

      // إغلاق عند الضغط خارج الـ dropdown
      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
          CBS._bsdClose();
        }
      });

      // إغلاق بـ Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') CBS._bsdClose();
      });

    } catch (e) {
      console.error('Batch switcher error:', e);
    }
  },

  _bsdPositionDropdown() {
    const btn  = document.getElementById('batchSwitcherBtn');
    const drop = document.getElementById('bsdDropdown');
    if (!btn || !drop) return;

    const rect = btn.getBoundingClientRect();
    // بما أن الزر أصبح شريطاً عريضاً، سنجعل الـ Dropdown بنفس عرضه تقريباً
    const dropW = Math.max(280, Math.min(rect.width, 400)); // عرض بين 280 و 400

    // المحاذاة في المنتصف بالنسبة للزر
    const centerX = rect.left + (rect.width / 2);
    let left = centerX - (dropW / 2);
    
    // منع الخروج عن الشاشة
    if (left < 10) left = 10;
    if (left + dropW > window.innerWidth - 10) left = window.innerWidth - dropW - 10;

    drop.style.left  = left + 'px';
    drop.style.right = 'auto';
    drop.style.top = (rect.bottom + 8) + 'px';
    drop.style.minWidth = dropW + 'px';
  },

  _bsdToggle() {
    const dropdown = document.getElementById('bsdDropdown');
    const btn = document.getElementById('batchSwitcherBtn');
    if (!dropdown) return;

    const isOpen = dropdown.classList.contains('show');
    if (isOpen) {
      this._bsdClose();
    } else {
      this._bsdPositionDropdown();
      btn.classList.add('open');
      dropdown.classList.add('show');
    }
  },

  _bsdClose() {
    const btn = document.getElementById('batchSwitcherBtn');
    const dropdown = document.getElementById('bsdDropdown');
    if (btn) btn.classList.remove('open');
    if (dropdown) dropdown.classList.remove('show');
  },

  _bsdSwitchBatch(batchId, batchName, color) {
    if (!batchId || batchId === 'undefined' || batchId === 'null' || batchId === '[object Object]') {
      this.toast('معرف الدفعة غير صالح', '', 'error');
      return;
    }
    if (color) localStorage.setItem('cbs_active_batch_color', color);
    localStorage.setItem('cbs_active_batch_id', batchId);
    this._bsdClose();

    // تحديث الزر فوراً
    const dot  = document.getElementById('bsdDot');
    const name = document.getElementById('bsdName');
    if (dot)  dot.style.background = color;
    if (name) name.textContent = batchName;

    // تحديث active class
    document.querySelectorAll('.bsd-item').forEach(item => {
      item.classList.toggle('active', item.dataset.batchId === batchId);
    });

    // الانتقال للصفحة الحالية مع الدفعة الجديدة
    const url = new URL(window.location.href);
    url.searchParams.set('batch', batchId);
    
    // للمدير، إذا كان في شاشة admin_dashboard يجب أن يبقى فيها ولا يذهب إلى الداشبورد
    window.location.href = url.toString();
  },

  _bsdGoToSelector() {
    this._bsdClose();
    window.location.href = '/batch-selector.html';
  },

  /* ===== Home Navigation ===== */
  goHome() {
    const user = this.getUser();
    const batchId = this.getBatchId();

    // إذا كان عميداً أو مسؤولاً ولم يكن داخل سياق دفعة، عد به للوحة الإدارة العامة
    if (this.isAdminLevel(user) && !batchId) {
      window.location.href = '/admin_dashboard.html';
      return;
    }

    // لغير العميد أو للعميد داخل دفعة، اذهب للوحة الدفعة (dashboard)
    window.location.href = '/dashboard.html' + (batchId ? '?batch=' + batchId : '');
  },
  /* ===== Back Navigation ===== */
  goBack() {
    if (history.length > 1) {
      history.back();
    } else {
      window.location.href = '/dashboard.html';
    }
  },

  /* ===== Scroll Entrance Animations ===== */
  initScrollAnimations() {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    const attach = () => {
      document.querySelectorAll('.dash-card, .stat-item, .card, .notif-card').forEach(el => {
        if (!el.dataset.animated) {
          el.dataset.animated = 'true';
          observer.observe(el);
        }
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attach);
    } else {
      attach();
    }
  },

  /* ===== Global Search ===== */
  _initGlobalSearch() {
    if (!this.getToken()) return;
    // Create overlay once
    if (!document.getElementById('global-search-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'global-search-overlay';
      overlay.innerHTML = `
        <div id="global-search-box">
          <div id="global-search-header">
            <i class="ri-search-line" style="font-size:1.4rem;color:var(--primary)"></i>
            <input id="global-search-input" type="text" placeholder="ابحث  ي المواد، الواجبات، الإشعارات..." dir="rtl" autocomplete="off">
            <button onclick="CBS.closeSearch()" style="background:none;border:none;cursor:pointer;font-size:1.4rem;color:var(--text-muted)"><i class="ri-close-line"></i></button>
          </div>
          <div id="global-search-results"><div class="search-no-results"><i class="ri-search-2-line" style="font-size:2rem;display:block;margin-bottom:8px"></i>اكتب للبحث...</div></div>
        </div>`;
      overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeSearch(); });
      document.body.appendChild(overlay);
      let _debounce = null;
      document.getElementById('global-search-input').addEventListener('input', (e) => {
        clearTimeout(_debounce);
        const q = e.target.value.trim();
        if (q.length < 2) { document.getElementById('global-search-results').innerHTML = '<div class="search-no-results"><i class="ri-search-2-line" style="font-size:2rem;display:block;margin-bottom:8px"></i>اكتب للبحث...</div>'; return; }
        _debounce = setTimeout(() => CBS._runSearch(q), 400);
      });
    }
    /* زر البحث في الترويسة — مرة واحدة فقط. صفحات كثيرة (الرئيسية مثلاً) فيها
       زر بحث خاص بها، فكان يظهر زران متطابقان ويُدفع الثاني خارج الشاشة على
       الهواتف الصغيرة لأنه أُلحق بحافة الترويسة خارج مجموعة الأزرار. */
    const header = document.querySelector('.main-header');
    const hasSearch = header && header.querySelector('.search-open-btn, #headerSearchBtn, [onclick*="openSearch"]');
    if (header && !hasSearch) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-icon search-open-btn';
      btn.title = 'بحث';
      btn.setAttribute('aria-label', 'بحث');
      btn.innerHTML = '<i class="ri-search-line"></i>';
      btn.onclick = () => CBS.openSearch();
      const actions = header.querySelector('.header-actions');
      if (actions) actions.prepend(btn); else header.appendChild(btn);
    }
  },

  async _runSearch(q) {
    const resultsEl = document.getElementById('global-search-results');
    resultsEl.innerHTML = '<div class="search-no-results"><div class="spinner spinner-dark" style="margin:0 auto"></div></div>';
    try {
      const res = await this.apiGet('/api/search?q=' + encodeURIComponent(q));
      if (!res.ok) {
        resultsEl.innerHTML = '<div class="search-no-results">حدث خطأ في البحث</div>';
        return;
      }
      const resJson = await res.json();
      const results = resJson.data?.results || resJson.results || {};
      
      const groups = [
        { key: 'subjects',      label: 'المواد الدراسية',     icon: 'ri-book-2-line' },
        { key: 'assignments',   label: 'الواجبات والتكاليف',   icon: 'ri-task-line' },
        { key: 'notifications', label: 'الإشعارات والتنبيهات', icon: 'ri-notification-3-line' },
        { key: 'users',         label: 'المستخدمون',         icon: 'ri-user-3-line' },
      ];
      let html = '';
      let found = false;
      groups.forEach(g => {
        const items = results[g.key] || [];
        if (!items.length) return;
        found = true;
        html += `<div class="search-result-group"><div class="search-result-group-title">${g.label}</div>`;
        items.forEach(item => {
          // العناوين تأتي من محتوى أنشأه مستخدمون  يجب تعقيمها قبل الحقن (XSS)
          const safeUrl = /^\/[^\s'"<>]*$/.test(item.url || '') ? item.url : '#';
          html += `<div class="search-result-item" data-url="${CBS.escapeHTML(safeUrl)}"><i class="${g.icon}"></i><div style="display:flex;flex-direction:column;gap:2px"><span>${CBS.escapeHTML(item.title)}</span><small style="font-size:0.75rem;color:var(--text-muted)">${CBS.escapeHTML(item.subtitle || '')}</small></div></div>`;
        });
        html += '</div>';
      });
      resultsEl.innerHTML = found ? html : `<div class="search-no-results">لا توجد نتائج لـ &ldquo;${CBS.escapeHTML(q)}&rdquo;</div>`;
      resultsEl.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
          CBS.closeSearch();
          const url = el.dataset.url;
          if (url && url !== '#') location.href = url;
        });
      });
    } catch {
      resultsEl.innerHTML = '<div class="search-no-results">حدث خطأ في البحث</div>';
    }
  },

  openSearch() {
    const overlay = document.getElementById('global-search-overlay');
    if (!overlay) { this._initGlobalSearch(); return; }
    overlay.classList.add('open');
    setTimeout(() => document.getElementById('global-search-input')?.focus(), 100);
  },

  closeSearch() {
    const overlay = document.getElementById('global-search-overlay');
    if (overlay) overlay.classList.remove('open');
  },

  /* تبويبات شريط التنقل حسب الدور.
     مفصولة عن الرسم لأن زر الرجوع يحتاجها أيضاً حتى على الشاشات الكبيرة
     حيث لا يُرسم الشريط أصلاً. */
  _navItemsForRole() {
    const user = this.getUser();
    if (!user || !user.roles) return [];

    const batchId     = this.getBatchId();
    const bp          = batchId ? `?batch=${batchId}` : '';
    const primaryRole = this.getPrimaryRole(user);

    /* خمسة تبويبات كحد أقصى: بستة كانت التسميات تُقصّ ("المستخد...") والأهداف
       تضيق. ما خرج من الشريط موجود في "الوصول السريع" بالصفحة الرئيسية
       (الرسوم للطالب، إرسال الإشعار للطاقم...). docs/design/home-screens.md */
    let items = [];
    if (primaryRole === 'student') {
      items = [
        { href: `/dashboard.html${bp}`,              icon: 'ri-home-5-line',         label: 'الرئيسية' },
        { href: `/subjects.html${bp}`,               icon: 'ri-book-2-line',         label: 'المواد' },
        { href: `/calendar.html${bp}`,               icon: 'ri-calendar-todo-line',  label: 'التقويم' },
        { href: `/notifications.html${bp}`,          icon: 'ri-notification-3-line', label: 'التنبيهات', badge: true },
        { href: `/profile.html${bp}`,                icon: 'ri-user-3-line',         label: 'حسابي' },
      ];
    } else if (primaryRole === 'leader') {
      /* الليدر طالب قبل أن يكون مسؤولاً: المواد والتنبيهات كأي طالب، والحضور
         لأنه يرصده يومياً. رفع المحاضرات والرسوم في الوصول السريع. */
      items = [
        { href: `/dashboard.html${bp}`,              icon: 'ri-home-5-line',         label: 'الرئيسية' },
        { href: `/subjects.html${bp}`,               icon: 'ri-book-2-line',         label: 'المواد' },
        { href: `/manage-attendance.html${bp}`,      icon: 'ri-calendar-check-line', label: 'الحضور' },
        { href: `/notifications.html${bp}`,          icon: 'ri-notification-3-line', label: 'التنبيهات', badge: true },
        { href: `/profile.html${bp}`,                icon: 'ri-user-3-line',         label: 'حسابي' },
      ];
    } else if (primaryRole === 'doctor') {
      // التنبيهات الواردة من جرس الترويسة، وإرسال إشعار من الوصول السريع
      items = [
        { href: `/dashboard.html${bp}`,              icon: 'ri-home-5-line',        label: 'الرئيسية' },
        { href: `/manage-lectures.html${bp}`,        icon: 'ri-video-line',         label: 'المحاضرات' },
        { href: `/manage-attendance.html${bp}`,      icon: 'ri-calendar-check-line', label: 'الحضور' },
        { href: `/quizzes.html${bp}`,                icon: 'ri-question-answer-line', label: 'الاختبارات' },
        { href: `/profile.html${bp}`,                icon: 'ri-user-3-line',        label: 'حسابي' },
      ];
    } else if (primaryRole === 'dean' || primaryRole === 'admin') {
      items = [
        { href: `/admin_dashboard.html`,             icon: 'ri-home-5-line',        label: 'الرئيسية' },
        { href: `/manage-users.html${bp}`,           icon: 'ri-group-line',         label: 'المستخدمون' },
        { href: `/manage-batches.html`,              icon: 'ri-layout-grid-line',   label: 'الدفعات' },
        { href: `/financials.html${bp}`,             icon: 'ri-money-dollar-circle-line', label: 'الرسوم' },
        { href: `/profile.html${bp}`,                icon: 'ri-user-3-line',        label: 'حسابي' },
      ];
    }

    // نسجّل مسارات التبويبات الفعلية لهذا الدور ليعتمد عليها زر الرجوع.
    // كانت قائمة "الصفحات الجذرية" ثابتة بينما التبويبات تتغير بالدور، فصفحات
    // مثل assignments للطالب أو manage-lectures للعميد تُحرم من زر الرجوع
    // رغم أنها ليست تبويباً لديه — فتصبح طريقاً مسدوداً.
    this._bottomNavPaths = items.map(i => i.href.split('?')[0]);
    return items;
  },

  /* ===== Mobile: Bottom Navigation Bar ===== */
  renderBottomNav() {
    if (document.getElementById('bottom-nav')) return;
    const cur   = window.location.pathname;
    const items = this._navItemsForRole();
    if (!items.length) return;

    const nav = document.createElement('nav');
    nav.id = 'bottom-nav';
    items.forEach(item => {
      const isActive = cur === item.href.split('?')[0];
      const a = document.createElement('a');
      a.href = item.href;
      a.className = `bnav-item${isActive ? ' active' : ''}`;
      a.innerHTML = `
        <i class="${item.icon}"></i>
        <span>${item.label}</span>
        ${item.badge ? '<span class="bnav-badge" id="bnavNotifBadge" style="display:none"></span>' : ''}
      `;
      nav.appendChild(a);
    });
    document.body.appendChild(nav);
    /* مع "العرض حتى حافة الشاشة" في أندرويد 15 يجب إضافة ارتفاع شريط
       الإيماءات، وإلا اختفى آخر سطر من المحتوى خلف الشريط السفلي.
       الرقم يأتي من --floating-chrome لا من ثابت مكتوب هنا: كان 70px
       بينما الطبقات العائمة تشغل 150px فعلياً، فيختفي الفوتر خلفها. */
    document.body.style.paddingBottom =
      'calc(var(--floating-chrome, 150px) + env(safe-area-inset-bottom, 0px))';
    this._syncBnavBadge();
    this.renderGlobalKedyAI();
  },

  formatAiResponse(text) {
    if (!text) return '';
    let str = String(text).trim().replace(/[\uFFFD\uFFFE\uFFFF]/g, '');
    // Clear raw bot markers
    str = str.replace(/^\*\*\s*\(?Kedy\)?\s*\*\*/gi, '');
    str = str.replace(/^Kedy:\s*/gi, '');

    /* رد النموذج نص غير موثوق (قد يحمل HTML من محتوى محاضرة أو سؤال مُتلاعب به)
       ويُدرج عبر innerHTML. كانت الأكواد وحدها تُهرَّب، وبقية النص تُدرج كما هي
       — أي حقن HTML/سكربت داخل جلسة الطالب. الآن: نعزل كتل الأكواد أولاً، نهرّب
       كل النص، ثم نطبق التنسيق ونعيد الأكواد. */
    const codeBlocks = [];
    str = str.replace(/```([a-z0-9_+-]*)\n([\s\S]*?)```/gi, (match, lang, code) => {
      const codeId = 'code_' + Math.random().toString(36).substring(2, 8);
      codeBlocks.push(`<div style="background:#0f172a;color:#f8fafc;border-radius:12px;padding:12px;margin:10px 0;font-family:monospace;direction:ltr;text-align:left;position:relative;overflow-x:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid #334155;padding-bottom:4px;">
          <span style="font-size:0.75rem;color:#94a3b8;font-weight:700;">${this.escapeHTML(lang || 'code')}</span>
          <button onclick="CBS._copyCodeText('${codeId}')" style="background:#334155;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:0.72rem;cursor:pointer;"><i class="ri-file-copy-line"></i> نسخ الكود</button>
        </div>
        <pre id="${codeId}" style="margin:0;font-size:0.83rem;line-height:1.5;">${this.escapeHTML(code.trim())}</pre>
      </div>`);
      return `\u0000CODE${codeBlocks.length - 1}\u0000`;
    });
    str = this.escapeHTML(str);
    // الكود المضمّن `x` يبقى نصاً مهرَّباً داخل <code>
    str = str.replace(/`([^`\n]+)`/g, '<code style="background:var(--bg-hover,#f1f5f9);padding:1px 5px;border-radius:5px;font-size:0.85em;direction:ltr;unicode-bidi:isolate;">$1</code>');

    // Math Equation Conversions
    str = str.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '<span class="ai-math-frac" style="font-weight:700;color:#4f46e5;"><span class="num">$1</span>&frasl;<span class="den">$2</span></span>');
    str = str.replace(/\\sqrt\{([^}]+)\}/g, '√($1)');
    str = str.replace(/\\int/g, '∫').replace(/\\sum/g, '∑').replace(/\\lim/g, 'lim');
    // كان ^n يُستبدل بحرف «ف» العربي — تشويه واضح لأي أُسّ رمزي مثل x^n
    str = str.replace(/\^2/g, '²').replace(/\^3/g, '³').replace(/\^n\b/g, 'ⁿ');
    str = str.replace(/\\rightarrow/g, '→').replace(/\\leftarrow/g, '←').replace(/\\infty/g, '∞');

    // Bold
    str = str.replace(/\*\*([^*]+)\*\*/g, '<strong class="ai-bold" style="color:#4f46e5;">$1</strong>');
    
    // Headings
    str = str.replace(/^### (.*$)/gim, '<h4 style="font-size:0.95rem;font-weight:800;margin:10px 0 4px;color:var(--text-main);">$1</h4>');
    str = str.replace(/^## (.*$)/gim, '<h3 style="font-size:1.05rem;font-weight:800;margin:12px 0 6px;color:#4f46e5;">$1</h3>');

    // Lists
    str = str.replace(/^\* (.*$)/gim, '<li style="margin-right:16px;margin-bottom:4px;">$1</li>');
    str = str.replace(/^- (.*$)/gim, '<li style="margin-right:16px;margin-bottom:4px;">$1</li>');

    // Newlines
    str = str.replace(/\n/g, '<br>');
    // إعادة كتل الأكواد المعزولة (مهرّبة سلفاً)
    str = str.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => codeBlocks[Number(i)] || '');
    return str;
  },

  _copyCodeText(id) {
    const el = document.getElementById(id);
    if (el) {
      navigator.clipboard.writeText(el.textContent);
      this.toast('تم نسخ الكود بنجاح', '', 'success');
    }
  },

  _copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.toast('تم نسخ النص بنجاح', '', 'success');
    }
  },

  /* ===== Global Kedy AI Floating Assistant (All pages except Assignments) ===== */
  renderGlobalKedyAI() {
    if (!this.getToken()) return;
    const curPath = window.location.pathname.toLowerCase();
    
    // منع استدعاء كيدي في صفحات الواجبات والتكاليف تجنباً للغش
    const isAssignmentPage = ['/assignments.html', '/submit-assignment.html', '/manage-submissions.html'].some(p => curPath.endsWith(p));
    if (isAssignmentPage) document.getElementById('globalKedyModal')?.remove();

    if (document.getElementById('globalKedyFab')) return;

    // Inject styles
    if (!document.getElementById('kedyGlobalStyle')) {
      const st = document.createElement('style');
      st.id = 'kedyGlobalStyle';
      st.textContent = `
        /* ===== زر كيدي (2026-10-24) =====
           دائرة بشعار فقاعة لها عينان ترمشان — شخصية المساعد لا أيقونة عامة.
           تفاعل: لمسة تفتح المحادثة، ضغطة مطوّلة تفتح اختصارات، سحب أفقي ينقله
           للجهة الأخرى (يُحفظ)، يختفي أثناء التمرير للأسفل ويعود عند الصعود،
           تلميح بحسب الصفحة، ونقطة حين يصل رد والمحادثة مغلقة. */
        .kedy-global-fab {
          /* الموضع مشتق من --fab-bottom في نظام التصميم، فيتحرّك تلقائياً
             إن تغيّر ارتفاع الشريط السفلي بدل أن يتخلّف عنه. */
          --kf-x: 0px;
          position: fixed; bottom: calc(var(--fab-bottom, 106px) + env(safe-area-inset-bottom, 0px));
          left: 16px; z-index: 8000;
          width: 58px; height: 58px; padding: 0; border: none; border-radius: 50%;
          background: var(--primary, #4F46E5); color: #fff; cursor: pointer;
          display: grid; place-items: center;
          box-shadow: 0 10px 24px -8px rgba(var(--primary-rgb, 79, 70, 229), 0.65), 0 2px 6px rgba(15, 23, 42, 0.18);
          transform: translateX(var(--kf-x));
          transition: transform var(--dur-sheet, 420ms) var(--ease-out, ease), opacity var(--dur-state, 200ms) ease, box-shadow var(--dur-state, 200ms) ease;
          touch-action: pan-y; -webkit-tap-highlight-color: transparent; user-select: none;
          animation: kfEnter 520ms var(--ease-spring, ease) 300ms backwards;
        }
        .kedy-global-fab.kf-right { left: auto; right: 16px; }
        .kedy-global-fab:hover { box-shadow: 0 14px 30px -8px rgba(var(--primary-rgb, 79, 70, 229), 0.8), 0 2px 6px rgba(15, 23, 42, 0.2); }
        .kedy-global-fab:focus-visible { outline: 3px solid var(--primary, #4F46E5); outline-offset: 3px; }
        .kedy-global-fab.kf-pressed { transform: translateX(var(--kf-x)) scale(0.9); transition-duration: var(--dur-press, 120ms); }
        .kedy-global-fab.kf-dragging { transition: none; box-shadow: 0 18px 36px -10px rgba(15, 23, 42, 0.45); }
        .kedy-global-fab.kf-hidden { transform: translateX(var(--kf-x)) translateY(140%); opacity: 0; pointer-events: none; }
        .kedy-global-fab svg { width: 30px; height: 30px; overflow: visible; }
        .kf-eyes ellipse { fill: var(--primary, #4F46E5); }
        .kf-eyes { transform-box: fill-box; transform-origin: center; animation: kfBlink 5.2s infinite; }
        .kf-spark { transform-box: fill-box; transform-origin: center; animation: kfTwinkle 3.4s var(--ease-in-out, ease) infinite; }
        .kedy-global-fab.is-thinking .kf-eyes { animation: kfLook 1.1s var(--ease-in-out, ease) infinite; }
        .kf-ring {
          position: absolute; inset: 0; border-radius: 50%;
          border: 2px solid var(--primary, #4F46E5); opacity: 0; pointer-events: none;
        }
        .kedy-global-fab.kf-ping .kf-ring { animation: kfPing 1.6s var(--ease-out, ease) 2; }
        .kf-dot {
          position: absolute; top: 2px; right: 2px; width: 13px; height: 13px; border-radius: 50%;
          background: #F59E0B; border: 2.5px solid var(--bg-card, #fff);
          transform: scale(0); transition: transform var(--dur-enter, 320ms) var(--ease-spring, ease);
        }
        .kedy-global-fab.has-reply .kf-dot { transform: scale(1); }
        /* فشل الرد والمحادثة مغلقة: النقطة حمراء بدل الكهرماني */
        .kedy-global-fab.has-error .kf-dot { transform: scale(1); background: var(--danger-solid, #E11D48); }
        /* ينتظر رد كيدي والمحادثة مغلقة: حلقة متقطعة تدور */
        .kedy-global-fab.is-thinking .kf-ring { opacity: 0.7; border-style: dashed; border-color: rgba(255,255,255,0.85); inset: 4px; animation: spin 2.4s linear infinite; }
        /* بلا اتصال: خافت ورمادي */
        .kedy-global-fab.kf-offline { background: #94A3B8; box-shadow: none; }
        .kedy-global-fab.kf-offline .kf-eyes ellipse { fill: #94A3B8; }
        .kedy-global-fab.kf-offline .kf-spark { display: none; }
        /* صفحات الواجبات: متوقف بقفل */
        .kedy-global-fab.kf-locked { background: var(--bg-card, #fff); border: 1.5px solid var(--border, #e2e8f0) !important; box-shadow: 0 6px 16px -8px rgba(15,23,42,0.35); }
        .kedy-global-fab.kf-locked path:first-child { fill: var(--text-muted, #94a3b8); }
        .kedy-global-fab.kf-locked .kf-eyes ellipse { fill: var(--bg-card, #fff); }
        .kedy-global-fab.kf-locked .kf-spark, .kedy-global-fab.kf-locked .kf-eyes { animation: none; }
        .kedy-global-fab.kf-locked .kf-spark { display: none; }
        .kf-lock { position: absolute; bottom: -2px; right: -2px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--text-main, #0f172a); color: var(--bg-card, #fff); font-size: 0.72rem; border: 2px solid var(--bg-main, #f8fafc); }
        @keyframes kfEnter { from { opacity: 0; transform: translateX(var(--kf-x)) scale(0.4) rotate(-20deg); } }
        @keyframes kfBlink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); } }
        @keyframes kfTwinkle { 0%, 100% { transform: scale(1) rotate(0); opacity: 1; } 50% { transform: scale(0.6) rotate(45deg); opacity: 0.7; } }
        @keyframes kfLook { 0%, 100% { transform: translateX(-1.2px); } 50% { transform: translateX(1.2px); } }
        @keyframes kfPing { 0% { transform: scale(1); opacity: 0.55; } 100% { transform: scale(1.7); opacity: 0; } }

        /* التلميح بجانب الزر */
        .kf-tip {
          position: fixed; z-index: 7999; max-width: min(240px, calc(100vw - 110px));
          bottom: calc(var(--fab-bottom, 106px) + env(safe-area-inset-bottom, 0px) + 9px);
          left: 86px; padding: 10px 14px; border-radius: 16px 16px 16px 4px;
          background: var(--bg-card, #fff); color: var(--text-main, #0f172a);
          border: 1px solid var(--border, #e2e8f0); box-shadow: 0 12px 28px -10px rgba(15, 23, 42, 0.35);
          font-size: 0.82rem; font-weight: 700; line-height: 1.5; cursor: pointer;
          opacity: 0; transform: translateY(6px) scale(0.96); transform-origin: bottom left; pointer-events: none;
          transition: opacity var(--dur-state, 200ms) ease, transform var(--dur-enter, 320ms) var(--ease-out, ease);
        }
        .kf-tip.kf-right { left: auto; right: 86px; border-radius: 16px 16px 4px 16px; transform-origin: bottom right; }
        .kf-tip.show { opacity: 1; transform: none; pointer-events: auto; }

        /* اختصارات الضغطة المطوّلة */
        .kf-menu {
          position: fixed; z-index: 8001; left: 16px; display: flex; flex-direction: column; gap: 8px;
          bottom: calc(var(--fab-bottom, 106px) + env(safe-area-inset-bottom, 0px) + 70px);
          pointer-events: none;
        }
        .kf-menu.kf-right { left: auto; right: 16px; align-items: flex-end; }
        .kf-menu button {
          display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 999px;
          background: var(--bg-card, #fff); color: var(--text-main, #0f172a); border: 1px solid var(--border, #e2e8f0);
          font-family: inherit; font-size: 0.82rem; font-weight: 700; cursor: pointer; white-space: nowrap;
          box-shadow: 0 10px 24px -10px rgba(15, 23, 42, 0.4);
          opacity: 0; transform: translateY(12px) scale(0.9);
          transition: opacity var(--dur-state, 200ms) ease, transform var(--dur-enter, 320ms) var(--ease-spring, ease);
        }
        .kf-menu button i { color: var(--primary-text, var(--primary)); font-size: 1rem; }
        .kf-menu.open { pointer-events: auto; }
        .kf-menu.open button { opacity: 1; transform: none; }
        .kf-menu.open button:nth-child(2) { transition-delay: 40ms; }
        .kf-menu.open button:nth-child(3) { transition-delay: 80ms; }
        .kf-scrim { position: fixed; inset: 0; z-index: 8000; background: rgba(15, 23, 42, 0.28); opacity: 0; pointer-events: none; transition: opacity var(--dur-state, 200ms) ease; }
        .kf-scrim.open { opacity: 1; pointer-events: auto; }
        [data-theme="dark"] .kf-scrim { background: rgba(0, 0, 0, 0.55); }
        [data-theme="dark"] .kf-menu button { background: #1f2937; border-color: rgba(255,255,255,0.12); }
        body.modal-open .kf-tip, body.cbs-keyboard-open .kf-tip { display: none !important; }
        @media (prefers-reduced-motion: reduce) {
          .kedy-global-fab, .kf-eyes, .kf-spark, .kf-ring, .kf-tip, .kf-menu button { animation: none !important; transition: none !important; }
        }
        /* الرسائل تنزلق إلى مكانها، ومؤشر الكتابة ثلاث نقاط تتموّج */
        .kedy-msg-user, .kedy-msg-bot { animation: cbsRise var(--dur-enter, 320ms) var(--ease-out, ease) backwards; }
        .kedy-typing { display: inline-flex; gap: 4px; align-items: center; height: 18px; vertical-align: middle; }
        .kedy-typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted, #94a3b8); animation: kedyDot 1.1s var(--ease-in-out, ease) infinite; }
        .kedy-typing i:nth-child(2) { animation-delay: 0.15s; }
        .kedy-typing i:nth-child(3) { animation-delay: 0.3s; }
        .kedy-typing-label { margin-inline-start: 10px; font-size: 0.8rem; color: var(--text-muted, #64748b); }
        @keyframes kedyDot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.45; } 30% { transform: translateY(-5px); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .kedy-typing i, .kedy-msg-user, .kedy-msg-bot { animation: none !important; } }
        /* المحادثة تصعد من الزر بدل أن تظهر فجأة */
        #globalKedyModal.active .kedy-modal-box { animation: cbsScaleIn var(--dur-enter, 320ms) var(--ease-out, ease); transform-origin: bottom left; }
        /* لوحة المفاتيح تُقلّص نافذة العرض، فتقفز العناصر الثابتة فوق
           المحتوى وتغطي ما يكتبه المستخدم. نخفيها ما دامت مفتوحة. */
        body.cbs-keyboard-open .kedy-global-fab,
        body.cbs-keyboard-open #bottom-nav,
        body.cbs-keyboard-open .bottom-nav { display: none !important; }
        /* زر كيدي (z-index 9990) كان يطفو فوق كل النوافذ المنبثقة (1000)
           ويغطي نصوصها وأزرارها على الهاتف. */
        body.modal-open .kedy-global-fab { display: none !important; }
        #globalKedyModal {
          position: fixed; inset: 0; z-index: 99995;
          background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: none; align-items: center; justify-content: center; padding: 16px;
        }
        #globalKedyModal.active { display: flex; animation: _kedyFadeIn 0.25s ease; }
        @keyframes _kedyFadeIn { from { opacity: 0; } to { opacity: 1; } }
        /* ===== صندوق النافذة =====
           سلسلة flex كاملة من الصندوق حتى حاوية الرسائل، مع min-height:0 على كل
           حلقة — بدونها يرفض عنصر flex الانكماش تحت حجم محتواه فلا يظهر شريط
           التمرير إطلاقاً (كان المحتوى يُقصّ بـ overflow:hidden ولا يمكن سحبه). */
        .kedy-modal-box {
          background: var(--bg-card, #ffffff);
          border-radius: 24px;
          width: min(580px, 100%);
          height: min(720px, 85vh);
          max-height: 85vh;
          display: flex; flex-direction: column;
          overflow: hidden; min-height: 0;
          box-shadow: 0 24px 70px rgba(0,0,0,0.35);
          border: 1px solid var(--border, #e2e8f0);
        }
        .kedy-modal-header {
          padding: 14px 18px;
          background: linear-gradient(135deg, #00123A, #243673);
          color: #fff; display: flex; align-items: center; justify-content: space-between;
          gap: 10px; flex-shrink: 0;
        }
        .kedy-modal-title {
          font-weight: 800; font-size: 0.98rem;
          display: flex; align-items: center; gap: 8px;
          min-width: 0;
        }
        .kedy-modal-title small { white-space: nowrap; }
        .kedy-modal-close {
          background: rgba(255,255,255,0.14); color: #fff; border: none;
          width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.15rem; cursor: pointer; transition: background 0.2s;
        }
        .kedy-modal-close:hover { background: rgba(255,255,255,0.28); }

        /* ===== التبويبات ===== */
        .kedy-modal-tabs {
          display: flex; flex-shrink: 0;
          background: var(--bg-main, #f8fafc);
          border-bottom: 1px solid var(--border, #e2e8f0);
        }
        .kedy-tab-btn {
          flex: 1; padding: 11px 8px; background: transparent; border: none;
          border-bottom: 2px solid transparent;
          font-family: inherit; font-size: 0.85rem; font-weight: 700;
          color: var(--text-muted, #64748b); cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          transition: color 0.2s, border-color 0.2s;
        }
        .kedy-tab-btn.active {
          color: var(--primary, #1E5EDB);
          border-bottom-color: var(--primary, #1E5EDB);
        }

        /* ===== شرائح الاقتراحات ===== */
        .kedy-quick-chips {
          display: flex; gap: 8px; padding: 10px 14px; flex-shrink: 0;
          background: var(--bg-main, #f8fafc);
          border-bottom: 1px solid var(--border, #e2e8f0);
          overflow-x: auto; -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .kedy-quick-chips::-webkit-scrollbar { display: none; }
        .kedy-chip {
          padding: 6px 13px; background: var(--bg-card, #fff);
          border: 1px solid var(--border, #cbd5e1); border-radius: 20px;
          font-size: 0.76rem; font-weight: 700; color: var(--text-main, #334155);
          cursor: pointer; white-space: nowrap; flex-shrink: 0;
          display: inline-flex; align-items: center; gap: 5px;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .kedy-chip i { font-size: 0.9rem; opacity: 0.75; }
        .kedy-chip:hover, .kedy-chip:active {
          background: var(--primary, #1E5EDB); color: #fff;
          border-color: var(--primary, #1E5EDB);
        }
        .kedy-chip:hover i, .kedy-chip:active i { opacity: 1; }

        /* ===== لوحة المحادثة وحاوية الرسائل ===== */
        #gkChatPanel { flex: 1; min-height: 0; }
        #globalKedyModal .kedy-chat-container {
          flex: 1; min-height: 0;
          overflow-y: auto; overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          padding: 16px;
          display: flex; flex-direction: column; gap: 12px;
          background: var(--bg-main, #f8fafc);
        }
        #globalKedyModal .kedy-chat-container::-webkit-scrollbar { width: 6px; }
        #globalKedyModal .kedy-chat-container::-webkit-scrollbar-thumb {
          background: var(--border, #cbd5e1); border-radius: 3px;
        }
        #globalKedyModal .kedy-chat-container::-webkit-scrollbar-track { background: transparent; }

        /* رسالة الطالب — لم يكن لها أي تنسيق فكانت تظهر كنص عارٍ بلا فقاعة */
        .kedy-msg-user {
          align-self: flex-start;
          background: linear-gradient(135deg, var(--primary, #1E5EDB), #4338ca);
          color: #fff; padding: 10px 15px;
          border-radius: 16px 16px 4px 16px;
          max-width: 85%; font-size: 0.88rem; line-height: 1.6;
          word-wrap: break-word; overflow-wrap: anywhere;
          box-shadow: 0 2px 8px rgba(30,94,219,0.22);
        }
        .kedy-msg-bot {
          align-self: flex-end;
          background: var(--bg-card, #ffffff);
          color: var(--text-main, #0f172a);
          padding: 12px 16px;
          border-radius: 16px 16px 16px 4px;
          max-width: 88%; font-size: 0.88rem; line-height: 1.75;
          border: 1px solid var(--border, #e2e8f0);
          word-wrap: break-word; overflow-wrap: anywhere;
          box-shadow: 0 1px 3px rgba(15,25,40,0.05);
        }
        .kedy-msg-bot strong { color: var(--primary, #1E5EDB); }
        .kedy-msg-bot pre, .kedy-msg-bot table { max-width: 100%; overflow-x: auto; }

        /* ===== شريط الإدخال ===== */
        .kedy-input-bar {
          padding: 12px 14px; flex-shrink: 0;
          border-top: 1px solid var(--border, #e2e8f0);
          display: flex; gap: 8px; align-items: center;
          background: var(--bg-card, #ffffff);
        }
        .kedy-input-bar input {
          flex: 1; min-width: 0; padding: 11px 15px;
          border: 1.5px solid var(--border, #cbd5e1); border-radius: 22px;
          font-family: inherit; font-size: 0.88rem; outline: none;
          background: var(--bg-main, #fff); color: var(--text-main, #000);
          transition: border-color 0.2s;
        }
        .kedy-input-bar input:focus { border-color: var(--primary, #1E5EDB); }
        .kedy-input-bar button {
          padding: 10px 16px; flex-shrink: 0;
          background: var(--primary, #1E5EDB); color: #fff; border: none;
          border-radius: 22px; font-family: inherit; font-weight: 700;
          font-size: 0.85rem; cursor: pointer;
          display: inline-flex; align-items: center; gap: 6px;
          transition: opacity 0.2s;
        }
        .kedy-input-bar button:disabled { opacity: 0.55; cursor: default; }

        /* ===== لوحة الملاحظات ===== */
        #gkNotesPanel {
          flex: 1; min-height: 0; overflow-y: auto;
          -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
          background: var(--bg-main, #f8fafc);
        }

        @media (max-width: 768px) {
          /* body يحجز المساحة الآن عبر --floating-chrome، فلا حاجة لرقم
             ثانٍ هنا كان يخالفه (110px مقابل 70px مقابل 106px). */
          /* على الهاتف دائرة أيقونة فقط: الشريحة العريضة بالنص كانت تغطي البطاقات تحتها */
          .kedy-global-fab { width: 54px; height: 54px; z-index: 9990; }
          .kedy-global-fab svg { width: 28px; height: 28px; }
          .kf-tip { left: 80px; }
          .kf-tip.kf-right { right: 80px; }
          #globalKedyModal { padding: 0; align-items: flex-end; }
          #globalKedyModal.active .kedy-modal-box { animation: cbsSheetUp var(--dur-sheet, 420ms) var(--ease-out, ease); }
          .kedy-modal-box {
            width: 100%;
            /* الارتفاع ثابت والتمرير داخلي: max-height وحدها كانت تترك الحاوية
               تتمدد بلا حدود على بعض المتصفحات فيختفي شريط التمرير */
            height: 88vh; height: 88dvh;
            max-height: none;
            border-radius: 22px 22px 0 0;
            border-bottom: none;
          }
          .kedy-modal-header { padding: 12px 14px; }
          .kedy-modal-title { font-size: 0.9rem; }
          .kedy-modal-title small { display: none; }
          #globalKedyModal .kedy-chat-container { padding: 12px; gap: 10px; }
          .kedy-input-bar { padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 8px)); }
          .kedy-msg-user, .kedy-msg-bot { max-width: 92%; font-size: 0.85rem; }
        }
      `;
      document.head.appendChild(st);
    }

    if (isAssignmentPage) {
      /* كان الزر يختفي بلا تفسير فيظن الطالب أن كيدي تعطّل. يبقى خافتاً بقفل،
         ولمسه يشرح السبب. */
      if (!document.getElementById('globalKedyFab')) {
        const locked = document.createElement('button');
        locked.id = 'globalKedyFab';
        locked.type = 'button';
        locked.className = 'kedy-global-fab kf-locked';
        locked.innerHTML = this._KEDY_SVG + '<span class="kf-lock" aria-hidden="true"><i class="ri-lock-2-fill"></i></span>';
        locked.setAttribute('aria-label', 'كيدي متوقف في صفحات الواجبات');
        try { if (localStorage.getItem('cbs_kedy_side') === 'right') locked.classList.add('kf-right'); } catch (e) {}
        locked.addEventListener('click', () => this.toast('كيدي متوقف في صفحات الواجبات', 'حفاظاً على نزاهة التقييم. يمكنك سؤاله عن المفاهيم من أي صفحة أخرى.', 'info'));
        document.body.appendChild(locked);
      }
      return;
    }

    // FAB Button
    const fab = document.createElement('button');
    fab.id = 'globalKedyFab';
    fab.className = 'kedy-global-fab';
    fab.type = 'button';
    fab.innerHTML = `
      <span class="kf-ring" aria-hidden="true"></span>
      ${this._KEDY_SVG}
      <span class="kf-dot" aria-hidden="true"></span>`;
    fab.setAttribute('aria-label', 'اسأل كيدي — المساعد الذكي. اضغط مطوّلاً للاختصارات');
    fab.setAttribute('aria-haspopup', 'menu');
    fab.title = 'اسأل كيدي';
    document.body.appendChild(fab);
    this._initKedyFab(fab);

    // Modal Overlay
    const modal = document.createElement('div');
    modal.id = 'globalKedyModal';
    modal.innerHTML = `
      <div class="kedy-modal-box">
        <div class="kedy-modal-header">
          <div class="kedy-modal-title"><i class="ri-sparkling-2-fill" style="color:#fbbf24;"></i> كيدي AI 2.0 <small style="opacity:0.75;font-weight:400;font-size:0.78rem;">(المساعد الأكاديمي الذكي)</small></div>
          <button class="kedy-modal-close" onclick="CBS.closeKedyAIModal()"><i class="ri-close-line"></i></button>
        </div>
        <div class="kedy-modal-tabs">
          <button class="kedy-tab-btn active" id="gkTabChat" onclick="CBS._switchKedyTab('chat')"><i class="ri-chat-smile-2-line"></i> المحادثة</button>
          <button class="kedy-tab-btn" id="gkTabNotes" onclick="CBS._switchKedyTab('notes')"><i class="ri-bookmark-3-line"></i> ملاحظاتي </button>
        </div>
        <div class="kedy-quick-chips">
          <span class="kedy-chip" onclick="CBS._kedyQuickPrompt('ملخص شامل للمادة')"><i class="ri-file-list-3-line"></i> ملخص شامل للمادة</span>
          <span class="kedy-chip" onclick="CBS._kedyQuickPrompt('اشرح بأسلوب مبسط وسهل')"><i class="ri-lightbulb-line"></i> اشرح بأسلوب مبسط</span>
          <span class="kedy-chip" onclick="CBS._kedyQuickPrompt('ما هي واجباتي واختباراتي القادمة؟')"><i class="ri-calendar-check-line"></i> واجباتي القادمة</span>
          <span class="kedy-chip" onclick="CBS._kedyQuickPrompt('أسئلة متوقعة للاختبار')"><i class="ri-question-answer-line"></i> أسئلة متوقعة</span>
        </div>
        <div id="gkChatPanel" style="display:flex;flex-direction:column;">
          <div class="kedy-chat-container" id="gkChatContainer">
            <div class="kedy-msg-bot">
              أهلاً بك! أنا <strong>كيدي</strong>، مساعدك الأكاديمي. أعرف موادك وواجباتك واختباراتك القادمة — اسألني عنها، أو اطلب شرح أي مفهوم في منهجك.
            </div>
          </div>
          <div class="kedy-input-bar">
            <input type="text" id="gkInput" placeholder="اكتب سؤالك هنا..." onkeydown="if(event.key==='Enter')CBS._sendKedyMsg()">
            <button id="gkSendBtn" onclick="CBS._sendKedyMsg()"><i class="ri-send-plane-fill"></i> إرسال</button>
          </div>
        </div>
        <div id="gkNotesPanel" style="display:none;padding:16px;">
          <!-- Notes populated dynamically -->
        </div>
      </div>
    `;
    /* نقرة على الخلفية تُغلق — عدا ما يصل في أول 450ms بعد الفتح: تلك نقرة اللمس
       التابعة للمسة التي فتحت النافذة (من أي زر في التطبيق) لا قرار إغلاق. */
    modal.addEventListener('click', e => {
      if (e.target === modal && Date.now() - (CBS._kedyOpenedAt || 0) > 450) CBS.closeKedyAIModal();
    });
    document.body.appendChild(modal);
  },

  /* تفاعلات زر كيدي: لمسة / ضغطة مطوّلة / سحب للجهة الأخرى / إخفاء أثناء التمرير / تلميح */
  _initKedyFab(fab) {
    const SIDE_KEY = 'cbs_kedy_side';
    const tip = document.createElement('div');
    tip.className = 'kf-tip';
    tip.setAttribute('role', 'status');
    const menu = document.createElement('div');
    menu.className = 'kf-menu';
    menu.setAttribute('role', 'menu');
    /* الاختصارات بحسب من يستخدمه: خطة المذاكرة والمواعيد لا تعني الدكتور.
       send: يُرسل فوراً · fill: يُكتب في الحقل ليكمله المستخدم */
    const roles = this.getUser()?.roles || [];
    const isStaff = roles.some(r => ['doctor', 'dean', 'admin'].includes(r));
    const actions = isStaff ? [
      ['ri-question-answer-line', 'اقترح أسئلة لكويز', { fill: 'اقترح 5 أسئلة اختيار من متعدد مع الإجابات عن: ' }],
      ['ri-lightbulb-line', 'بسّط مفهوماً لطلابي', { fill: 'اشرح بأسلوب مبسط لطلاب السنة الأولى مفهوم: ' }],
      ['ri-chat-1-line', 'سؤال حر', { fill: '' }]
    ] : [
      ['ri-calendar-schedule-line', 'رتّب لي مذاكرة الليلة', { send: 'رتب لي مذاكرة الليلة' }],
      ['ri-task-line', 'واجباتي واختباراتي القادمة', { send: 'ما هي واجباتي واختباراتي القادمة؟' }],
      ['ri-question-answer-line', 'اشرح لي مفهوماً', { fill: 'اشرح لي مفهوم: ' }]
    ];
    menu.innerHTML = actions.map(([icon, label, a]) =>
      `<button type="button" role="menuitem" ${a.send ? `data-send="${a.send}"` : `data-fill="${a.fill}"`}><i class="${icon}"></i>${label}</button>`).join('');
    const scrim = document.createElement('div');
    scrim.className = 'kf-scrim';
    document.body.append(scrim, tip, menu);

    const setSide = side => {
      [fab, tip, menu].forEach(el => el.classList.toggle('kf-right', side === 'right'));
      try { localStorage.setItem(SIDE_KEY, side); } catch (e) {}
    };
    let side = 'left';
    try { side = localStorage.getItem(SIDE_KEY) === 'right' ? 'right' : 'left'; } catch (e) {}
    setSide(side);

    const closeMenu = () => { menu.classList.remove('open'); scrim.classList.remove('open'); fab.setAttribute('aria-expanded', 'false'); };
    const openMenu = () => {
      hideTip();
      menu.classList.add('open'); scrim.classList.add('open'); fab.setAttribute('aria-expanded', 'true');
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
      menu.querySelector('button')?.focus({ preventScroll: true });
    };
    scrim.addEventListener('click', closeMenu);
    menu.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      closeMenu();
      if (!navigator.onLine) { CBS._kedyOfflineNotice(); return; }
      CBS.openKedyAIModal();
      if (btn.dataset.send) CBS._kedyQuickPrompt(btn.dataset.send);
      else setTimeout(() => {
        const input = document.getElementById('gkInput');
        if (!input) return;
        input.value = btn.dataset.fill || '';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }, 350);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('open')) { closeMenu(); fab.focus(); } });
    fab.addEventListener('keydown', e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openMenu(); } });
    fab.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(); });

    // لمسة / ضغطة مطوّلة / سحب
    let start = null, longTimer = null, dragging = false, longFired = false;
    /* الحركة والإفلات يُتابَعان على النافذة كلها أثناء الضغط: الإصبع يغادر حدود
       الزر فور بدء السحب، والتقاط المؤشر (setPointerCapture) لا يعمل في كل
       WebView، فكان السحب يتوقف بعد بضعة بكسلات. */
    const onMove = e => {
      if (!start || longFired) return;
      const dx = e.clientX - start.x;
      if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
        dragging = true; clearTimeout(longTimer);
        fab.classList.remove('kf-pressed'); fab.classList.add('kf-dragging');
        hideTip();
      }
      if (dragging) fab.style.setProperty('--kf-x', dx + 'px');
    };
    const stopTracking = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endPress);
      window.removeEventListener('pointercancel', endPress);
    };
    fab.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY };
      dragging = false; longFired = false; suppressClick = false;
      fab.classList.add('kf-pressed');
      longTimer = setTimeout(() => { longFired = true; fab.classList.remove('kf-pressed'); openMenu(); }, 480);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', endPress);
      window.addEventListener('pointercancel', endPress);
    });
    function endPress(e) {
      stopTracking();
      clearTimeout(longTimer);
      fab.classList.remove('kf-pressed');
      if (!start) return;
      if (dragging) {
        const r = fab.getBoundingClientRect();
        const nextSide = (r.left + r.width / 2) > window.innerWidth / 2 ? 'right' : 'left';
        fab.classList.remove('kf-dragging');
        // ننقل الزر للجهة الجديدة ثم نُرجع الإزاحة صفراً فيبدو أنه يستقر في مكانه
        const before = fab.getBoundingClientRect().left;
        setSide(nextSide);
        const after = fab.getBoundingClientRect().left;
        fab.style.setProperty('--kf-x', (before - after) + 'px');
        requestAnimationFrame(() => requestAnimationFrame(() => fab.style.setProperty('--kf-x', '0px')));
      }
      // السحب والضغطة المطوّلة لهما نقرة تابعة يجب ألا تفتح المحادثة
      if (dragging || longFired) suppressClick = true;
      start = null; dragging = false;
    }
    /* الفتح من حدث click لا من pointerup: على اللمس كان الفتح عند رفع الإصبع
       يُظهر النافذة، ثم تقع النقرة التابعة التي يرسلها الهاتف على خلفيتها
       فتُغلقها فوراً — فيبدو الزر كأنه لا يستجيب. click يشمل اللمس والفأرة
       ولوحة المفاتيح (Enter/Space). */
    let suppressClick = false;
    fab.addEventListener('click', e => {
      if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
      fab.classList.remove('has-reply');
      CBS.openKedyAIModal();
    });

    // إخفاء أثناء التمرير للأسفل، وعودة عند الصعود — لا يغطي المحتوى أثناء القراءة
    let lastY = window.scrollY, ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY, dy = y - lastY;
        if (Math.abs(dy) > 8) {
          const hide = dy > 0 && y > 120;
          fab.classList.toggle('kf-hidden', hide);
          if (hide) { hideTip(); closeMenu(); }
          lastY = y;
        }
        ticking = false;
      });
    }, { passive: true });

    // تلميح بحسب الصفحة — مرة لكل صفحة في الجلسة، وليس فوق الجولة الترحيبية
    // بلا إنترنت: الزر خافت ويقول السبب بدل أن يفتح محادثة لن تُجاب
    const syncOnline = () => {
      fab.classList.toggle('kf-offline', !navigator.onLine);
      fab.setAttribute('aria-label', navigator.onLine
        ? 'اسأل كيدي — المساعد الذكي. اضغط مطوّلاً للاختصارات'
        : 'كيدي غير متاح — لا يوجد اتصال بالإنترنت');
    };
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    syncOnline();

    const path = location.pathname;
    const tipText = isStaff
      ? (path.endsWith('/manage-lectures.html') ? 'أقترح لك أسئلة كويز من محاضرتك؟' : 'أجهّز لك أسئلة كويز أو شرحاً مبسطاً لطلابك؟')
      : path.endsWith('/subject.html') ? 'افتح محاضرة واطلب مني تلخيصها'
      : path.endsWith('/quizzes.html') ? 'أختبرك قبل الكويز؟'
      : path.endsWith('/code-lab.html') ? 'عندك خطأ في الكود؟ أرسله لي'
      : path.endsWith('/calendar.html') ? 'أرتّب لك مذاكرة الأسبوع؟'
      : /\/(dashboard|campus)\.html$/.test(path) ? 'أرتّب لك مذاكرة اليوم؟'
      : 'اسألني عن أي شيء في دراستك';
    tip.textContent = tipText;
    let tipTimer = null;
    function hideTip() { tip.classList.remove('show'); clearTimeout(tipTimer); }
    tip.addEventListener('click', () => { hideTip(); CBS.openKedyAIModal(); });
    let seen = false;
    try { seen = sessionStorage.getItem('cbs_kedy_tip:' + path) === '1'; } catch (e) {}
    const showTip = () => {
      // الجولة الترحيبية مفتوحة: نؤجّل التلميح إلى ما بعد إغلاقها بدل أن يضيع
      if (document.querySelector('.cbs-onboarding')) {
        window.addEventListener('cbs:onboarding-done', () => setTimeout(showTip, 900), { once: true });
        return;
      }
      // لا تلميح فوق حالة خطأ في الصفحة (مادة غير متاحة مثلاً) — نصه لن يناسبها
      if (!navigator.onLine || fab.classList.contains('kf-hidden') || document.body.classList.contains('modal-open') || document.querySelector('.subject-unavailable, [role="alert"].empty-state')) return;
      tip.classList.add('show');
      fab.classList.add('kf-ping');
      try { sessionStorage.setItem('cbs_kedy_tip:' + path, '1'); } catch (e) {}
      tipTimer = setTimeout(hideTip, 5200);
      setTimeout(() => fab.classList.remove('kf-ping'), 3400);
    };
    if (!seen) setTimeout(showTip, 2600);
  },

  /* ===== الجولة الترحيبية =====
     تظهر مرة واحدة لكل حساب على الجهاز، بعد أول دخول للوحة الرئيسية، ومحتواها
     بحسب الدور. تُعاد من CBS.showOnboarding(true). */
  _ONBOARD_KEY: 'cbs_onboarded_v1',

  _maybeShowOnboarding() {
    if (!/\/(dashboard|admin_dashboard)\.html$/.test(location.pathname)) return;
    const user = this.getUser();
    if (!user || user.firstLogin) return;
    let seen = false;
    try { seen = localStorage.getItem(`${this._ONBOARD_KEY}:${user.id || user._id}`) === '1'; } catch (e) {}
    if (!seen) setTimeout(() => this.showOnboarding(), 700);
  },

  // شعار كيدي: فقاعة بعينين ونجمة — يستخدمه الزر والجولة الترحيبية
  _KEDY_SVG: `<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 4.2c5.5 0 10 3.9 10 8.7s-4.5 8.7-10 8.7c-1.2 0-2.4-.2-3.5-.5L6 23.6l1.3-4.4C5.2 17.6 4 15.4 4 12.9 4 8.1 8.5 4.2 14 4.2z" fill="#fff"/><g class="kf-eyes"><ellipse cx="10.7" cy="12.9" rx="1.5" ry="1.9"/><ellipse cx="17.3" cy="12.9" rx="1.5" ry="1.9"/></g><path class="kf-spark" d="M24 1.6l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#FBBF24"/></svg>`,

  _onboardingSlides(roles = []) {
    const welcome = { art: 'logo', chips: [['ri-book-open-line', 'المحاضرات'], ['ri-calendar-check-line', 'المواعيد'], ['ri-notification-3-line', 'التنبيهات']],
      title: 'أهلاً بك في تطبيق كلية النصر التقنية', text: 'كل ما يخص دراستك في مكان واحد، على هاتفك.' };
    const isDean = roles.includes('dean') || roles.includes('admin');
    if (isDean) return [
      { ...welcome, text: 'إدارة الكلية كلها من لوحة واحدة: الدفعات والمستخدمون والمحتوى والرسوم.' },
      { art: 'ri-user-settings-line', chips: [['ri-team-line', 'المستخدمون'], ['ri-stack-line', 'الدفعات'], ['ri-checkbox-circle-line', 'طلبات التسجيل']],
        title: 'المستخدمون والدفعات', text: 'اعتمد طلبات التسجيل، ووزّع الدكاترة على الدفعات، وأنشئ دفعة جديدة بموادها في دقائق.' },
      { art: 'ri-wallet-3-line', chips: [['ri-file-list-3-line', 'الرسوم'], ['ri-checkbox-circle-line', 'إشعارات السداد'], ['ri-alarm-warning-line', 'المتأخرات']],
        title: 'الرسوم والمدفوعات', text: 'أضف رسوم الدفعة مرة واحدة، وراجع إشعارات السداد، وتابع المتأخرات أولاً بأول.' },
      { art: 'ri-bar-chart-2-line', chips: [['ri-calendar-check-line', 'الحضور'], ['ri-alarm-warning-line', 'إنذار مبكر'], ['ri-file-list-3-line', 'تصدير']],
        title: 'تقارير لحظية', text: 'نسب الحضور والأداء لكل دفعة، والطلاب المعرّضون للتعثر قبل فوات الأوان.' }
    ];
    if (roles.includes('doctor')) return [
      { ...welcome, text: 'موادك وطلابك ومحتواك في مكان واحد.' },
      { art: 'ri-presentation-line', chips: [['ri-file-list-3-line', 'محاضرات'], ['ri-video-line', 'فيديو'], ['ri-timer-line', 'كويزات']],
        title: 'ارفع محتواك مرة واحدة', text: 'محاضرات وفيديوهات وواجبات وكويزات بمؤقت تصل لطلاب دفعتك مع تنبيه فوري.' },
      { art: 'ri-calendar-check-line', chips: [['ri-team-line', 'كشف الدفعة'], ['ri-checkbox-circle-line', 'حاضر'], ['ri-notification-3-line', 'تحذير الغياب']],
        title: 'الحضور بلمسة', text: 'ارصد حضور المحاضرة من هاتفك، ويصل الطالب تحذير تلقائي إن انخفضت نسبته.' },
      { art: 'ri-bar-chart-2-line', chips: [['ri-alarm-warning-line', 'إنذار مبكر'], ['ri-file-list-3-line', 'التسليمات'], ['ri-checkbox-circle-line', 'التقييم']],
        title: 'تقارير وإنذار مبكر', text: 'اعرف من يحتاج متابعة من الآن: حضور منخفض، أو واجبات متأخرة، أو نتائج متراجعة.' }
    ];
    return [
      welcome,
      { art: 'kedy', chips: [['ri-file-list-3-line', 'يلخّص'], ['ri-checkbox-circle-line', 'يختبرك'], ['ri-calendar-check-line', 'يرتّب يومك']],
        title: 'كيدي، مساعدك الذكي', text: 'اسأله عن أي مفهوم، أو اطلب ملخص محاضرة، أو خطة مذاكرة من مواعيدك الحقيقية. تجده في الزر الدائري أسفل الشاشة.' },
      { art: 'ri-book-open-line', chips: [['ri-video-line', 'فيديو'], ['ri-timer-line', 'كويزات'], ['ri-code-s-slash-line', 'معمل الأكواد']],
        title: 'محاضراتك وواجباتك وكويزاتك', text: 'كل مادة بمحاضراتها وفيديوهاتها، وواجبات بمواعيد واضحة، وكويزات بمؤقت تراجع إجاباتها بعد الإغلاق.' },
      { art: 'ri-qr-code-line', chips: [['ri-shield-check-line', 'موقّعة'], ['ri-notification-3-line', 'تنبيهات'], ['ri-wallet-3-line', 'الرسوم']],
        title: 'هويتك الرقمية', text: 'بطاقة جامعية برمز QR يمكن التحقق منه، وتنبيهات فورية بكل جديد في دفعتك.' }
    ];
  },

  showOnboarding(force = false) {
    if (document.querySelector('.cbs-onboarding')) return;
    const user = this.getUser() || {};
    const slides = this._onboardingSlides(user.roles || []);
    const esc = s => this.escapeHTML(s);
    const art = s => {
      const center = s.art === 'logo' ? '<img src="/assets/logo.png" alt="" class="ob-logo">'
        : s.art === 'kedy' ? `<span class="ob-core">${this._KEDY_SVG}</span>`
        : `<span class="ob-core"><i class="${s.art}"></i></span>`;
      return `<div class="ob-art" aria-hidden="true">
        <span class="ob-halo"></span>
        ${center}
        ${s.chips.map(([ic, label], k) => `<span class="ob-chip ob-chip-${k}"><i class="${ic}"></i>${esc(label)}</span>`).join('')}
      </div>`;
    };

    const root = document.createElement('div');
    root.className = 'cbs-onboarding';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'جولة تعريفية بالتطبيق');
    root.innerHTML = `
      <div class="ob-top"><button type="button" class="ob-skip">تخطّي</button></div>
      <div class="ob-viewport"><div class="ob-track">
        ${slides.map((s, i) => `<section class="ob-slide${i === 0 ? ' active' : ''}" aria-hidden="${i !== 0}">
          ${art(s)}
          <h2 class="ob-title">${esc(s.title)}</h2>
          <p class="ob-text">${esc(s.text)}</p>
        </section>`).join('')}
      </div></div>
      <div class="ob-footer">
        <div class="ob-dots" role="tablist">${slides.map((_, i) => `<button type="button" class="ob-dot${i === 0 ? ' active' : ''}" aria-label="الشريحة ${i + 1}" data-i="${i}"></button>`).join('')}</div>
        <button type="button" class="ob-next">التالي <i class="ri-arrow-left-line"></i></button>
      </div>`;
    document.body.appendChild(root);
    document.body.classList.add('cbs-onboarding-open');

    const track = root.querySelector('.ob-track');
    const dots = [...root.querySelectorAll('.ob-dot')];
    const slideEls = [...root.querySelectorAll('.ob-slide')];
    const next = root.querySelector('.ob-next');
    let index = 0;

    const go = i => {
      index = Math.max(0, Math.min(slides.length - 1, i));
      track.style.transform = `translateX(${index * 100}%)`; // RTL: الشريحة التالية على اليسار
      slideEls.forEach((el, k) => { el.classList.toggle('active', k === index); el.setAttribute('aria-hidden', String(k !== index)); });
      dots.forEach((d, k) => { d.classList.toggle('active', k === index); d.setAttribute('aria-current', k === index ? 'step' : 'false'); });
      const last = index === slides.length - 1;
      next.innerHTML = last ? 'ابدأ الآن' : 'التالي <i class="ri-arrow-left-line"></i>';
      next.classList.toggle('ob-finish', last);
      if (navigator.vibrate) { try { navigator.vibrate(6); } catch (e) {} }
    };
    const finish = () => {
      try { localStorage.setItem(`${this._ONBOARD_KEY}:${user.id || user._id}`, '1'); } catch (e) {}
      root.classList.add('leaving');
      document.body.classList.remove('cbs-onboarding-open');
      setTimeout(() => { root.remove(); window.dispatchEvent(new Event('cbs:onboarding-done')); }, 320);
      document.removeEventListener('keydown', onKey);
    };
    const onKey = e => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowLeft') go(index + 1);   // RTL: اليسار = التالي
      else if (e.key === 'ArrowRight') go(index - 1);
    };
    document.addEventListener('keydown', onKey);
    root.querySelector('.ob-skip').addEventListener('click', finish);
    next.addEventListener('click', () => (index === slides.length - 1 ? finish() : go(index + 1)));
    dots.forEach(d => d.addEventListener('click', () => go(Number(d.dataset.i))));

    // السحب: إصبع نحو اليمين = التالي في واجهة من اليمين لليسار
    const vp = root.querySelector('.ob-viewport');
    let sx = null, sy = null, dx = 0, horizontal = null;
    vp.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; dx = 0; horizontal = null; });
    vp.addEventListener('pointermove', e => {
      if (sx === null) return;
      dx = e.clientX - sx;
      if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(e.clientY - sy) > 8)) horizontal = Math.abs(dx) > Math.abs(e.clientY - sy);
      if (horizontal) {
        track.classList.add('dragging');
        const edge = (index === 0 && dx < 0) || (index === slides.length - 1 && dx > 0);
        track.style.transform = `translateX(calc(${index * 100}% + ${edge ? dx / 3 : dx}px))`;
      }
    });
    const end = () => {
      if (sx === null) return;
      track.classList.remove('dragging');
      if (horizontal && Math.abs(dx) > vp.clientWidth * 0.18) go(index + (dx > 0 ? 1 : -1));
      else go(index);
      sx = null;
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('pointerleave', end);

    requestAnimationFrame(() => root.classList.add('shown'));
    setTimeout(() => next.focus({ preventScroll: true }), 350);
    if (force) go(0);
  },

  _kedyOfflineNotice() {
    this.toast('كيدي يحتاج اتصالاً بالإنترنت', 'تحقّق من الاتصال ثم حاول مرة أخرى', 'warning');
  },

  openKedyAIModal() {
    if (!navigator.onLine) { this._kedyOfflineNotice(); return; }
    const modal = document.getElementById('globalKedyModal');
    if (!modal) { this.renderGlobalKedyAI(); }
    document.getElementById('globalKedyFab')?.classList.remove('has-reply', 'has-error');
    document.querySelector('.kf-tip')?.classList.remove('show');
    this._kedyOpenedAt = Date.now();
    document.getElementById('globalKedyModal')?.classList.add('active');
  },

  closeKedyAIModal() {
    document.getElementById('globalKedyModal')?.classList.remove('active');
  },

  _switchKedyTab(tab) {
    document.getElementById('gkTabChat')?.classList.toggle('active', tab === 'chat');
    document.getElementById('gkTabNotes')?.classList.toggle('active', tab === 'notes');
    document.getElementById('gkChatPanel').style.display = tab === 'chat' ? 'flex' : 'none';
    document.getElementById('gkNotesPanel').style.display = tab === 'notes' ? 'block' : 'none';
    if (tab === 'notes') this._renderKedyGlobalNotes();
  },

  _kedyQuickPrompt(text) {
    const input = document.getElementById('gkInput');
    if (input) { input.value = text; this._sendKedyMsg(); }
  },

  /* سجل المحادثة الجارية مع كيدي.
     لم يكن موجوداً إطلاقاً، فكان كل سؤال يُرسل منفصلاً تماماً عمّا قبله —
     ولهذا كان المساعد ينسى المادة أو الموضوع فور انتهاء الرسالة الواحدة. */
  _kedyHistory: [],
  _KEDY_HISTORY_MAX: 20,

  _kedyPushHistory(role, content) {
    if (!content) return;
    this._kedyHistory.push({ role, content: String(content) });
    if (this._kedyHistory.length > this._KEDY_HISTORY_MAX) {
      this._kedyHistory = this._kedyHistory.slice(-this._KEDY_HISTORY_MAX);
    }
  },

  _kedyResetHistory() {
    this._kedyHistory = [];
  },

  /* المادة التي اختارها الطالب من قائمة كيدي (خارج صفحة المادة) */
  _kedySubjectId: null,
  _kedySubjectName: '',

  /* معرّف المادة المقصودة حالياً:
     أولاً صفحة المادة المفتوحة (subject.html?id=)، وإلا آخر مادة اختارها
     الطالب في المحادثة. بهذا يقرأ كيدي المحتوى مباشرة في الحالتين. */
  _currentSubjectId() {
    if (window.location.pathname.endsWith('/subject.html')) {
      const id = new URLSearchParams(window.location.search).get('id');
      if (id && id !== 'null' && id !== 'undefined') return id;
    }
    return this._kedySubjectId;
  },

  _currentSubjectName() {
    const onPage = document.getElementById('subjectName')?.textContent?.trim();
    if (onPage && window.location.pathname.endsWith('/subject.html')) return onPage;
    return this._kedySubjectName || '';
  },

  /* هل الرسالة طلب يحتاج قراءة محتوى المادة/المحاضرات؟

     القائمة السابقة كانت عبارات كاملة محدّدة (ملخص شامل، لخص لي المادة…)
     فلا يطابقها الطالب حين يكتب "لخص لي" أو "اشرح دي" أو "شنو في الملف" —
     وهو ما يكتبه فعلاً. النتيجة: لا يُجلب أي محتوى ويجيب كيدي من فراغ
     بأنه "لا يرى ملفات". نكتفي الآن بفعل الطلب: أي أمر تلخيص أو شرح أو
     استخراج أسئلة يستدعي قراءة المحتوى. */
  _isContentRequest(msg) {
    const text = String(msg || '');
    const verbs = /(لخ+ص|تلخيص|ملخ+ص|اشرح|شرح|وضّح|وضح|فسّر|فسر|بسّط|بسط|راجع|مراجعة|حلّل|حلل)/;
    const asks  = /(أسئلة متوقعة|اسئلة متوقعة|أهم النقاط|اهم النقاط|النقاط المهمة|ما في الملف|شنو في الملف|شنو الموجود|محتوى الملف|محتوى المادة|المنهج)/;
    return verbs.test(text) || asks.test(text);
  },

  /* توافق خلفي — بقي اسمها مستخدماً في مواضع أخرى */
  _isSubjectWideRequest(msg) {
    return this._isContentRequest(msg);
  },

  /* يجلب نص كل محاضرات المادة (يستخرجه الخادم من ملفات PDF عند اللزوم) */
  async _fetchSubjectContext(subjectId) {
    try {
      const res = await this.apiGet('/api/ai/subject-context/' + subjectId);
      if (!res || !res.ok) return null;
      const data = await res.json();
      return data && data.success ? data : null;
    } catch { return null; }
  },

  async _sendKedyMsg() {
    const input = document.getElementById('gkInput');
    const container = document.getElementById('gkChatContainer');
    const sendBtn = document.getElementById('gkSendBtn');
    if (!input || !container) return;
    const msg = input.value.trim();
    if (!msg) return;

    const uMsg = document.createElement('div');
    uMsg.className = 'kedy-msg-user';
    uMsg.textContent = msg;
    container.appendChild(uMsg);
    input.value = '';
    sendBtn.disabled = true;

    const botMsg = document.createElement('div');
    botMsg.className = 'kedy-msg-bot';
    botMsg.innerHTML = CBS._kedyTypingHtml();
    container.appendChild(botMsg);
    container.scrollTop = container.scrollHeight;
    const fab = document.getElementById('globalKedyFab');
    fab?.classList.add('is-thinking');

    try {
      /* العنصر كان يُقرأ بمعرّف خاطئ ('subjectTitle' غير موجود؛ الصحيح
         'subjectName')، فيسقط دائماً إلى document.title — وهو غير فارغ أبداً.
         النتيجة أن الخادم يظن أن الطالب حدّد مادة فلا يعرض قائمة المواد
         إطلاقاً، ويجيب من فراغ بأنه «لا يستطيع قراءة الملفات». */
      const subjectId = this._currentSubjectId();
      const subjectTitle = this._currentSubjectName();
      const lectureTitle = document.getElementById('pdfModalTitle')?.textContent?.trim() || '';

      const payload = {
        prompt: msg,
        lectureTitle,
        history: this._kedyHistory.slice()   // يُرسل قبل إضافة الرسالة الحالية
      };
      // لا نرسل subjectTitle فارغاً؛ غيابه هو ما يجعل الخادم يعرض قائمة المواد
      if (subjectTitle) payload.subjectTitle = subjectTitle;
      if (subjectId)    payload.subjectId = subjectId;

      /* محاضرة مفتوحة أمام الطالب + طلب محتوى → اقرأ هذه المحاضرة بعينها.
         كان هذا الفرع غائباً تماماً: من يفتح محاضرة ويكتب "لخص لي" لا
         يُرسَل معه أي نص، فيعتذر كيدي رغم أن الملف مفتوح أمامه. */
      const openLectureId = this._currentLectureId?.() || document.getElementById('pdfModalTitle')?.dataset?.lectureId || '';
      if (openLectureId && this._isContentRequest(msg)) {
        botMsg.innerHTML = CBS._kedyTypingHtml('أقرأ المحاضرة');
        try {
          const lr = await this.apiGet(`/api/ai/lecture-context/${openLectureId}`);
          const ld = await lr.json();
          if (ld?.success && ld.hasText) {
            payload.text = ld.extractedText;
            payload.lectureTitle = ld.lectureTitle || lectureTitle;
            payload.subjectTitle = ld.subjectName || subjectTitle;
          }
        } catch { /* نكمل بالمسار العام أدناه */ }
      }

      // داخل صفحة مادة + طلب محتوى ولم نقرأ محاضرة بعينها → اقرأ المادة كلها
      if (!payload.text && subjectId && this._isContentRequest(msg)) {
        botMsg.innerHTML = CBS._kedyTypingHtml('أقرأ محاضرات المادة');
        const ctx = await this._fetchSubjectContext(subjectId);
        if (ctx && ctx.hasText) {
          payload.text = ctx.text;
          payload.subjectTitle = ctx.subjectName || subjectTitle;
          const missing = (ctx.skippedLectures || []).length;
          payload.prompt = `${msg}\n\n(محتوى ${ctx.includedLectures.length} محاضرة من أصل ${ctx.lectureCount} مرفق أدناه.)`;
          if (missing) {
            botMsg.innerHTML = CBS._kedyTypingHtml(`قرأت ${ctx.includedLectures.length} محاضرة، أكتب الملخص`);
          }
        } else {
          // لا نص قابل للاستخراج (فيديو أو PDF مصوَّر) — نصارح الطالب
          payload.prompt = `${msg}\n\n(ملاحظة: محاضرات هذه المادة لا تحتوي نصاً قابلاً للقراءة — فيديو أو ملفات ممسوحة ضوئياً. وضّح ذلك للطالب في سطر واحد ثم اشرح الموضوع من معرفتك العامة.)`;
        }
      }

      const res = await this.apiPost('/api/ai/ask', payload);
      const data = await res.json();
      if (data.success && data.answer) {
        this._kedyPushHistory('user', msg);
        this._kedyPushHistory('assistant', data.answer);
        let interactiveHtml = '';
        if (data.interactive?.type === 'select_subject') {
          interactiveHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">` +
            data.interactive.subjects.map(s => 
              `<button onclick="CBS._kedySelectSubject('${s._id}', '${this.escapeHTML(s.name)}')" style="padding:7px 14px;background:#4f46e5;color:#fff;border:none;border-radius:18px;font-size:0.8rem;font-weight:700;cursor:pointer;"><i class="ri-book-2-line"></i> ${this.escapeHTML(s.name)}</button>`
            ).join('') + `</div>`;
        } else if (data.interactive?.type === 'select_scope') {
          interactiveHtml = `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">` +
            `<button onclick="CBS._kedyQuickPrompt('ملخص شامل لمادة ${this.escapeHTML(data.interactive.subjectName)}')" style="padding:8px 12px;background:#4f46e5;color:#fff;border:none;border-radius:12px;font-size:0.8rem;font-weight:700;cursor:pointer;text-align:right;"><i class="ri-file-list-3-line"></i> ملخص شامل للمادة كاملة</button>` +
            `<button onclick="CBS._kedyQuickPrompt('ابحث لي عن جزئية في مادة ${this.escapeHTML(data.interactive.subjectName)}')" style="padding:8px 12px;background:var(--bg-card);color:#4f46e5;border:1.5px solid #4f46e5;border-radius:12px;font-size:0.8rem;font-weight:700;cursor:pointer;text-align:right;"> البحث عن جزئية/موضوع معين</button>` +
            (data.interactive.lectures.length ? `<strong style="font-size:0.78rem;margin-top:6px;color:var(--text-muted);">أو اختر محاضرة معينة:</strong>` +
            data.interactive.lectures.map(l =>
              `<button onclick="CBS._kedySelectLecture('${l._id}', '${this.escapeHTML(l.title)}', '${this.escapeHTML(data.interactive.subjectName)}')" style="padding:6px 10px;background:var(--bg-main);color:var(--text-main);border:1px solid var(--border);border-radius:8px;font-size:0.78rem;cursor:pointer;text-align:right;"><i class="ri-file-text-line"></i> ${this.escapeHTML(l.title)}</button>`
            ).join('') : '') + `</div>`;
        }

        botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml + 
          this._noteSaveButton(msg, data.answer);
        // الطالب أغلق المحادثة أثناء الانتظار: نقطة على الزر تخبره أن الرد وصل
        if (!document.getElementById('globalKedyModal')?.classList.contains('active')) fab?.classList.add('has-reply');
      } else {
        botMsg.innerHTML = '<span style="color:var(--danger)">' + this.escapeHTML(data.message || 'حدث خطأ في الإجابة') + '</span>';
        if (!document.getElementById('globalKedyModal')?.classList.contains('active')) fab?.classList.add('has-error');
      }
    } catch {
      botMsg.innerHTML = '<span style="color:var(--danger)">تعذّر الاتصال بالخادم الذكي</span>';
      if (!document.getElementById('globalKedyModal')?.classList.contains('active')) fab?.classList.add('has-error');
    }
    fab?.classList.remove('is-thinking');
    sendBtn.disabled = false;
    container.scrollTop = container.scrollHeight;
  },

  /* مؤشر الكتابة: ثلاث نقاط بدل أيقونة دوّارة ونص — نفس ما يتوقعه الطالب من أي محادثة */
  _kedyTypingHtml(label = '') {
    return `<span class="kedy-typing" role="status" aria-label="كيدي يكتب"><i></i><i></i><i></i></span>${label ? `<span class="kedy-typing-label">${label}</span>` : ''}`;
  },

  _kedySelectSubject(subjectId, subjectName) {
    // نثبّتها ليعرف الطلب التالي («ملخص شامل») أي مادة يقرأ دون سؤال جديد
    this._kedySubjectId = subjectId;
    this._kedySubjectName = subjectName;
    const input = document.getElementById('gkInput');
    if (input) {
      input.value = `اخترت مادة: ${subjectName}`;
      this._sendKedyMsgWithSubject(subjectId, subjectName);
    }
  },

  async _sendKedyMsgWithSubject(subjectId, subjectName) {
    const container = document.getElementById('gkChatContainer');
    const input = document.getElementById('gkInput');
    if (!container) return;

    const uMsg = document.createElement('div');
    uMsg.className = 'kedy-msg-user';
    uMsg.textContent = `اخترت مادة: ${subjectName}`;
    container.appendChild(uMsg);
    if (input) input.value = '';

    const botMsg = document.createElement('div');
    botMsg.className = 'kedy-msg-bot';
    botMsg.innerHTML = CBS._kedyTypingHtml('أجلب المحاضرات');
    container.appendChild(botMsg);
    container.scrollTop = container.scrollHeight;

    try {
      const res = await this.apiPost('/api/ai/ask', {
        prompt: `اخترت مادة: ${subjectName}`,
        selectedSubjectId: subjectId,
        subjectTitle: subjectName,
        history: this._kedyHistory.slice()
      });
      const data = await res.json();
      if (data.success && data.answer) {
        // تثبيت المادة المختارة في السجل حتى تبقى معروفة في الرسائل التالية
        this._kedyPushHistory('user', `اخترت مادة: ${subjectName}`);
        this._kedyPushHistory('assistant', data.answer);
        let interactiveHtml = '';
        if (data.interactive?.type === 'select_scope') {
          interactiveHtml = `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">` +
            `<button onclick="CBS._kedyQuickPrompt('ملخص شامل لمادة ${this.escapeHTML(subjectName)}')" style="padding:8px 12px;background:#4f46e5;color:#fff;border:none;border-radius:12px;font-size:0.8rem;font-weight:700;cursor:pointer;text-align:right;"><i class="ri-file-list-3-line"></i> ملخص شامل لمادة ${this.escapeHTML(subjectName)}</button>` +
            `<button onclick="CBS._kedyQuickPrompt('ابحث لي عن جزئية في مادة ${this.escapeHTML(subjectName)}')" style="padding:8px 12px;background:var(--bg-card);color:#4f46e5;border:1.5px solid #4f46e5;border-radius:12px;font-size:0.8rem;font-weight:700;cursor:pointer;text-align:right;"> البحث عن جزئية/موضوع معين</button>` +
            (data.interactive.lectures.length ? `<strong style="font-size:0.78rem;margin-top:6px;color:var(--text-muted);">أو اختر محاضرة معينة:</strong>` +
            data.interactive.lectures.map(l =>
              `<button onclick="CBS._kedySelectLecture('${l._id}', '${this.escapeHTML(l.title)}', '${this.escapeHTML(subjectName)}')" style="padding:6px 10px;background:var(--bg-main);color:var(--text-main);border:1px solid var(--border);border-radius:8px;font-size:0.78rem;cursor:pointer;text-align:right;"><i class="ri-file-text-line"></i> ${this.escapeHTML(l.title)}</button>`
            ).join('') : '') + `</div>`;
        }

        botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml;
      }
    } catch {
      botMsg.innerHTML = '<span style="color:var(--danger)">تعذّر الجلب</span>';
    }
    container.scrollTop = container.scrollHeight;
  },

  async _kedySelectLecture(lectureId, lectureTitle, subjectName) {
    const container = document.getElementById('gkChatContainer');
    if (!container) return;

    // رسالة المستخدم
    const uMsg = document.createElement('div');
    uMsg.className = 'kedy-msg-user';
    uMsg.textContent = `اخترت محاضرة: ${lectureTitle}`;
    container.appendChild(uMsg);

    // رسالة التحميل
    const botMsg = document.createElement('div');
    botMsg.className = 'kedy-msg-bot';
    botMsg.innerHTML = CBS._kedyTypingHtml('أقرأ المحاضرة');
    container.appendChild(botMsg);
    container.scrollTop = container.scrollHeight;

    try {
      // أولاً: جلب نص المحاضرة من السيرفر
      let lectureText = '';
      let hasText = false;
      try {
        const ctxRes = await this.apiGet(`/api/ai/lecture-context/${lectureId}`);
        const ctxData = await ctxRes.json();
        if (ctxData.success) {
          lectureText = ctxData.extractedText || '';
          hasText = ctxData.hasText || false;
        }
      } catch (e) {}

      // ثانياً: إرسال السؤال مع نص المحاضرة
      const res = await this.apiPost('/api/ai/ask', {
        prompt: hasText
          ? `اقرأ محتوى محاضرة (${lectureTitle}) التالية ثم أعطني: 1. ملخصاً مرتباً بالنقاط للأفكار الجوهرية، 2. أهم 5 أسئلة متوقعة مع إجاباتها بإيجاز.`
          : `اشرح لي بإيجاز ما الذي قد يتوقع الطالب تعلّمه من محاضرة بعنوان (${lectureTitle}) في مادة (${subjectName}).`,
        subjectTitle: subjectName,
        lectureTitle,
        text: lectureText,
        history: this._kedyHistory.slice()
      });

      const data = await res.json();
      if (data.success && data.answer) {
        this._kedyPushHistory('user', `اخترت محاضرة: ${lectureTitle}`);
        this._kedyPushHistory('assistant', data.answer);

        const sourceNote = hasText
          ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:8px;padding-top:6px;border-top:1px solid var(--border);"><i class="ri-file-pdf-line"></i> تم قراءة محتوى المحاضرة تلقائياً</div>`
          : `<div style="font-size:0.72rem;color:#f59e0b;margin-top:8px;padding-top:6px;border-top:1px solid var(--border);"><i class="ri-alert-line"></i> لم يُعثر على نص قابل للقراءة في هذه المحاضرة — يمكنك نسخ ولصق محتوى الـ PDF مباشرة</div>`;

        botMsg.innerHTML = this.formatAiResponse(data.answer) + sourceNote +
          this._noteSaveButton(lectureTitle, data.answer);
      } else {
        botMsg.innerHTML = '<span style="color:var(--danger)">' + this.escapeHTML(data.message || 'حدث خطأ') + '</span>';
      }
    } catch {
      botMsg.innerHTML = '<span style="color:var(--danger)">تعذّر الاتصال بالخادم الذكي</span>';
    }
    container.scrollTop = container.scrollHeight;
  },

  /* زر "حفظ في ملاحظاتي": كان يمرّر السؤال والإجابة نصاً داخل onclick='...'.
     escapeHTML يحوّل ' إلى &#39; لكن المتصفح يفكّها قبل تنفيذ JS، فأي إجابة فيها
     علامة ' (شائعة في الأكواد) تكسر الزر — ونص مُتلاعب به يُنفَّذ كسكربت.
     الآن يُحفظ النص في الذاكرة ويحمل الزر معرّفاً قصيراً فقط. */
  _noteStash: new Map(),

  _noteSaveButton(title, content) {
    const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this._noteStash.set(id, { title: String(title || ''), content: String(content || '') });
    if (this._noteStash.size > 100) this._noteStash.delete(this._noteStash.keys().next().value);
    return `<br><button onclick="CBS._saveStashedNote('${id}')" style="margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.75rem;font-weight:700;"><i class="ri-bookmark-3-line"></i> حفظ في ملاحظاتي</button>`;
  },

  _saveStashedNote(id) {
    const note = this._noteStash.get(id);
    if (note) this._saveGlobalNote(note.title, note.content);
  },

  _saveGlobalNote(title, content) {
    try {
      const notes = JSON.parse(localStorage.getItem('cbs_saved_notes') || '[]');
      notes.unshift({
        id: 'note_' + Date.now(),
        subject: 'المساعد الذكي (كيدي)',
        title: title || 'ملاحظة كيدي',
        content: content,
        date: new Date().toLocaleDateString('ar-EG-u-nu-latn', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      });
      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));
      this.toast('تم الحفظ في ملاحظاتك بنجاح ', '', 'success');
    } catch(e){}
  },

  _renderKedyGlobalNotes() {
    const panel = document.getElementById('gkNotesPanel');
    if (!panel) return;
    const notes = JSON.parse(localStorage.getItem('cbs_saved_notes') || '[]');
    if (!notes.length) {
      panel.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);"><i class="ri-bookmark-3-line" style="font-size:2.5rem;opacity:0.3;display:block;margin-bottom:8px;"></i>لا توجد ملاحظات محفوظة</div>';
      return;
    }
    panel.innerHTML = notes.map(n => `
      <div style="background:var(--bg-main,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:12px;margin-bottom:10px;position:relative;">
        <div style="font-weight:700;font-size:0.88rem;color:#4f46e5;margin-bottom:4px;">${this.escapeHTML(n.title)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;"><i class="ri-price-tag-3-line"></i> ${this.escapeHTML(n.subject)}  ${this.escapeHTML(n.date)}</div>
        <div style="font-size:0.83rem;line-height:1.6;white-space:pre-wrap;color:var(--text-main);">${this.escapeHTML(n.content)}</div>
      </div>
    `).join('');
  },

  _syncBnavBadge() {
    const bnav = document.getElementById('bnavNotifBadge');
    const hdr  = document.getElementById('notifBadge');
    if (!bnav || !hdr) return;
    bnav.textContent  = hdr.textContent;
    bnav.style.display = hdr.style.display;
  },

  /* A profile shortcut must exist on desktop too; the bottom navigation is
     deliberately mobile-only and previously hid fingerprint/account setup. */
  renderAccountShortcut() {
    if (window.location.pathname === '/profile.html' || document.getElementById('accountShortcut')) return;
    // على الهاتف يوجد عنصر "حسابي" في الشريط السفلي  لا داعي لزر ثان في الترويسة
    if (window.innerWidth <= 900) return;
    const actions = document.querySelector('.main-header .header-actions');
    if (!actions) return;
    const batchId = this.getBatchId();
    const account = document.createElement('a');
    account.id = 'accountShortcut';
    account.className = 'btn-icon';
    account.href = '/profile.html' + (batchId ? '?batch=' + encodeURIComponent(batchId) : '');
    account.title = 'حسابي وإعدادات الأمان';
    account.setAttribute('aria-label', 'حسابي وإعدادات الأمان');
    account.innerHTML = '<i class="ri-user-3-line"></i>';
    actions.prepend(account);
  },

  /* يغلق أعلى طبقة مفتوحة (نافذة منبثقة، عارض صور، قائمة جانبية، شات كيدي).
     يعيد true إذا أُغلق شيء — ليعرف زر الرجوع العتادي أنه استُهلك.
     المشروع يستخدم ثلاث اصطلاحات: .show و .active و .open، لذا نغطيها كلها. */
  _closeTopOverlay() {
    // عارض الملفات فوق كل شيء: الرجوع يُغلقه أولاً (لا يغادر الصفحة والملف مفتوح)
    const viewer = document.querySelector('.cv-overlay:not(.leaving) [data-cv="close"]');
    if (viewer) { viewer.click(); return true; }
    // الجولة الترحيبية: الرجوع = تخطٍّ (يحفظ أنها عُرضت)
    const obSkip = document.querySelector('.cbs-onboarding:not(.leaving) .ob-skip');
    if (obSkip) { obSkip.click(); return true; }
    // قائمة اختصارات كيدي (الضغطة المطوّلة)
    if (document.querySelector('.kf-menu.open')) { document.querySelector('.kf-scrim')?.click(); return true; }
    const lectureModal = document.getElementById('pdfModal');
    if (lectureModal && lectureModal.style.display === 'flex' && typeof window.closePdfModal === 'function') {
      // لوحة كيدي داخل صفحة المادة تُغلق قبل المحاضرة نفسها
      const aiPanel = document.getElementById('aiPanel');
      if (aiPanel && aiPanel.classList.contains('show') && typeof window.closeAiPanel === 'function') { window.closeAiPanel(); return true; }
      window.closePdfModal();
      return true;
    }
    const selectors = [
      '#globalKedyModal.active',
      '.lightbox-overlay.active', '#lightbox-modal.active', '#news-detail-modal.active',
      '.modal-overlay.show', '.modal-overlay.active',
      '.modal.show', '.modal.active',
      '.overlay.show', '.overlay.active',
      '#globalSearchOverlay.open', '.sidebar-overlay.open'
    ];

    const open = [];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        // نتجاهل ما هو مخفي فعلياً رغم امتلاكه الصنف
        if (el.offsetParent !== null || getComputedStyle(el).display !== 'none') open.push(el);
      });
    });
    if (!open.length) return false;

    // الأعلى في ترتيب الطبقات هو الذي يُغلق
    open.sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0));
    const top = open[0];
    top.classList.remove('show', 'active', 'open');
    document.body.style.overflow = '';
    return true;
  },

  /* المسارات التي لا تحتاج زر رجوع مهما كان الدور */
  _ALWAYS_ROOT_PAGES: ['/login.html', '/index.html', '/batch-selector.html', '/welcome.html'],

  /* هل الصفحة الحالية "جذرية" للمستخدم الحالي؟
     أي: تبويب في شريطه السفلي، أو صفحة دخول/اختيار دفعة. */
  isRootPage(path = window.location.pathname) {
    if (this._ALWAYS_ROOT_PAGES.includes(path)) return true;
    const tabs = this._bottomNavPaths;
    // قبل رسم الشريط (أو لمن لا شريط له) نعتمد على لوحتَي التحكم فقط
    if (!Array.isArray(tabs) || !tabs.length) {
      return path === '/dashboard.html' || path === '/admin_dashboard.html';
    }
    return tabs.includes(path);
  },

  /* ===== Mobile: Universal Back Button ===== */
  renderBackButton() {
    // زر الرجوع يظهر في كل صفحة ليست تبويباً في شريط هذا الدور
    if (this.isRootPage()) return false;

    const header = document.querySelector('.main-header') || document.querySelector('.dashboard-header');
    if (!header) return false;
    if (header.querySelector('.app-back-btn')) return true;

    const backBtn = document.createElement('button');
    backBtn.className = 'app-back-btn';
    backBtn.title = 'رجوع';
    backBtn.setAttribute('aria-label', 'رجوع');
    backBtn.innerHTML = '<i class="ri-arrow-right-line"></i>';
    backBtn.onclick = () => window.history.back();

    // Insert at the beginning of the header
    header.insertBefore(backBtn, header.firstChild);
    return true;
  },

  /* ===== إزالة الأزرار المكرّرة من الترويسة =====
     كانت كل صفحة تكتب زر "رجوع"/"الرئيسية" الخاص بها، ثم يضيف التطبيق زر الرجوع
     الموحّد وشريط التنقل السفلي فوقه  فيظهر زران بنفس الوظيفة جنباً إلى جنب. */
  _dedupeHeaderControls(hasInjectedBack) {
    const header = document.querySelector('.main-header') || document.querySelector('.dashboard-header');
    if (!header) return;
    const hasBottomNav = !!document.getElementById('bottom-nav');
    if (!hasInjectedBack && !hasBottomNav) return;

    const isBackLike = el => {
      const onclick = el.getAttribute('onclick') || '';
      return /history\.back\s*\(/.test(onclick) ||
             !!el.querySelector('.ri-arrow-right-line, .ri-arrow-go-back-line, .ri-arrow-left-line');
    };
    const isHomeLike = el => {
      const onclick = el.getAttribute('onclick') || '';
      return /CBS\.goHome\s*\(/.test(onclick) ||
             /location\.href\s*=\s*['"]\/(dashboard|admin_dashboard)\.html/.test(onclick);
    };

    header.querySelectorAll('button.btn-icon, a.btn-icon').forEach(el => {
      if (el.classList.contains('app-back-btn') || el.id === 'accountShortcut') return;
      if (hasInjectedBack && isBackLike(el)) { el.remove(); return; }   // مكرر مع زر الرجوع الموحّد
      if (hasBottomNav && isHomeLike(el)) el.remove();                  // مكرر مع "الرئيسية" في الشريط السفلي
    });
  },

  /* تسع صفحات كانت تعرض عنوانها مرتين: مرة في البانر الملوّن (.welcome-banner)
     ومرة في ترويسة الصفحة (.page-header). نبقي البانر ونحذف العنوان المكرر
     مع الحفاظ على أزرار الإجراءات الموجودة في الترويسة. */
  _dedupePageHeadings() {
    const banner = document.querySelector('.welcome-banner');
    const header = document.querySelector('.page-header');
    if (!banner || !header) return;
    const titleBlock = header.querySelector('.page-header-left');
    if (!titleBlock) return;

    // بعض العناوين الفرعية عدّادات تحدَّث بالـ id (مثل "جاري التحميل...").
    // ننقل الـ id إلى نص البانر أولاً، وإن تعذّر نبقي الترويسة كما هي
    // حتى لا ينهار كود يبحث عن العنصر بـ getElementById.
    const dynamic = titleBlock.querySelector('[id]');
    if (dynamic) {
      const bannerText = banner.querySelector('.welcome-banner-body p') || banner.querySelector('p');
      if (!bannerText) return;
      bannerText.id = dynamic.id;
      bannerText.textContent = dynamic.textContent;
      dynamic.removeAttribute('id');
    }

    titleBlock.remove();
    if (header.querySelector('button, a, .btn')) {
      header.classList.add('page-header-actions-only');
    } else {
      header.remove();
    }
  },

  /* عدّ عربي صحيح: arCount(1,['مقرر واحد','مقرران','مقررات','مقرراً']) ← "مقرر واحد"،
     2 ← "مقرران"، 3..10 ← "3 مقررات"، 11+ ← "11 مقرراً"، 0 ← "لا مقررات" */
  arCount(n, [one, two, few, many]) {
    n = Number(n) || 0;
    if (n === 0) return `لا ${few}`;
    if (n === 1) return one;
    if (n === 2) return two;
    const rem = n % 100;
    return `${n} ${rem >= 3 && rem <= 10 ? few : many}`;
  },

  /* موعد مقروء: "اليوم" / "غداً" / "بعد 3 أيام" / تاريخ — والإلحاح بلون (tone) */
  dueLabel(when) {
    const d = new Date(when);
    if (isNaN(d)) return { text: '', tone: '' };
    const day = x => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y; };
    const days = Math.round((day(d) - day(new Date())) / 864e5);
    if (days < 0) return { text: 'فات الموعد', tone: 'danger' };
    if (days === 0) return { text: 'اليوم', tone: 'danger' };
    if (days === 1) return { text: 'غداً', tone: 'warning' };
    if (days === 2) return { text: 'بعد يومين', tone: 'warning' };
    if (days <= 10) return { text: `بعد ${days} أيام`, tone: '' };
    return { text: d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' }), tone: '' };
  },

  /* ===== توحيد هيكل الصفحات الداخلية =====
     كانت لكل صفحة ترويستها: شعار + "كلية النصر التقنية" + عنوان فرعي صغير، ثم
     بطاقة تكرر العنوان بأيقونة ووصف، وزرا الخروج والوضع الليلي في كل صفحة.
     الآن (docs/design/home-screens.md): رجوع · عنوان الصفحة · إجراءاتها،
     والبطاقة تصير سطر سياق. التنسيق في css/ui.css تحت body.app-inner. */
  _normalizeShell() {
    const header = document.querySelector('.main-header');
    if (!header) return;
    // الخروج والوضع الليلي في "حسابي" — كانا بجانب البحث في كل ترويسة
    header.querySelectorAll('.header-actions [onclick]').forEach(el => {
      if (/CBS\.logout\s*\(|toggleDark\s*\(/.test(el.getAttribute('onclick') || '')) el.remove();
    });

    const path = window.location.pathname;
    if (path === '/dashboard.html' || path === '/admin_dashboard.html') return;
    document.body.classList.add('app-inner');

    const strong = header.querySelector('.header-title-group strong');
    const banner = document.querySelector('.welcome-banner');
    const heading = banner?.querySelector('h2, h1');
    const small = header.querySelector('.header-title-group small');
    // بعض الصفحات تضع عنوانها الحقيقي في <strong> وشعاراً وصفياً في <small> ("تقييم عادل وسريع")
    const ownTitle = strong && !/كلية النصر/.test(strong.textContent) ? strong.textContent.trim() : '';
    const setTitle = () => {
      const text = heading?.textContent.trim() || ownTitle || small?.textContent.trim() || document.title.split('|')[0].trim();
      if (strong && text) strong.textContent = text;
      document.querySelectorAll('.page-header .page-title').forEach(t => {
        if (t.textContent.trim() === text) t.style.display = 'none';
      });
    };
    setTitle();
    // عناوين تُملأ بعد التحميل (اسم المادة مثلاً) تتبعها الترويسة
    const watched = heading || small;
    if (watched) new MutationObserver(setTitle).observe(watched, { childList: true, characterData: true, subtree: true });

    if (banner) {
      banner.classList.add('page-lead');
      const lead = banner.querySelector('p');
      // بطاقة بلا وصف ولا عدّاد ديناميكي لم يعد فيها ما يُعرض
      if (!lead || (!lead.id && !lead.textContent.trim())) banner.style.display = 'none';
    }
  },

  /* ===== Splash Screen ===== */
  showSplash() {
    if (document.getElementById('app-splash')) return;
    const splash = document.createElement('div');
    splash.id = 'app-splash';
    splash.innerHTML = `
      <img src="/assets/logo.png" class="splash-logo" alt="Logo" onerror="this.style.display='none'">
      <div class="uib-loader"><div class="half"></div><div class="half"></div></div>
      <div class="splash-title">كلية النصر التقنية<br><small style="font-weight:400;font-size:0.75em;opacity:0.7">جامعة النصر التقنية</small></div>
    `;
    document.body.appendChild(splash);
  },

  hideSplash() {
    const splash = document.getElementById('app-splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }
  },

  /* ===== UIB Loading State & Skeletons ===== */
  showLoading(containerId, msg = 'جاري التحميل...', type = 'spinner') {
    const el = document.getElementById(containerId);
    if (!el) return;
    
    if (type === 'skeleton-grid') {
      let html = '';
      for(let i=0; i<6; i++) {
        html += `
          <div class="skeleton-card">
            <div class="skeleton skeleton-text" style="height: 120px; border-radius: 8px;"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text short"></div>
          </div>
        `;
      }
      el.innerHTML = html;
    } else if (type === 'skeleton-list') {

      let html = '';

      for(let i=0; i<5; i++) {

        html += `

          <div class="skeleton-list-item">

            <div class="skeleton skeleton-avatar"></div>

            <div style="flex:1">

              <div class="skeleton skeleton-text"></div>

              <div class="skeleton skeleton-text short"></div>

            </div>

          </div>

        `;

      }

      el.innerHTML = html;

    } else {

      el.innerHTML = `

        <div class="loading-state">

          <div class="uib-loader dark"><div class="half"></div><div class="half"></div></div>

          <p>${msg}</p>

        </div>`;

    }

  },



  /* ===== Init ===== */

  init(options = {}) {

    // وضع الأداء: WebView أندرويد ينهار مع طبقات blur المتعددة  نعطلها داخل التطبيق فقط

    if (this._isCapacitor() && window.Capacitor?.getPlatform?.() === 'android') {

      document.documentElement.classList.add('perf-lite');
    }
    this.setYear();
    this.initDarkMode();
    this.initModalClose();
    this.initKeyboardSuggestions();
    // رسالة مؤجلة من صفحة سابقة أعادت التوجيه (مثل رفض الصلاحية)
    try {
      const flash = sessionStorage.getItem('cbs_flash');
      if (flash) {
        sessionStorage.removeItem('cbs_flash');
        setTimeout(() => this.toast(flash, '', 'error'), 400);
      }
    } catch (e) {}
    this.initHaptics();
    this._injectMobileCSS();
    this.initPullToRefresh();
    this.initBackgroundSync();
    this.checkAppVersion();

    /* شريط الحالة على أندرويد 15 (SDK 35+):
       - setBackgroundColor يعتمد على Window.setStatusBarColor المتوقّفة نهائياً
         وأصبح بلا أثر، والنظام يفرض "العرض حتى حافة الشاشة".
       - setOverlaysWebView({overlay:false}) كان يلغي هذا العرض تحديداً وهو
         ما تحذّر منه Google  أزيل.
       يبقى فقط ضبط لون أيقونات الشريط ليطابق سمة التطبيق (فاتح/داكن)،
       لأن المحتوى صار يرسم خلف الشريط مباشرةً. */
    if (this._isCapacitor()) {
      const StatusBar = window.Capacitor?.Plugins?.StatusBar;
      if (StatusBar?.setOverlaysWebView) StatusBar.setOverlaysWebView({ overlay: true }).catch(()=>{});
      // خارج الشرط: المزامنة تعتمد إضافة SystemBars الخاصة بنا لا StatusBar
      this._syncStatusBarStyle();
    }

    const batchColor = localStorage.getItem('cbs_active_batch_color');
    if (batchColor) {
      document.documentElement.style.setProperty('--primary', batchColor);
      document.documentElement.style.setProperty('--primary-light', batchColor + '15');
    }

    if (options.requireAuth !== false) {
      if (!this.requireAuth()) return false;
      
      const user = this.getUser();
      // Single role check (legacy)
      if (options.requireRole) {
        if (!user.roles || !user.roles.includes(options.requireRole)) {
          // رسالة تُعرض في الصفحة التالية (alert() يظهر نافذة نظام بعنوان الموقع داخل التطبيق)
          try { sessionStorage.setItem('cbs_flash', 'لا تملك صلاحيات للوصول إلى هذه الصفحة'); } catch (e) {}
          CBS._leavingPage = true;
          window.location.replace('/dashboard.html');
          document.body.style.display = 'none';
          return false;
        }
      }
      
      // Multiple roles check (new)
      if (options.requireRoles && Array.isArray(options.requireRoles)) {
        if (!user.roles || !options.requireRoles.some(r => user.roles.includes(r))) {
          // رسالة تُعرض في الصفحة التالية (alert() يظهر نافذة نظام بعنوان الموقع داخل التطبيق)
          try { sessionStorage.setItem('cbs_flash', 'لا تملك صلاحيات للوصول إلى هذه الصفحة'); } catch (e) {}
          CBS._leavingPage = true;
          window.location.replace('/dashboard.html');
          document.body.style.display = 'none';
          return false;
        }
      }
      if (options.polling !== false) this.startNotifPolling();
      this.verifyToken();
      this.renderAccountShortcut();
      this.renderBatchSwitcher();
      this.initKeyboardAwareness();
      if (window.innerWidth <= 900) this.renderBottomNav();
      else this._navItemsForRole();  // نحسب التبويبات ليعرف زر الرجوع أيها جذري
      this._maybeShowOnboarding();

      const hasInjectedBack = this.renderBackButton(); // Add back button if child page
      this._dedupeHeaderControls(hasInjectedBack);     // إزالة أزرار الصفحة المكرّرة
      this._dedupePageHeadings();                      // إزالة العناوين المكرّرة
      this._normalizeShell();                          // ترويسة موحّدة: رجوع · العنوان · الإجراءات
      this._initGlobalSearch(); // Global search overlay
      this.initScrollAnimations(); // Scroll animations for cards and stats
      
      // تهيئة الإشعارات الحقيقية (FCM) وقنوات Android (تطبيق الهاتف فقط) — القنوات تُنشأ داخلها
      this._initPushNotifications();
      this.requestNotifPermission();
    }
    
    // Hardware Back Button (Android)
    if (this._isCapacitor() && window.Capacitor?.Plugins?.App) {
      /* يعمل فقط مع إضافة @capacitor/app — كانت غير مثبّتة، فلم يُسجَّل هذا
         المستمع أصلاً وكان أندرويد يغلق التطبيق من أول ضغطة رجوع. */
      window.Capacitor.Plugins.App.addListener('backButton', ({ canGoBack } = {}) => {
        // 1) أي طبقة مفتوحة تُغلق أولاً — سلوك التطبيقات الأصلية.
        //    كان زر الرجوع يغادر الصفحة كلها والنافذة المنبثقة مفتوحة.
        if (this._closeTopOverlay()) return;

        const path = window.location.pathname;
        const isHome = path === '/dashboard.html' || path === '/admin_dashboard.html' || this._ALWAYS_ROOT_PAGES.includes(path);

        // 2) تبويب آخر في الشريط السفلي → الرئيسية أولاً، لا الخروج
        if (this.isRootPage() && !isHome) { this.goHome(); return; }

        // 3) الرئيسية → تأكيد قبل الخروج
        if (this.isRootPage() || isHome) {
          if (this._exitArmed) {
            window.Capacitor.Plugins.App.exitApp();
            return;
          }
          this._exitArmed = true;
          this.toast('اضغط رجوع مرة أخرى للخروج', '', 'info', 2000);
          clearTimeout(this._exitTimer);
          this._exitTimer = setTimeout(() => { this._exitArmed = false; }, 2000);
          return;
        }

        // 4) صفحة داخلية → رجوع خطوة، وإن لم يوجد سجل تصفح نعود للوحة المناسبة
        if (canGoBack ?? window.history.length > 1) window.history.back();
        else this.goHome();
      });
    }
    
    return true;
  },

  /* ===== حاسبة المعدل (GPA) =====
     أداة تقديرية للطالب فقط: لا يوجد حقل ساعات معتمدة في نموذج المادة، لذلك
     تبدأ كل مادة بـ 3 ساعات ويعدّلها الطالب. لا تُحفظ أي بيانات على الخادم. */
  _GPA_GRADES: [
    ['4.00', 'A+'], ['3.75', 'A'], ['3.50', 'B+'], ['3.00', 'B'],
    ['2.50', 'C+'], ['2.00', 'C'], ['1.50', 'D'], ['0.00', 'F']
  ],

  _gpaRowHTML(name = '', hours = 3) {
    const opts = this._GPA_GRADES.map(([v, l]) => `<option value="${v}">${l} (${v})</option>`).join('');
    return `
      <td><input type="text" class="form-control gpa-sub-name" value="${this.escapeHTML(name)}" placeholder="اسم المقرر" aria-label="اسم المقرر"></td>
      <td><input type="number" min="1" max="6" step="1" class="form-control gpa-sub-hours" value="${Number(hours) || 3}" oninput="CBS._calcGpa()" aria-label="الساعات المعتمدة"></td>
      <td><select class="form-control gpa-sub-grade" onchange="CBS._calcGpa()" aria-label="التقدير">${opts}</select></td>
      <td><button type="button" class="btn-icon gpa-del" onclick="this.closest('tr').remove(); CBS._calcGpa();" title="حذف المقرر" aria-label="حذف المقرر"><i class="ri-delete-bin-line"></i></button></td>`;
  },

  async openGpaCalculatorModal() {
    let modal = document.getElementById('cbsGpaModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'cbsGpaModal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    let subjects = [];
    try {
      const res = await this.apiGet('/api/subjects?limit=12');
      if (res && res.ok) {
        const json = await res.json();
        const d = json?.data;
        subjects = Array.isArray(d) ? d : (Array.isArray(d?.subjects) ? d.subjects : []);
      }
    } catch (e) {}

    modal.innerHTML = `
      <div class="modal-box gpa-modal" role="dialog" aria-modal="true" aria-labelledby="gpaModalTitle">
        <div class="gpa-modal-head">
          <div>
            <h3 id="gpaModalTitle"><i class="ri-calculator-line"></i> حاسبة المعدل الفصلي</h3>
            <small>تقدير تقريبي — عدّل الساعات والتقديرات حسب لائحة كليتك</small>
          </div>
          <button type="button" class="modal-close" onclick="CBS.closeModal('cbsGpaModal')" aria-label="إغلاق">&times;</button>
        </div>

        <div class="gpa-modal-body">
          <div class="gpa-dial-container">
            <div class="gpa-score-display" id="gpaScoreDisplay">—</div>
            <div class="gpa-scale-label">المعدل المتوقع من 4.00</div>
            <div class="gpa-honors-pill" id="gpaHonorsPill" hidden></div>
          </div>

          <div class="gpa-table-head">
            <strong>المقررات</strong>
            <button type="button" class="btn btn-xs btn-outline-primary" onclick="CBS._addGpaRow()"><i class="ri-add-line"></i> إضافة مقرر</button>
          </div>

          <table class="gpa-subject-table">
            <thead><tr><th>المقرر</th><th>الساعات</th><th>التقدير</th><th></th></tr></thead>
            <tbody id="gpaSubjectsTbody">
              ${subjects.map(s => `<tr class="gpa-row">${this._gpaRowHTML(s.name)}</tr>`).join('')}
            </tbody>
          </table>
          <p class="gpa-empty" id="gpaEmpty" hidden>أضف مقرراً واحداً على الأقل لحساب المعدل.</p>
        </div>
      </div>`;

    if (!subjects.length) this._addGpaRow();
    this.openModal('cbsGpaModal');
    this._calcGpa();
  },

  _addGpaRow() {
    const tbody = document.getElementById('gpaSubjectsTbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'gpa-row';
    tr.innerHTML = this._gpaRowHTML();
    tbody.appendChild(tr);
    tr.querySelector('.gpa-sub-name')?.focus();
    this._calcGpa();
  },

  _calcGpa() {
    let totalPoints = 0;
    let totalHours = 0;
    document.querySelectorAll('#gpaSubjectsTbody tr').forEach(r => {
      const h = Math.max(0, parseFloat(r.querySelector('.gpa-sub-hours')?.value) || 0);
      const g = parseFloat(r.querySelector('.gpa-sub-grade')?.value) || 0;
      totalPoints += h * g;
      totalHours += h;
    });

    const display = document.getElementById('gpaScoreDisplay');
    const pill = document.getElementById('gpaHonorsPill');
    const empty = document.getElementById('gpaEmpty');
    if (empty) empty.hidden = totalHours > 0;

    if (!totalHours) {
      if (display) display.textContent = '—';
      if (pill) pill.hidden = true;
      return;
    }

    const gpa = totalPoints / totalHours;
    if (display) display.textContent = gpa.toFixed(2);

    const bands = [
      [3.5, 'ممتاز', 'success'], [3.0, 'جيد جداً', 'info'], [2.5, 'جيد', 'primary'],
      [2.0, 'مقبول', 'warning'], [0, 'دون الحد الأدنى', 'danger']
    ];
    const [, label, tone] = bands.find(([min]) => gpa >= min);
    if (pill) {
      pill.hidden = false;
      pill.textContent = label;
      pill.dataset.tone = tone;
    }
  },

  /* ===== حقن mobile.css للموبايل ===== */
  _injectMobileCSS() {
    if (document.getElementById('mobile-css')) return;
    // معظم الصفحات تربط mobile.css في <head> مسبقاً؛ الحقن كان ينزّل الملف مرة ثانية
    // بنسخة مختلفة (?v=) فيتضاعف الطلب وقد تفوز نسخة قديمة من الكاش.
    if (document.querySelector('link[rel="stylesheet"][href*="/css/mobile.css"]')) return;
    const link = document.createElement('link');
    link.id   = 'mobile-css';
    link.rel  = 'stylesheet';
    link.href = '/css/mobile.css?v=' + this.ASSET_VERSION;
    document.head.appendChild(link);
  },

  /* ===== Pull To Refresh ===== */
  initPullToRefresh() {
    // Only apply on mobile devices where touch is supported
    if (!('ontouchstart' in window)) return;
    
    const ptr = document.createElement('div');
    ptr.className = 'ptr-element';
    ptr.innerHTML = '<i class="ri-refresh-line"></i>';
    document.body.appendChild(ptr);

    let startY = 0;
    let startX = 0;
    let isPulling = false;
    let dist = 0;

        const shouldPreventPTR = (target) => {
      // 1. Block if PDF modal, viewer or any modal/overlay/sidebar is open
      const pdfModal = document.getElementById('pdfModal');
      if (pdfModal && (pdfModal.style.display === 'flex' || pdfModal.style.display === 'block')) return true;
      if (document.querySelector('.modal-overlay.show, .modal.show, .modal-open, .lightbox-overlay.active, #globalSearchOverlay, #iosInstallOverlay, .sidebar.open, .subject-sidebar.active')) return true;

      // 2. Block if user is focusing or typing in any form control
      const activeEl = document.activeElement;
      if (activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName)) return true;

      // 3. Block if touch started inside a form, input, modal, PDF viewer, editor, AI container, sidebar or opted-out container
      if (target && target.closest && target.closest('form, .modal-overlay, .modal-box, .modal-body, #pdfModal, #pdfCanvasWrap, iframe, canvas, input, textarea, select, .editor, .input-wrap, [contenteditable], [data-no-ptr], .subject-sidebar, .ai-chat, .ai-container, .ai-section, #aiChatMessages, .chat-box, .sidebar, .tab-pane, .tab-content, [class*="ai-"], [class*="sidebar"], [id*="ai"]')) return true;

      // 4. Block if target or any parent is an internal scrollable container
      let el = target;
      while (el && el !== document.body && el !== document.documentElement) {
        if (el.nodeType === 1) {
          const style = window.getComputedStyle(el);
          const overflowY = style.overflowY;
          if (overflowY === 'auto' || overflowY === 'scroll') {
            return true;
          }
        }
        el = el.parentElement;
      }

      // 5. Block if any editable area on the page has unsaved content
      if (Array.from(document.querySelectorAll('[contenteditable]')).some(el => el.textContent.trim() !== '')) return true;

      // 6. Block if any form on the page contains active unsubmitted user inputs
      const dirtyForm = Array.from(document.querySelectorAll('form input:not([type="hidden"]), form textarea')).some(el => el.value && el.value.trim() !== '');
      if (dirtyForm) return true;

      return false;
    };

    document.addEventListener('touchstart', (e) => {
      // كان الخروج المبكر هنا يترك isPulling وstartY من لمسة سابقة، فتُحسب
      // مسافة سحب خاطئة في اللمسة التالية. نصفّر الحالة دائماً أولاً.
      if (window.scrollY > 5) { isPulling = false; return; }
      if (shouldPreventPTR(e.target)) {
        isPulling = false;
        return;
      }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      dist = 0; // مسافة اللمسة السابقة قد تبقى لو ألغي السحب في منتصفه
      isPulling = true;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!isPulling) return;

      const y = e.touches[0].clientY;
      dist = y - startY;

      // سحبة مائلة (أفقية أكثر من عمودية) = المستخدم يتنقل، ليست طلب تحديث
      const distX = Math.abs(e.touches[0].clientX - startX);
      if (distX > Math.abs(dist)) {
        isPulling = false;
        ptr.style.transform = 'translateY(-100%)';
        document.body.classList.remove('ptr-pulling');
        return;
      }

      // سحب للأسفل أو الصفحة انتقلت → أوقف الـ PTR ودع التمرير الطبيعي
      if (dist < 0 || window.scrollY > 5) {
        isPulling = false;
        ptr.style.transform = 'translateY(-100%)';
        document.body.classList.remove('ptr-pulling');
        return;
      }

      // سحب للأعلى من قمة الصفحة = PTR فعلي
      if (dist > 0 && window.scrollY <= 0) {
        if (e.cancelable) e.preventDefault();
        ptr.style.transform = `translateY(${Math.min(dist - 60, 30)}px)`;
        if (dist > 130) document.body.classList.add('ptr-pulling');
        else document.body.classList.remove('ptr-pulling');
      }
    }, { passive: false });

    /* أندرويد يُطلق touchcancel (لا touchend) عند مقاطعة اللمسة — مكالمة،
       إشعار، أو خروج الإصبع من حافة الشاشة. بدون هذا المستمع تبقى حالة
       السحب عالقة على true مع مؤشر رأسي قديم. */
    document.addEventListener('touchcancel', () => {
      isPulling = false;
      dist = 0;
      ptr.style.transform = 'translateY(-100%)';
      document.body.classList.remove('ptr-pulling', 'ptr-refreshing');
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!isPulling) return;
      isPulling = false;

      if (dist > 130 && window.scrollY <= 0) {
        document.body.classList.add('ptr-refreshing');
        ptr.style.transform = 'translateY(25px)';
        const done = () => {
          document.body.classList.remove('ptr-refreshing', 'ptr-pulling');
          ptr.style.transform = 'translateY(-100%)';
        };
        // الصفحة التي تعرّف مستمع cbs:refresh (مع preventDefault) تجدد بياناتها فقط 
        // أسرع بكثير من إعادة تحميل كاملة. غير ذلك نرجع لإعادة التحميل.
        const evt = new CustomEvent('cbs:refresh', { cancelable: true, detail: { done } });
        const notHandled = document.dispatchEvent(evt);
        if (notHandled) setTimeout(() => location.reload(), 400);
      } else {
        ptr.style.transform = 'translateY(-100%)';
        document.body.classList.remove('ptr-pulling');
      }
      dist = 0;
    });
  },

  /* ===== Background Sync ===== */
  initBackgroundSync() {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then(swRegistration => {
        // We will register a tag 'sync-submissions'
        // This is a placeholder that prepares the SW to expect sync requests
        // Actual registration happens when a submission fails while offline.
      }).catch(console.error);
    }
  },

  /* ===== إنشاء قنوات الإشعارات في Android =====
     تُنشأ عبر PushNotifications لأن LocalNotifications غير مثبّت في التطبيق؛ كانت
     القنوات لا تُنشأ إطلاقاً فيعرض Android إشعارات FCM في قناة احتياطية بلا نغمتنا.
     المعرّفات cbs_* جديدة عمداً: إعدادات القناة لا تتغير بعد إنشائها على الجهاز.
     يجب أن تطابق CHANNELS في utils/fcmService.js. */
  async _initNotifChannels() {
    const plugin = window.Capacitor?.Plugins?.PushNotifications || this._getLocalNotif();
    if (!plugin?.createChannel || window.Capacitor?.getPlatform?.() !== 'android') return;
    try {
      // قناة الإشعارات العادية  نغمة cbs_notif المخصصة
      await plugin.createChannel({
        id:          'cbs_general',
        name:        'إشعارات كلية النصر التقنية',
        description: 'الإشعارات الاعتيادية من كلية النصر التقنية',
        importance:  4,              // IMPORTANCE_HIGH  لضمان الصوت دائماً
        visibility:  1,              // VISIBILITY_PUBLIC
        sound:       'cbs_notif', // ملف res/raw/cbs_notif.wav
        vibration:   true,
        lights:      true,
        lightColor:  '#2563eb'
      });
      // قناة الإشعارات الطارئة  نغمة La-La-Do الأعلى
      await plugin.createChannel({
        id:          'cbs_emergency',
        name:        'إشعارات طارئة',
        description: 'تنبيهات عاجلة وطارئة  صوت مميز وأولوية قصوى',
        importance:  5,               // IMPORTANCE_MAX
        visibility:  1,
        sound:       'cbs_emergency', // ملف res/raw/cbs_emergency.wav
        vibration:   true,
        lights:      true,
        lightColor:  '#ef4444'
      });
    } catch { /* silent  قد لا يدعمها الجهاز */ }
  },


  /* ===== تهيئة Push Notifications (FCM) عبر Capacitor ===== */
  async _initPushNotifications() {
    if (!this._isCapacitor() || !window.Capacitor?.Plugins?.PushNotifications) return;
    const PushNotifications = window.Capacitor.Plugins.PushNotifications;
    
    try {
      // المستمعون قبل register(): حدث registration قد يصل فوراً، وكان يضيع حين
      // يُضاف المستمع بعده فلا يُرسل التوكن للخادم ولا تصل الإشعارات لذلك الجهاز
      await this._initNotifChannels();

      // عند استلام التوكن من Firebase، نرسله للـ Backend ونربطه بحساب المستخدم الحالي
      PushNotifications.addListener('registration', async (token) => {
        if (!token?.value) return;
        try {
          await this.apiPost('/api/device/register', { token: token.value });
          localStorage.setItem('fcm_token', token.value);
          console.log(' FCM Token Registered for User');
        } catch(err) {
          console.warn('  FCM Token Register Warn:', err.message);
        }
      });

      // عند حدوث خطأ في التسجيل
      PushNotifications.addListener('registrationError', (error) => {
        console.error(' Push registration error: ', JSON.stringify(error));
      });

      // استلام إشعار والتطبيق مفتوح (Foreground)
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        // الـ LocalNotification و الـ FCM بيشتغلوا مع بعض، فممكن نعرضه كـ Toast أو نكتفي بإشعار النظام
        const isEmergency = notification.data?.isEmergency === 'true';
        this.toast(notification.title || 'إشعار جديد', notification.body, isEmergency ? 'emergency' : 'info', isEmergency ? 10000 : 5000);
      });

      // النقر على الإشعار من خارج التطبيق
      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        // توجيه لصفحة الإشعارات داخل التطبيق عند النقر
        window.location.href = '/notifications.html';
      });

      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive !== 'granted') {
        permStatus = await PushNotifications.requestPermissions();
      }
      if (permStatus.receive === 'granted') {
        await PushNotifications.register();
      }

    } catch (err) {
      console.error('Push Notifications Error:', err);
    }
  },

  /* ===== Service Worker Registration ===== */
  _registerSW() {
    if ('serviceWorker' in navigator && !this._isCapacitor()) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(reg => {
            console.log('[SW] Registered:', reg.scope);
            // تحقق من تحديثات كل ساعة
            setInterval(() => reg.update(), 60 * 60 * 1000);

            // إشعار "يوجد تحديث جديد": نسخة جديدة جاهزة لكنها تنتظر إغلاق كل التبويبات 
            // نعرض شريطاً بزر يحدّث فوراً بدل انتظار المستخدم
            const showUpdateBar = (waiting) => {
              if (document.getElementById('cbsUpdateBar')) return;
              const bar = document.createElement('div');
              bar.id = 'cbsUpdateBar';
              // فوق الشريط السفلي وزر كيدي (كان bottom:80px فيتراكب مع الشريط السفلي)
              bar.style.cssText = 'position:fixed;bottom:calc(var(--fab-bottom, 106px) + 60px + env(safe-area-inset-bottom,0px));left:12px;right:12px;margin:0 auto;width:fit-content;justify-content:space-between;z-index:99999;background:#0d3b66;color:#fff;border-radius:14px;padding:12px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,0.4);font-family:inherit;direction:rtl;max-width:calc(100% - 24px);';
              bar.innerHTML = '<i class="ri-refresh-line" style="font-size:1.2rem;color:#60a5fa;"></i><span style="font-size:0.85rem;font-weight:600;">يتوفر تحديث جديد للتطبيق</span><button id="cbsUpdateNow" style="border:none;background:#2563eb;color:#fff;border-radius:8px;padding:8px 14px;font-weight:700;font-family:inherit;cursor:pointer;font-size:0.82rem;white-space:nowrap;">حدّث الآن</button>';
              document.body.appendChild(bar);
              document.getElementById('cbsUpdateNow').onclick = () => {
                waiting.postMessage({ type: 'SKIP_WAITING' });
              };
            };

            if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
            reg.addEventListener('updatefound', () => {
              const nw = reg.installing;
              if (!nw) return;
              nw.addEventListener('statechange', () => {
                if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(nw);
              });
            });
            let reloaded = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              if (reloaded) return; reloaded = true;
              window.location.reload();
            });
          })
          .catch(err => console.warn('[SW] Registration failed:', err));
      });
    }
  },

  /* ===== ضغط الصور قبل الرفع =====
     يقلّص أبعاد وحجم الصور (كاميرا الهواتف تنتج 3-8 ميجابايت) لتسريع الرفع
     وتوفير البيانات. الملفات غير الصورية (PDF) تعاد كما هي دون مساس. */
  async compressImage(file, { maxDim = 1600, quality = 0.72, maxBytes = 900 * 1024 } = {}) {
    try {
      if (!file || !file.type || !file.type.startsWith('image/')) return file;
      if (file.type === 'image/gif') return file; // الحركة تضيع عند التحويل
      if (file.size <= maxBytes && file.size < 1.5 * 1024 * 1024) return file; // صغيرة أصلاً

      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = dataUrl;
      });

      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob || blob.size >= file.size) return file; // لم ننجح في التصغير، نبقي الأصل

      const newName = file.name.replace(/\.(png|jpe?g|webp|bmp|heic|heif)$/i, '') + '.jpg';
      return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (e) {
      console.warn('compressImage failed, using original:', e);
      return file;
    }
  },

  /* ===== Web Push (متصفح/آيفون PWA) ===== */
  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  },

  // يطلب من زر صريح (إذن الإشعارات يحتاج إيماءة مستخدم، خصوصاً على iOS).
  // يعيد true عند النجاح.
  async enableWebPush() {
    try {
      if (this._isCapacitor()) return false; // التطبيق الأصلي يستخدم FCM
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      const keyRes = await this.apiGet('/api/device/webpush/key');
      const { key, enabled } = await keyRes.json();
      if (!enabled || !key) { console.warn('[Push] VAPID غير معدّ في الخادم'); return false; }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this._urlBase64ToUint8Array(key)
        });
      }
      const res = await this.apiPost('/api/device/webpush/subscribe', sub.toJSON());
      return res.ok;
    } catch (e) {
      console.warn('[Push] enableWebPush failed:', e);
      return false;
    }
  },

  // مزامنة صامتة: لو الإذن ممنوح مسبقاً نتأكد أن الاشتراك محفوظ في الخادم
  // (الاشتراك قد يتغيّر أو يفقد بعد تحديث). لا يطلب إذناً ولا يزعج المستخدم.
  async _syncWebPush() {
    try {
      if (this._isCapacitor()) return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      if (Notification.permission !== 'granted') return;
      if (!this.getToken()) return;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await this.apiPost('/api/device/webpush/subscribe', sub.toJSON());
      } else {
        await this.enableWebPush(); // الإذن ممنوح فإعادة الاشتراك لن تظهر أي نافذة
      }
    } catch (e) { /* صامت */ }
  }

};

/* ===== تسجيل Service Worker تلقائياً ===== */
CBS._registerSW();

/* مزامنة اشتراك Web Push بصمت لمن فعّلها سابقاً */
CBS._syncWebPush();

/* =====================================================
   Global Error Handling & Enhancements
   ===================================================== */
window.addEventListener('error', function(event) {
  console.error("Global Error Caught:", event.error);
  if (typeof CBS !== 'undefined' && typeof CBS.toast === 'function') {
    CBS.toast('تنبيه نظام', 'حدث خطأ برمجي غير متوقع. جاري العمل على استقرار الجلسة.', 'error', 4000);
  }
});

window.addEventListener('unhandledrejection', function(event) {
  console.error("Unhandled Promise Rejection:", event.reason);
});


/* ===== Global Search Keyboard Shortcut (Ctrl+K / Cmd+K) ===== */
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); CBS.openSearch?.(); }
  if (e.key === 'Escape') CBS.closeSearch?.();
});


/* ===== PWA Install Prompt (Android / Desktop) ===== */

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById('pwaInstallBtn');
  if (installBtn) {
    installBtn.style.display = 'flex';
    installBtn.addEventListener('click', async () => {
      installBtn.style.display = 'none';
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`PWA Install outcome: ${outcome}`);
      deferredPrompt = null;
    });
  }
});

/* ===== iOS PWA Install  Maximum Ease ===== */
(function iosInstall() {
  const isCapacitor = !!(window.Capacitor?.isNativePlatform?.());
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (isCapacitor || isStandalone) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (!isIOS) return;  // على Android يعمل beforeinstallprompt بدون هذا

  const SHOW_KEY   = 'pwa_ios_shown_count';
  const DISMISS_KEY = 'pwa_ios_perm_dismissed';

  // إذا رفض المستخدم نهائياً (لا تظهر له مجدداً)
  if (localStorage.getItem(DISMISS_KEY)) return;

  let bannerActive = false;

  // ===== CSS =====
  function injectStyle() {
    if (document.getElementById('iosInstallStyle')) return;
    const s = document.createElement('style');
    s.id = 'iosInstallStyle';
    s.textContent = `
      @keyframes _iosFadeIn  { from{opacity:0} to{opacity:1} }
      @keyframes _iosSlideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
      @keyframes _iosSlideDown { from{transform:translateY(0)} to{transform:translateY(100%)} }
      @keyframes _iosBounce  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
      @keyframes _iosPulse   { 0%,100%{opacity:1} 50%{opacity:0.5} }

      #iosInstallOverlay {
        position:fixed; inset:0; z-index:999998;
        background:rgba(0,0,0,0.6);
        backdrop-filter:blur(8px);
        -webkit-backdrop-filter:blur(8px);
        display:flex; align-items:flex-end; justify-content:center;
        animation:_iosFadeIn 0.3s ease;
      }
      #iosInstallPanel {
        width:100%; max-width:500px;
        background:linear-gradient(170deg,#1a3560 0%,#0b1e3d 100%);
        border-radius:26px 26px 0 0;
        padding:20px 20px 48px;
        color:#fff;
        font-family:-apple-system,'Cairo',sans-serif;
        direction:rtl;
        animation:_iosSlideUp 0.4s cubic-bezier(0.25,0.46,0.45,0.94);
        position:relative;
        box-shadow:0 -10px 50px rgba(0,0,0,0.5);
      }
      #iosInstallPanel.closing {
        animation:_iosSlideDown 0.3s ease forwards;
      }
      #iosInstallOverlay.closing {
        animation:_iosFadeIn 0.3s ease reverse forwards;
      }

      /* سهم عائم يشير لشريط Safari السفلي */
      #iosShareArrow {
        position:fixed;
        bottom:90px;
        left:50%;
        transform:translateX(-50%);
        z-index:999999;
        display:flex;
        flex-direction:column;
        align-items:center;
        gap:6px;
        pointer-events:none;
      }
      #iosShareArrow .arrow-label {
        background:rgba(37,99,235,0.95);
        color:#fff;
        font-family:-apple-system,'Cairo',sans-serif;
        font-size:0.82rem;
        font-weight:700;
        padding:6px 14px;
        border-radius:20px;
        white-space:nowrap;
        box-shadow:0 4px 20px rgba(37,99,235,0.5);
        animation:_iosPulse 1.5s ease infinite;
      }
      #iosShareArrow .arrow-icon {
        font-size:2rem;
        animation:_iosBounce 1s ease infinite;
        filter:drop-shadow(0 2px 8px rgba(37,99,235,0.8));
      }

      /* زر عائم دائم (بعد إغلاق البنر) */
      #iosInstallFab {
        position:fixed;
        bottom:80px;
        left:50%;
        transform:translateX(-50%);
        z-index:99997;
        background:linear-gradient(135deg,#2563eb,#1d4ed8);
        color:#fff;
        border:none;
        border-radius:50px;
        padding:12px 22px;
        font-family:-apple-system,'Cairo',sans-serif;
        font-size:0.9rem;
        font-weight:700;
        display:flex;
        align-items:center;
        gap:8px;
        box-shadow:0 6px 24px rgba(37,99,235,0.55);
        cursor:pointer;
        animation:_iosFadeIn 0.4s ease;
        white-space:nowrap;
      }
      #iosInstallFab:active { transform:translateX(-50%) scale(0.96); }
    `;
    document.head.appendChild(s);
  }

  // ===== البنر الرئيسي =====
  function showBanner() {
    if (bannerActive || document.getElementById('iosInstallOverlay')) return;
    bannerActive = true;

    // إخفاء الـ FAB لو كان ظاهراً
    document.getElementById('iosInstallFab')?.remove();

    injectStyle();

    const overlay = document.createElement('div');
    overlay.id = 'iosInstallOverlay';

    overlay.innerHTML = `
      <div id="iosInstallPanel">
        <!-- Handle للسحب -->
        <div style="width:40px;height:4px;background:rgba(255,255,255,0.2);border-radius:4px;margin:0 auto 18px;"></div>

        <!-- رأس البنر -->
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px;">
          <img src="/assets/icon-192.png" style="width:56px;height:56px;border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,0.35);flex-shrink:0;" alt="">
          <div>
            <div style="font-size:1.2rem;font-weight:900;line-height:1.2;margin-bottom:3px;">تثبيت التطبيق</div>
            <div style="font-size:0.8rem;opacity:0.7;">جامعة النصر التقنية  CBS</div>
          </div>
          <button id="iosInstallClose" style="
            margin-right:auto;margin-left:0;
            background:rgba(255,255,255,0.12);border:none;color:#fff;
            width:32px;height:32px;border-radius:50%;font-size:1.1rem;
            cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;
          "></button>
        </div>

        <!-- الخطوات -->
        <div style="background:rgba(255,255,255,0.06);border-radius:18px;overflow:hidden;">
          <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="
              width:38px;height:38px;border-radius:10px;flex-shrink:0;
              background:rgba(255,255,255,0.12);
              display:flex;align-items:center;justify-content:center;
            ">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.5">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            </div>
            <div>
              <div style="font-weight:700;font-size:0.95rem;">اضغط <span style="color:#60a5fa;">مشاركة</span> في الأسفل</div>
              <div style="font-size:0.75rem;opacity:0.6;margin-top:1px;">أيقونة الـ ↑ في شريط Safari</div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="
              width:38px;height:38px;border-radius:10px;flex-shrink:0;
              background:rgba(255,255,255,0.12);
              display:flex;align-items:center;justify-content:center;font-size:1.2rem;
            ">＋</div>
            <div>
              <div style="font-weight:700;font-size:0.95rem;">اختر <span style="color:#34d399;">إضافة إلى الشاشة الرئيسية</span></div>
              <div style="font-size:0.75rem;opacity:0.6;margin-top:1px;">من قائمة المشاركة</div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;">
            <div style="
              width:38px;height:38px;border-radius:10px;flex-shrink:0;
              background:rgba(255,255,255,0.12);
              display:flex;align-items:center;justify-content:center;font-size:1.2rem;
            "></div>
            <div>
              <div style="font-weight:700;font-size:0.95rem;">اضغط <span style="color:#a78bfa;">إضافة</span> ← اكتمل التثبيت</div>
              <div style="font-size:0.75rem;opacity:0.6;margin-top:1px;">التطبيق يفتح بالكامل بدون Safari</div>
            </div>
          </div>
        </div>

        <!-- زر "فاهم، راح أثبّت" -->
        <button id="iosInstallGotIt" style="
          width:100%;margin-top:16px;
          background:linear-gradient(135deg,#2563eb,#7c3aed);
          color:#fff;border:none;border-radius:14px;
          padding:15px;font-size:1rem;font-weight:800;
          font-family:-apple-system,'Cairo',sans-serif;
          cursor:pointer;
          box-shadow:0 4px 20px rgba(124,58,237,0.4);
        ">فهمت، تثبيت الآن</button>

        <button id="iosInstallNever" style="
          width:100%;margin-top:8px;
          background:transparent;color:rgba(255,255,255,0.4);
          border:none;padding:8px;font-size:0.78rem;
          font-family:-apple-system,'Cairo',sans-serif;cursor:pointer;
        ">لا أريد التثبيت</button>
      </div>
    `;

    document.body.appendChild(overlay);

    function closeOverlay(permanent = false) {
      const panel = document.getElementById('iosInstallPanel');
      overlay.classList.add('closing');
      if (panel) panel.classList.add('closing');
      setTimeout(() => {
        overlay.remove();
        bannerActive = false;
        if (!permanent) showFAB();  // يظهر زر عائم صغير بدلاً
      }, 300);
      if (permanent) localStorage.setItem(DISMISS_KEY, '1');
    }

    // السحب لأسفل لإغلاق البنر
    let touchStartY = 0;
    const panel = document.getElementById('iosInstallPanel');
    panel?.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
    panel?.addEventListener('touchmove', e => {
      const dy = e.touches[0].clientY - touchStartY;
      if (dy > 60) closeOverlay(false);
    }, { passive: true });

    overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(false); });
    document.getElementById('iosInstallClose')?.addEventListener('click', () => closeOverlay(false));
    document.getElementById('iosInstallGotIt')?.addEventListener('click', () => {
      closeOverlay(false);
      // إظهار السهم الذي يشير للشريط السفلي
      showArrow();
    });
    document.getElementById('iosInstallNever')?.addEventListener('click', () => closeOverlay(true));
  }

  // ===== سهم يشير لشريط Safari السفلي =====
  function showArrow() {
    document.getElementById('iosShareArrow')?.remove();
    const arw = document.createElement('div');
    arw.id = 'iosShareArrow';
    arw.innerHTML = `
      <div class="arrow-label">↓ اضغط مشاركة هنا</div>
      <div class="arrow-icon"><i class="ri-arrow-down-line"></i></div>
    `;
    document.body.appendChild(arw);
    // يختفي بعد 6 ثوان
    setTimeout(() => arw.remove(), 6000);
  }

  // ===== زر عائم (FAB) صغير دائم =====
  function showFAB() {
    if (document.getElementById('iosInstallFab')) return;
    const fab = document.createElement('button');
    fab.id = 'iosInstallFab';
    fab.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
        <polyline points="16 6 12 2 8 6"/>
        <line x1="12" y1="2" x2="12" y2="15"/>
      </svg>
      ثبّت التطبيق
    `;
    fab.addEventListener('click', () => { fab.remove(); showBanner(); });
    document.body.appendChild(fab);
  }

  // ===== Shake Detection (طريقة بديلة) =====
  let lastShake = 0, lx = null, ly = null, lz = null;
  function onMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a) return;
    const { x=0, y=0, z=0 } = a;
    if (lx === null) { lx=x; ly=y; lz=z; return; }
    const d = Math.abs(x-lx)+Math.abs(y-ly)+Math.abs(z-lz);
    lx=x; ly=y; lz=z;
    if (d > 28 && Date.now()-lastShake > 1500) {
      lastShake = Date.now();
      document.getElementById('iosInstallFab')?.remove();
      showBanner();
    }
  }

  // ===== تشغيل =====
  function start() {
    injectStyle();

    // إحصاء عدد مرات الفتح
    const cnt = parseInt(localStorage.getItem(SHOW_KEY) || '0') + 1;
    localStorage.setItem(SHOW_KEY, cnt);

    // يظهر البنر تلقائياً في أول 3 زيارات
    if (cnt <= 3) {
      setTimeout(showBanner, 2000);
    } else {
      // من المرة الرابعة: فقط زر عائم صغير
      setTimeout(showFAB, 1000);
    }

    // Shake
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      document.addEventListener('click', function reqPerm() {
        DeviceMotionEvent.requestPermission().then(s => {
          if (s === 'granted') window.addEventListener('devicemotion', onMotion, { passive: true });
        }).catch(()=>{});
        document.removeEventListener('click', reqPerm);
      }, { once: true });
    } else {
      window.addEventListener('devicemotion', onMotion, { passive: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();




/* =====================================================
   Premium Mobile UX Enhancements
   ===================================================== */

/* ----- Ripple Touch Effect ----- */
(function initRipple() {
  function createRipple(e, el) {
    const rect = el.getBoundingClientRect();
    const x = ((e.touches?.[0]?.clientX ?? e.clientX) - rect.left) / rect.width * 100;
    const y = ((e.touches?.[0]?.clientY ?? e.clientY) - rect.top) / rect.height * 100;
    el.style.setProperty('--x', x + '%');
    el.style.setProperty('--y', y + '%');
  }

  const SELECTORS = '.dash-card, .notif-card, .bsd-item, .stat-item, .batch-pill-item, .btn-primary, .btn-secondary';

  function attachRipple(el) {
    if (el._rippleAttached) return;
    el._rippleAttached = true;
    el.addEventListener('pointerdown', (e) => createRipple(e, el), { passive: true });
  }

  function startRipple() {
    // Attach on load
    document.querySelectorAll(SELECTORS).forEach(attachRipple);

    // Attach on dynamic content (MutationObserver)
    if (document.body) {
      const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
          m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (node.matches?.(SELECTORS)) attachRipple(node);
            node.querySelectorAll?.(SELECTORS).forEach(attachRipple);
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRipple);
  } else {
    startRipple();
  }
})();

/* ----- Animated Number Counters ----- */
CBS.animateNumber = function(el, target, duration = 800, suffix = '') {
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const startTime = performance.now();
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (target - start) * eased);
    el.textContent = current + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
};

/* ----- Progress Bar Smooth Fill ----- */
CBS.fillProgressBar = function(barEl, pct, delay = 300) {
  if (!barEl) return;
  setTimeout(() => {
    barEl.style.transition = 'width 1s cubic-bezier(0.4, 0, 0.2, 1)';
    barEl.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }, delay);
};

/* ----- Haptic Feedback (Capacitor) ----- */
CBS.haptic = function(type = 'light') {
  try {
    if (window.Capacitor?.Plugins?.Haptics) {
      const { ImpactStyle } = window.Capacitor.Plugins.Haptics;
      const style = type === 'heavy' ? ImpactStyle.Heavy
                  : type === 'medium' ? ImpactStyle.Medium
                  : ImpactStyle.Light;
      window.Capacitor.Plugins.Haptics.impact({ style });
    } else if (navigator.vibrate) {
      navigator.vibrate(type === 'heavy' ? 40 : type === 'medium' ? 25 : 10);
    }
  } catch { /* ignore */ }
};

/* ----- Auto-attach haptic to buttons ----- */
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.btn, .btn-icon, .bnav-item, .dash-card');
  if (btn) CBS.haptic('light');
}, { passive: true });

/* ----- Smooth Page Transition on Nav ----- */
CBS.navigateTo = function(url) {
  if (!url) return;
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.2s ease';
  setTimeout(() => { window.location.href = url; }, 200);
};

/* ----- الملفات وروابط الفيديو تُفتح داخل التطبيق -----
   أي رابط إلى /uploads/ (محاضرة، مرجع، امتحان سابق، واجب، تسليم، إيصال) يمر
   بالعارض الموحّد، وروابط يوتيوب/Drive/المقاطع المباشرة بمشغّل داخلي. كانت كلها
   تفتح المتصفح الخارجي (أو لا تفتح إطلاقاً في التطبيق إن كان الرابط نسبياً).
   استثناء: الروابط ذات download أو data-no-viewer. */
document.addEventListener('click', function (e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.hasAttribute('download') || a.hasAttribute('data-no-viewer')) return;
  let u;
  try { u = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
  if (!/^https?:$/.test(u.protocol)) return;
  const title = (a.dataset.title || '').trim() || undefined;
  const apiOrigin = (() => { try { return API_BASE ? new URL(API_BASE).origin : location.origin; } catch (err) { return location.origin; } })();
  if (u.pathname.startsWith('/uploads/') && (u.origin === location.origin || u.origin === apiOrigin)) {
    e.preventDefault(); e.stopPropagation();
    CBS.openFileViewer(u.href, { title });
    return;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be' || host.endsWith('youtube.com') || host === 'drive.google.com' || /\.(mp4|webm|mov|m4v|mp3|m4a|wav|ogg)$/i.test(u.pathname)) {
    e.preventDefault(); e.stopPropagation();
    CBS.openMediaLink(u.href, title);
  }
}, true);

/* ----- Intercept target="_blank" Links in Native App ----- */
document.addEventListener('click', function(e) {
  if (e.defaultPrevented) return;
  const link = e.target.closest('a[target="_blank"]');
  if (link && typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.())) {
    e.preventDefault();
    window.open(link.href, '_system');
  }
});


/* ----- Intersection Observer for lazy-animate ----- */
(function initLazyAnimate() {
  function start() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.stat-item, .dash-card, .notif-card, .card').forEach(el => {
      io.observe(el);
    });

    // Re-run on DOM changes
    const mo = new MutationObserver(() => {
      document.querySelectorAll('.stat-item:not([data-observed]), .dash-card:not([data-observed])').forEach(el => {
        el.setAttribute('data-observed', '1');
        io.observe(el);
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  // app.js قد يحمَّل في <head> قبل وجود body  الانتظار إلزامي وإلا ظهر toast خطأ لكل زائر
  if (document.readyState === 'loading' || !document.body) {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

/* ----- Toast Enhancement: auto-color icons ----- */
const _origToast = CBS.toast.bind(CBS);
CBS.toast = function(title, body = '', type = 'info', duration = 4000) {
  CBS.haptic?.(type === 'error' ? 'medium' : 'light');
  _origToast(title, body, type, duration);
};

/* ===== 1. Vibrate / Haptic Feedback ===== */
CBS.vibrate = function(ms = 30) {
  if ('vibrate' in navigator && (navigator.userActivation ? navigator.userActivation.hasBeenActive : true)) {
    try { navigator.vibrate(ms); } catch(e) {}
  }
};

/* ===== مولّد رمز QR حقيقي =====
   النسخة السابقة كانت ترسم نمطاً مشتقاً من دالة تجزئة: تبدو كرمز QR لكنها
   لا تحمل أي بيانات ولا تحوي أنماط التوقيت التي يوجبها المعيار، فكان أي
   قارئ يفشل في مسحها. الآن نستخدم مكتبة qrcode-generator (MIT) المضمّنة
   محلياً في /vendor/qrcode.min.js  ترميز حقيقي مع تصحيح أخطاء ودعم UTF-8
   (ضروري للأسماء العربية). */
CBS.renderQRCode = function(canvasOrId, text, options = {}) {
  const canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
  if (!canvas) return false;
  if (typeof qrcode !== 'function') {
    console.warn('renderQRCode: مكتبة qrcode غير محمّلة  أضف <script src="/vendor/qrcode.min.js">');
    return false;
  }

  const ctx = canvas.getContext('2d');
  const size = canvas.width || 120;
  const dark = options.dark || '#0f172a';
  const light = options.light || '#ffffff';

  // typeNumber = 0 يجعل المكتبة تختار أصغر إصدار يتّسع للبيانات تلقائياً.
  // مستوى تصحيح الأخطاء M يوازن بين السعة وقابلية القراءة عند الاتساخ/الانعكاس.
  let qr;
  try {
    qr = qrcode(0, options.errorCorrection || 'M');
    qr.addData(text);
    qr.make();
  } catch (e) {
    // يحدث لو تجاوزت البيانات سعة أكبر إصدار
    console.warn('renderQRCode: تعذر ترميز البيانات ', e.message);
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, size, size);
    return false;
  }

  const count = qr.getModuleCount();
  // نقرّب حجم الوحدة لعدد صحيح حتى تبقى الحواف حادة ولا تتشوّه عند المسح
  const cell = Math.max(1, Math.floor(size / (count + 2))); // +2 لهامش السكون
  const drawn = cell * count;
  const offset = Math.floor((size - drawn) / 2);

  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size, size); // الهامش الأبيض (quiet zone) جزء من المعيار
  ctx.fillStyle = dark;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
      }
    }
  }
  return true;
};

/* ===== 2. Excel / CSV Export Utility ===== */
CBS.exportTableToExcel = function(tableId, filename = 'report.xlsx') {
  this.vibrate(25);
  const table = typeof tableId === 'string' ? document.getElementById(tableId) : tableId;
  if (!table) return this.toast('خطأ', 'الجدول المراد تصديره غير موجود', 'error');

  if (window.XLSX) {
    const wb = XLSX.utils.table_to_book(table, { sheet: "البيانات" });
    const isNative = !!(window.Capacitor?.isNativePlatform?.());
    if (isNative && window.Capacitor?.Plugins?.Filesystem) {
      const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      this.saveFileNative(filename, base64)
        .then(() => this.toast("نجاح", "اختر أين تحفظ الملف", "success"))
        .catch(() => this.toast("خطأ", "فشل تصدير ملف Excel", "error"));
      return;
    }
    XLSX.writeFile(wb, filename);
    this.toast("نجاح", "تم تصدير ملف Excel بنجاح", "success");
  } else {
    // Fallback CSV export with UTF-8 BOM
    let csv = '\uFEFF';
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
      const cols = row.querySelectorAll('th, td');
      const rowData = Array.from(cols).map(c => '"' + (c.innerText || '').replace(/"/g, '""').trim() + '"');
      if (rowData.length > 0) csv += rowData.join(',') + '\r\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename.endsWith('.xlsx') ? filename.replace('.xlsx', '.csv') : filename;
    link.click();
    this.toast("نجاح", "تم تصدير البيانات بنجاح", "success");
  }
};

/* ===== 3. Offline Task Queue & Auto Sync ===== */
CBS._offlineQueue = JSON.parse(localStorage.getItem('cbs_offline_queue') || '[]');

CBS.enqueueOfflineTask = function(actionType, payload) {
  this._offlineQueue.push({ id: Date.now(), type: actionType, payload, timestamp: new Date().toISOString() });
  localStorage.setItem('cbs_offline_queue', JSON.stringify(this._offlineQueue));
  this.toast('تم الحفظ أوفلاين', 'سيتم رفع البيانات تلقائياً عند عودة اتصال الإنترنت', 'info');
};

/* المعال←جات حسب نوع المهمة  أي نوع غير مسجَّل هنا كان يحذف بصمت */
CBS._offlineHandlers = {
  attendance: function(payload) { return CBS.apiPost('/api/attendance', payload); }
};

CBS.flushOfflineQueue = async function() {
  if (this._flushing) return;                     // نمنع تشغيلين متوازيين
  if (!this._offlineQueue || this._offlineQueue.length === 0) return;
  this._flushing = true;

  const queue = [...this._offlineQueue];
  const remaining = [];
  let successCount = 0;

  /* مهم: لا نفرّغ الطابور قبل الإرسال. النسخة السابقة كانت تمسحه أولاً،
     فأي فشل شبكة أو خطأ خادم يعني ضياع سجل الحضور نهائياً بلا إعادة محاولة. */
  for (const task of queue) {
    const handler = this._offlineHandlers[task.type];
    if (!handler) {
      console.warn('نوع مهمة أوفلاين غير معروف:', task.type);
      remaining.push(task);                        // نحتفظ بها بدل حذفها
      continue;
    }
    try {
      const res = await handler(task.payload);
      if (res.ok) {
        successCount++;
      } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        // خطأ في البيانات نفسها: إعادة المحاولة لن تنجح أبداً  نسقطها ونبلّغ
        console.warn('مهمة أوفلاين مرفوضة نهائياً:', task.type, res.status);
      } else {
        remaining.push(task);                      // خطأ خادم/مؤقت → نعيد المحاولة لاحقاً
      }
    } catch (e) {
      remaining.push(task);                        // انقطاع الشبكة → نبقيها
      console.warn('Offline sync item failed:', e.message);
    }
  }

  this._offlineQueue = remaining;
  localStorage.setItem('cbs_offline_queue', JSON.stringify(remaining));
  this._flushing = false;

  if (remaining.length > 0 && successCount === 0) {
    this.toast('تعذرت المزامنة', `${remaining.length} عمليّة ما زالت محفوظة وسترفع لاحقاً`, 'warning');
  }

  if (successCount > 0) {
    this.vibrate([40, 60, 40]);
    this.toast('تمت المزامنة', `تم رفع ${successCount} عمليّة كانت محفوظة أوفلاين بنجاح`, 'success');
    document.dispatchEvent(new CustomEvent('cbs:refresh'));
  }
};

CBS._initOfflineSync = function() {
  window.addEventListener('online', () => this.flushOfflineQueue());
  if (navigator.onLine) setTimeout(() => this.flushOfflineQueue(), 2000);
};

/* ===== 4. Modal Touch Gestures (Swipe down to dismiss) ===== */
/* ===== كشف لوحة المفاتيح =====
   على أندرويد تُقلَّص نافذة العرض عند فتح لوحة المفاتيح، فتنتقل العناصر
   الثابتة (الشريط السفلي، زر كيدي) إلى أعلى الشاشة وتغطي حقل الكتابة.
   نعتمد visualViewport لأنه المصدر الوحيد الدقيق لارتفاع المنطقة المرئية،
   ونُكمله بـfocus كي يعمل على المتصفحات التي لا تدعمه. */
CBS.initKeyboardAwareness = function () {
  if (this._keyboardAwarenessReady) return;
  this._keyboardAwarenessReady = true;

  const body = document.body;
  const setOpen = on => body.classList.toggle('cbs-keyboard-open', !!on);
  const isTextField = el => !!el && (
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|file|reset|image)$/i.test(el.type)) ||
    el.isContentEditable
  );

  const vv = window.visualViewport;
  if (vv) {
    const baseline = vv.height;
    const onResize = () => {
      // فرق يتجاوز 150px يعني لوحة مفاتيح لا مجرد شريط عناوين متحرك
      const shrunk = (Math.max(baseline, window.innerHeight) - vv.height) > 150;
      setOpen(shrunk && isTextField(document.activeElement));
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
  }

  document.addEventListener('focusin', e => { if (isTextField(e.target)) setOpen(true); });
  document.addEventListener('focusout', () => {
    // مهلة قصيرة: الانتقال بين حقلين يُطلق focusout ثم focusin فوراً
    setTimeout(() => { if (!isTextField(document.activeElement)) setOpen(false); }, 120);
  });
};

CBS.initModalGestures = function() {
  document.addEventListener('touchstart', (e) => {
    const modalBox = e.target.closest('.modal-box');
    if (!modalBox) return;
    const isHeader = !!e.target.closest('.modal-header, .swipe-handle, .modal-title');
    const modalBody = modalBox.querySelector('.modal-body');
    if (!isHeader && modalBody) return;

    modalBox._startY = e.touches[0].clientY;
    modalBox._isDragging = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    const modalBox = e.target.closest('.modal-box');
    if (!modalBox || modalBox._startY === undefined) return;
    const deltaY = e.touches[0].clientY - modalBox._startY;
    if (deltaY > 0 && modalBox.scrollTop <= 0) {
      modalBox._isDragging = true;
      modalBox.style.transform = `translateY(${Math.min(deltaY, 150)}px)`;
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    const modalBox = e.target.closest('.modal-box');
    if (!modalBox || modalBox._startY === undefined) return;
    const deltaY = e.changedTouches[0].clientY - modalBox._startY;
    if (modalBox._isDragging && deltaY > 90) {
      const modalOverlay = modalBox.closest('.modal-overlay');
      if (modalOverlay && modalOverlay.id) {
        CBS.closeModal(modalOverlay.id);
      }
    }
    modalBox.style.transform = '';
    delete modalBox._startY;
    delete modalBox._isDragging;
  });
};

/* ===== نظام فحص وتتبع الإصدارات ونافذة التحديث المنبثقة ===== */
CBS.checkAppVersion = async function() {
  try {
    // فحص تحديث التطبيق مخصص فقط لتطبيق الهاتف الأصلي (Capacitor Native APK)
    // متصفحات الويب تعمل دائماً على أحدث كود حي من السيرفر ولا تتطلب تثبيت أو تنزيل APK
    if (!CBS._isCapacitor()) {
      return;
    }

    /* الإصدار الحقيقي للتطبيق المثبّت من النظام (@capacitor/app)؛ الثابتان
       احتياط فقط — كانا متأخرين عن build.gradle فيرى الخادم كل نسخة قديمة */
    let v = CBS.VERSION, code = CBS.BUILD_CODE;
    try {
      const info = await window.Capacitor?.Plugins?.App?.getInfo?.();
      if (info?.version) v = info.version;
      if (Number(info?.build)) code = Number(info.build);
    } catch (e) {}
    const platform = window.Capacitor?.getPlatform ? window.Capacitor.getPlatform() : 'android';

    const res = await fetch(`${API_BASE}/api/app-version/check?v=${encodeURIComponent(v)}&code=${code}&platform=${platform}`);
    if (!res.ok) return;
    const json = await res.json();
    if (!json.success || !json.data) return;

    const { isOutdated, isMandatory } = json.data;
    // إذا كان التطبيق محدثاً بالفعل (أو ليس قديماً)، لا داعي لإظهار أي نافذة
    if (!isOutdated) return;

    // إذا كان التحديث اختيارياً وتم تأجيله في جلسة التصفح الحالية
    const dismissedKey = `cbs_dismissed_update_${json.data.latestVersion}`;
    if (!isMandatory && sessionStorage.getItem(dismissedKey)) {
      return;
    }

    CBS.showUpdateModal(json.data);
  } catch (e) {
    // خطأ صامت في الخلفية لضمان عدم تأثر وظائف النظام
  }
};

CBS.showUpdateModal = function(info = {}) {
  if (document.getElementById('cbsUpdateModalOverlay')) return;

  const isMandatory = !!info.isMandatory;
  const latestVersion = info.latestVersion || '2.3.0';
  const title = info.title || (isMandatory ? 'تحديث إجباري للنظام' : 'تحديث جديد متوفر للتطبيق');
  const message = info.message || 'يتوفر إصدار جديد من تطبيق كلية النصر التقنية يتضمن تحسينات هامة للأداء واستقرار النظام.';
  const notes = Array.isArray(info.releaseNotes) && info.releaseNotes.length ? info.releaseNotes : [
    'تحديثات شاملة لواجهات النظام وهوية كلية النصر التقنية',
    'تحسينات السرعة والاستجابة وتجربة الجوال'
  ];

  const targetUrl = info.directApkUrl || info.downloadUrl || info.playStoreUrl || 'https://elnasrcsit.website/download';

  const overlay = document.createElement('div');
  overlay.id = 'cbsUpdateModalOverlay';
  overlay.className = 'cbs-update-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'cbsUpdateTitle');

  overlay.innerHTML = `
    <div class="cbs-update-card ${isMandatory ? 'mandatory' : ''}">
      <div class="cbs-update-header">
        <div class="cbs-update-icon-glow">
          <i class="${isMandatory ? 'ri-shield-flash-line' : 'ri-rocket-line'}"></i>
        </div>
        <div class="cbs-update-badge">الإصدار الجديد v${CBS.escapeHTML(latestVersion)}</div>
        <h2 id="cbsUpdateTitle" class="cbs-update-title">${CBS.escapeHTML(title)}</h2>
        <p class="cbs-update-msg">${CBS.escapeHTML(message)}</p>
      </div>

      <div class="cbs-update-body">
        <div class="cbs-update-notes-title"><i class="ri-sparkling-line"></i> ما الجديد في هذا الإصدار:</div>
        <ul class="cbs-update-notes-list">
          ${notes.map(n => `<li><i class="ri-checkbox-circle-fill"></i> <span>${CBS.escapeHTML(n)}</span></li>`).join('')}
        </ul>
      </div>

      <div class="cbs-update-footer">
        <a href="${CBS.escapeHTML(targetUrl)}" class="cbs-update-btn-primary" target="_blank" rel="noopener noreferrer">
          <i class="ri-download-cloud-2-line"></i>
          <span>تحديث التطبيق الآن</span>
        </a>
        ${!isMandatory ? `
          <button type="button" class="cbs-update-btn-secondary" id="cbsDismissUpdateBtn">
            <span>التحديث لاحقاً</span>
          </button>
        ` : `
          <div class="cbs-update-mandatory-hint">
            <i class="ri-error-warning-line"></i> يتطلب الاستمرار في استخدام التطبيق التحديث إلى هذا الإصدار
          </div>
        `}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  if (!isMandatory) {
    const dismissBtn = document.getElementById('cbsDismissUpdateBtn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        sessionStorage.setItem(`cbs_dismissed_update_${latestVersion}`, '1');
        overlay.remove();
        document.body.classList.remove('modal-open');
      });
    }
  } else {
    // في التحديث الإجباري: منع إغلاق النافذة بزر الهروب
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('cbsUpdateModalOverlay')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }
};

// Initialize Gestures & Offline Sync on DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    CBS._initOfflineSync();
    CBS.initModalGestures();
  });
} else {
  CBS._initOfflineSync();
  CBS.initModalGestures();
}

/* ===== Service Worker Registration =====
   التسجيل يتم في CBS._registerSW() المستدعاة أعلاه — وهي النسخة التي تعرض
   شريط "حدّث الآن" وترسل SKIP_WAITING ثم تعيد التحميل عند controllerchange.
   كان هنا تسجيل ثانٍ مكرر يكتفي برسالة "أغلق وأعد فتح التطبيق" دون
   إرسال SKIP_WAITING، فيبقى الـ SW الجديد في حالة waiting والمستخدم عالقاً
   على النسخة القديمة إلى الأبد. حُذف. */

/* ===== مؤشر الاتصال بالإنترنت (Online / Offline) =====
   يظهر للمستخدم شريط تنبيه عند انقطاع الشبكة ويخفيه عند عودتها */
(function initConnectionIndicator() {
  function showOfflineBanner() {
    if (navigator.onLine || document.getElementById('cbs-offline-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'cbs-offline-banner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
      'background:#ef4444', 'color:#fff', 'text-align:center',
      'padding:8px 16px', 'font-size:0.85rem', 'font-weight:700',
      'direction:rtl', 'display:flex', 'align-items:center',
      'justify-content:center', 'gap:8px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)'
    ].join(';');
    banner.innerHTML = '<i class="ri-wifi-off-line"></i> أنت غير متصل بالإنترنت  يمكنك تصفح الصفحات المحفوظة';
    document.body.prepend(banner);
  }

  function hideOfflineBanner() {
    const banner = document.getElementById('cbs-offline-banner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s ease';
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 400);
      CBS.toast('عاد الاتصال بالإنترنت', '', 'success', 3000);
    }
  }

  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online',  hideOfflineBanner);

  // التحقق عند التحميل
  if (!navigator.onLine) {
    document.addEventListener('DOMContentLoaded', () => {
      CBS.initModalClose();
      showOfflineBanner();
    });
  } else {
    CBS.initModalClose();
    showOfflineBanner();
  }
})();
