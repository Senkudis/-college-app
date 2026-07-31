/* =====================================================
   كلية تقنية المعلومات - الجافاسكربت المشترك
   ===================================================== */

// ===== API Base URL =====
// في تطبيق الهاتف الحقيقي (Capacitor Native) نتصل بالخادم المستضاف مباشرةً
// في المتصفح العادي (سواء localhost أو elnasrcsit.website) نستخدم روابط نسبية
const _IS_CAPACITOR_NATIVE = !!(window.Capacitor?.isNativePlatform?.());
const API_BASE = _IS_CAPACITOR_NATIVE ? 'https://elnasrcsit.website' : '';

const CBS = {

  VERSION: '1.4.0',
  ASSET_VERSION: '2026073127',

  /* ===== Auth ===== */
  getToken() { return localStorage.getItem('token'); },
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
    // 'admin' كان ناقصاً هنا فكانت الدالة تعيد null للمسؤول، فتفشل كل الفروع المبنية عليها
    return ['admin', 'dean', 'doctor', 'leader', 'student'].find(role => roles.includes(role)) || null;
  },
  isAdminLevel(user = this.getUser()) {
    const roles = user?.roles || [];
    return roles.includes('admin') || roles.includes('dean');
  },
  /* كانت quizzes.html و subject.html تستدعيان CBS.hasRole وهي غير معرَّفة،
     فيرمى TypeError داخل دالة الرسم وتبقى الصفحة فارغة تماماً للكادر. */
  hasRole(role, user = this.getUser()) {
    const roles = user?.roles || [];
    if (Array.isArray(role)) return role.some(r => roles.includes(r));
    return roles.includes(role);
  },
  playNotificationSound(isEmergency = false) {
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
      '/login.html', 
      '/forgot-password.html',
      '/force-change-password.html',
      '/reset-code.html',
      '/new-password.html',
      '/404.html'
    ];
    const onSkipPage = skipBatchPages.some(p => window.location.pathname === p);

    // إعادة توجيه غير الطلاب وغير الليدر لاختيار الدفعة إذا لم تحدَّد في الـ URL أو التخزين
    // الليدر مثل الطالب  لديه دفعة واحدة ثابتة لا يحتاج لاختيارها
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
    // إذا لا يوجد توكن أصلاً  مستخدم غير مسجّل
    if (!this.getToken()) return false;

    try {
      const res = await fetch(API_BASE + '/api/verify-token', {
        headers: { Authorization: 'Bearer ' + this.getToken() }
      });
      // 401 أو 403 = توكن منتهي أو مرفوض من السيرفر → خروج
      if (res.status === 401 || res.status === 403) {
        this.logout(false);
        return false;
      }
      // أي حالة أخرى (200 ✓، 500، timeout...) = نبقي المستخدم داخل التطبيق
      return res.ok;
    } catch {
      // فشل الشبكة (لا إنترنت) → نبقي الجلسة ولا نخرج المستخدم
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
          // نستخدم CBS لا this: لو استدعيت logout كمرجع مفصول (callback)
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
     WebView أندرويد لا يدعم تنزيل blob  داخل التطبيق نكتب الملف عبر Filesystem
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
     داخل WebView أندرويد (لا يملك منزّلاً للـ blob)، فيبدو للمستخدم أن ملفات
     الباوربوينت "لا تفتح". هنا نكتب الملف فعلياً ثم نفتح نافذة "فتح بواسطة/مشاركة"
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
     المحتوى يرسم دائماً في "مسرح" ثابت العرض (عرض A4) خارج الشاشة، لأن الالتقاط
     من الصفحة الحية على الهاتف كان ينتج PDF بعرض الجوال (عمود ضيق مقصوص)
     وبألوان الوضع الليلي (خلفية سوداء). */

  PDF_STAGE_WIDTH: 794,     // A4 بعرض 96dpi
  _PDF_MAX_CANVAS_PX: 12e6, // كانفاس الهاتف محدود؛ تجاوزه ينتج صفحة فارغة

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
    // ملاحظة مهمة: لا نزيح الحاوية بعيداً (مثل right:-20000px) لأن html2canvas
    // يحسب حينها لوحة رسم بعرض عشرات الآلاف من البكسلات فيتجمّد التصدير.
    // نضعها في أعلى الصفحة خلف كل شيء (z-index سالب) كما في النمط المجرَّب.
    stage.setAttribute('dir', 'rtl');
    stage.style.cssText = [
      'position:fixed', 'top:0', 'left:0', `width:${width}px`,
      // بدون border-box يصبح العرض الفعلي width+48 (الحشو) فيقصّ الملف من الجانب
      'box-sizing:border-box',
      'background:#ffffff', 'color:#0f1928', 'direction:rtl',
      // خطوط النظام فقط: خطوط @font-face لا تحمَّل داخل صورة SVG المعزولة
      'font-family:Tahoma,Arial,"Segoe UI",sans-serif',
      'padding:24px', 'z-index:-99999', 'pointer-events:none'
    ].join(';');
    return stage;
  },

  /* ===== تحويل المحتوى إلى صورة =====
     html2canvas يرسم النص بنفسه، وهو يفسد العربية: يفقد المسافات بين الكلمات
     ("أحمدعبدالله")، ويعكس ترتيب عناصر RTL، ويقصّ المحتوى جانبياً.
     البديل: نغلّف المحتوى في <foreignObject> داخل SVG ونترك المتصفح يرسمه 
     فيخرج التشكيل والاتجاه والمسافات صحيحة تماماً. */
  /* محتوى الـ SVG معزول عن أوراق أنماط الصفحة، فأي تنسيق معتمد على الأصناف
     (.kpi-card وغيرها في صفحة التقارير) يضيع تماماً. لذلك نثبّت الأنماط
     المحسوبة داخل كل عنصر قبل التسلسل. الأنماط المضمّنة أصلاً تبقى الأقوى. */
  _PDF_INLINE_PROPS: [
    'display','position','box-sizing','width','height','min-height','max-width',
    'margin','padding',
    // getComputedStyle لا يرجع قيمة للاختصار 'border'، فنطلب الخصائص المفصّلة
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
      // نلحق الأنماط الأصلية بعدها لتفوز عند التعارض
      node.setAttribute('style', css + (node.getAttribute('style') || ''));
    });
  },

  /* صورة SVG معزولة أمنياً: لا تحمَّل منها أي موارد خارجية، فالصور المشار
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
        } catch (e) { img.remove(); } // مصدر ملوّث  حذفها أفضل من مربع فارغ
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
    // XMLSerializer ينتج XHTML صالحاً (يغلق <br/> و <img/>)  بدونه يفشل تحميل الـ SVG
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

    /* بعض إصدارات WebView تلوّث الكانفاس عند رسم SVG يحوي foreignObject،
       فيفشل استخراج الصورة لاحقاً داخل html2pdf  خارج نطاق التقاطنا للأخطاء
       فينهار التصدير كله. نتحقق هنا ليعمل التراجع إلى html2canvas بدل الانهيار. */
    canvas.toDataURL('image/png');
    return canvas;
  },

  /**
   * يصدّر محتوى إلى PDF.
   * @param {HTMLElement|string} source عنصر (يستنسخ) أو نص HTML جاهز للطباعة.
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
      // cloneNode لا ينسخ محتوى الـ canvas  بدون هذا تخرج الرسوم البيانية بيضاء
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
        } catch (e) { /* canvas ملوّث بمصدر خارجي  نتركه كما هو */ }
      });
      stage.appendChild(clone);
    } else {
      throw new Error('exportPdf: مصدر غير صالح');
    }
    document.body.appendChild(stage);

    try {
      // نمهل المتصفح لحظة لحساب التخطيط قبل قياس الارتفاع.
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
        // تحذير: وضع 'legacy' يدخل هذه النسخة من html2pdf في حلقة لا نهائية
        // تجمّد الواجهة تماماً  لا تضفه.
        pagebreak: { mode: ['css'] }
      };

      /* نرسم المحتوى بأنفسنا عبر SVG (يحفظ العربية) ثم نسلّم الصورة الجاهزة
         لـ html2pdf ليتكفّل بتقسيم الصفحات فقط. عند فشل الرسم  كأن يكون
         WebView قديماً لا يدعم foreignObject  نعود لمسار html2canvas. */
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
     التطبيق الأصلي: Capacitor Filesystem (يقرأ أوفلاين حتى للملفات عابرة الأصل).
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
    // إذا كان الامتداد .pdf نضمن تسميته صراحةً لئلا يعامله الأندرويد كـ .bin
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

  // حفظ ملف للتصفح لاحقاً  يجب أن يكون متصلاً الآن (ينزّل الملف)
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

  // يعيد ArrayBuffer من التخزين المحلي، أو null لو غير محفوظ
  async offlineGet(url) {
    const Filesystem = window.Capacitor?.Plugins?.Filesystem;
    try {
      if (this._isCapacitor() && Filesystem) {
        // نحاول أولاً بالامتداد .pdf (للملفات التي حفظت بعد الإصلاح)
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
      return null; // غير موجود  سيحمّل من الشبكة
    }
  },

  // قائمة المسارات المحفوظة (للمؤشّر "متاح بدون نت")
  offlineList() {
    return Object.keys(this._offlineIndex());
  },

  /* ===== Dark Mode (Smart  يكتشف إعدادات النظام تلقائياً) ===== */
  initDarkMode() {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) {
      // المستخدم اختار يدوياً من قبل  احترم اختياره
      if (saved === 'true') {
        document.body.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    } else {
      // أول زيارة  اقرأ إعدادات النظام (هاتف / كمبيوتر)
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

  /* مع "العرض حتى حافة الشاشة" ترسم أيقونات شريط الحالة فوق ترويسة التطبيق
     مباشرةً، فيجب أن يتبع لونها سمة التطبيق وإلا صارت بيضاء على ترويسة بيضاء
     (غير مرئية تماماً في الوضع الفاتح).
     نستخدم إضافة SystemBars الأصلية (مضمّنة في المشروع، بلا تبعيات)، ونقبل
     إضافة @capacitor/status-bar إن وجدت مستقبلاً. */
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
     فيعامَل رد الخطأ ({success:false, message}) معاملة البيانات الصحيحة:
     إما تظهر "لا توجد بيانات" بدل سبب المشكلة، أو ينهار الكود عند .map()
     لأن كائن الخطأ صار هو "القائمة" في أنماط مثل (data.subjects || data).
     تستخدم داخل try/catch حتى تلتقط رسالة الخادم الحقيقية. */
  async readJson(res, fallbackMessage = 'تعذر تنفيذ الطلب') {
    let data = null;
    try { data = await res.json(); } catch (e) { /* رد غير JSON أو جسم فارغ */ }
    if (!res.ok) {
      const err = new Error(data?.message || `${fallbackMessage} (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    /* لا نعيد null أبداً عند النجاح: المستدعون يقرأون data.success مباشرةً،
       فكان رد ناجح بجسم فارغ أو غير JSON ينتج
       "Cannot read properties of null (reading 'success')" بدل رسالة مفهومة. */
    return data ?? {};
  },

  /* اختصار برسالة واحدة: CBS.showToast('تم الحفظ', 'success').
     كان مستخدَماً في عدة صفحات دون أن يكون معرّفاً، فيتوقف تنفيذ الدالة المستدعية بخطأ. */
  showToast(message, type = 'info', duration = 5000) {
    const alias = { danger: 'error', fail: 'error', ok: 'success' };
    return this.toast(message, '', alias[type] || type, duration);
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
  openModal(id)  {
    const el = document.getElementById(id);
    if (el) el.classList.add('show');
  },
  formatTime(d) {
    if (!d) return '';
    try {
      return new Date(d).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  },
  closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  },
  initModalClose() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('show');
      });
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal-overlay').classList.remove('show');
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
      if (res.status === 403) {
        const onSelector = window.location.pathname === '/batch-selector.html';
        const user = CBS.getUser();
        const isLeader  = user.roles?.includes('leader');
        const isStudent = user.roles?.includes('student');
        if (!onSelector && !isLeader && !isStudent && !CBS.getBatchId()) {
          CBS.toast('يرجى تحديد الدفعة أولاً للوصول إلى البيانات', '', 'error');
          setTimeout(() => { location.replace('/batch-selector.html'); }, 2000);
        } else if (!onSelector) {
          CBS.toast('غير مصرح لك بالوصول لهذا المحتوى أو إجراء هذه العملية في الدفعة الحالية', '', 'error');
        }
      }
      return res;
    }

    return { ok: false, status: 0, json: async () => ({}) };
  },

  async apiPost(url, body, method = 'POST', _retry = true) {
    let res;
    try {
      res = await CBS._fetchWithTimeout(API_BASE + url, {
        method,
        headers: CBS._getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
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
     نظام الإشعارات المحسّن  يدعم الإشعارات الحقيقية على الهاتف
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

  // طلب صلاحية الإشعارات (يستدعى عند أول تشغيل)
  async requestNotifPermission() {
    const plugin = this._getLocalNotif();
    if (!plugin) return; // متصفح عادي  لا حاجة
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
          channelId:     isEmergency ? 'emergency' : 'general',
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

      // Badge أيقونة التطبيق (Capacitor Badge plugin  اختياري)
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
      const list = await res.json();
      if (!Array.isArray(list) || !list.length) return;

      const shownIds = JSON.parse(localStorage.getItem('shownNotifIds') || '[]');
      let notifCounter = parseInt(localStorage.getItem('notifIdCounter') || '1000');

      for (const n of list) {
        if (shownIds.includes(n._id)) continue;

        // لا نظهر إشعار للشخص الذي أنشأ الإشعار (المرسل لا يستقبل إشعاره بنفسه)
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

        // ② Toast في التطبيق (دائماً  حتى لو على الهاتف)
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
    // على الموبايل polling أسرع (15 ثانية)  على الويب 30 ثانية
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
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) +
           '  ' +
           d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  },

  // ملاحظة: showLoading معرّفة أسفل الملف (نسخة الهيكل العظمي/skeleton)  كان هناك
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
    // يظهر فقط للعميد والدكاترة  الليدر والطالب دفعتهم ثابتة
    const canSwitch = user && user.roles &&
      (user.roles.includes('dean') || user.roles.includes('doctor'));
    if (!canSwitch) return;

    // لا يظهر في صفحات الإعداد
    const skip = ['/login.html', '/forgot-password.html', '/batch-selector.html',
                  '/force-change-password.html', '/reset-code.html', '/new-password.html'];
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
            <span class="inline-batch-name" id="bsdName">${currentBatch ? currentBatch.name : 'لم يتم تحديد دفعة'}</span>
          </div>
        </div>
        <div class="inline-batch-action">
          <span>تبديل</span>
          <i class="ri-arrow-down-s-line" id="bsdChevron"></i>
        </div>`;

      wrap.appendChild(btn);
      const banner = document.querySelector('.welcome-banner') || pageContent.firstChild;
      pageContent.insertBefore(wrap, banner);

      // ===== الـ Dropdown  يلحق بـ body مباشرةً لتجنب stacking context =====
      const dropdown = document.createElement('div');
      dropdown.className = 'batch-switcher-dropdown';
      dropdown.id = 'bsdDropdown';
      dropdown.style.position = 'fixed'; // fixed بدل absolute  مستقل عن الهيدر
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
            <div class="bsd-item-name">${b.name}</div>
            <div class="bsd-item-meta">${b.code || ''}</div>
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

    // إذا كان عميداً أو مسؤولاً ولم يكن داخل سياق دفعة، عد به للوحة الإدارة العامة
    if (this.isAdminLevel(user) && !batchId) {
      window.location.href = '/admin_dashboard.html';
      return;
    }

    // لغير العميد أو للعميد داخل دفعة، اذهب للوحة الدفعة (dashboard)
    window.location.href = '/dashboard.html' + (batchId ? '?batch=' + batchId : '');
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
    // Add search button to header
    const header = document.querySelector('.main-header');
    if (header && !header.querySelector('.search-open-btn')) {
      const btn = document.createElement('button');
      btn.className = 'search-open-btn';
      btn.title = 'بحث';
      btn.innerHTML = '<i class="ri-search-line"></i>';
      btn.onclick = () => CBS.openSearch();
      header.appendChild(btn);
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
          // العناوين تأتي من محتوى أنشأه مستخدمون  يجب تعقيمها قبل الحقن (XSS)
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

    let items = [];
    if (primaryRole === 'student') {
      items = [
        { href: `/dashboard.html${bp}`,              icon: 'ri-home-5-line',         label: 'الرئيسية' },
        { href: `/subjects.html${bp}`,               icon: 'ri-book-2-line',         label: 'المواد' },
        { href: `/calendar.html${bp}`,               icon: 'ri-calendar-todo-line',  label: 'التقويم' },
        { href: `/financials.html${bp}`,             icon: 'ri-money-dollar-circle-line', label: 'الرسوم' },
        { href: `/notifications.html${bp}`,          icon: 'ri-notification-3-line', label: 'التنبيهات', badge: true },
        { href: `/profile.html${bp}`,                icon: 'ri-user-3-line',         label: 'حسابي' },
      ];
    } else if (primaryRole === 'leader') {
      items = [
        { href: `/dashboard.html${bp}`,              icon: 'ri-home-5-line',         label: 'الرئيسية' },
        { href: `/manage-lectures.html${bp}`,        icon: 'ri-video-line',          label: 'المحاضرات' },
        { href: `/quizzes.html${bp}`,                icon: 'ri-question-answer-line', label: 'الاختبارات' },
        { href: `/manage-attendance.html${bp}`,      icon: 'ri-calendar-check-line', label: 'الحضور' },
        { href: `/profile.html${bp}`,                icon: 'ri-user-3-line',         label: 'حسابي' },
      ];
    } else if (primaryRole === 'doctor') {
      items = [
        { href: `/dashboard.html${bp}`,              icon: 'ri-home-5-line',        label: 'الرئيسية' },
        { href: `/manage-lectures.html${bp}`,        icon: 'ri-video-line',         label: 'المحاضرات' },
        { href: `/manage-notifications.html${bp}`,   icon: 'ri-megaphone-line',     label: 'الإشعارات' },
        { href: `/profile.html${bp}`,                icon: 'ri-user-3-line',        label: 'حسابي' },
      ];
    } else if (primaryRole === 'dean' || primaryRole === 'admin') {
      items = [
        { href: `/admin_dashboard.html`,             icon: 'ri-home-5-line',        label: 'الرئيسية' },
        { href: `/manage-users.html${bp}`,           icon: 'ri-group-line',         label: 'المستخدمون' },
        { href: `/financials.html${bp}`,             icon: 'ri-money-dollar-circle-line', label: 'الرسوم' },
        { href: `/manage-batches.html`,              icon: 'ri-layout-grid-line',   label: 'الدفعات' },
        { href: `/manage-notifications.html${bp}`,   icon: 'ri-megaphone-line',     label: 'الإشعارات' },
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
    // مع "العرض حتى حافة الشاشة" في أندرويد 15 يجب إضافة ارتفاع شريط الإيماءات،
    // وإلا اختفى آخر سطر من المحتوى خلف الشريط السفلي.
    document.body.style.paddingBottom = 'calc(70px + env(safe-area-inset-bottom, 0px))';
    this._syncBnavBadge();
    this.renderGlobalKedyAI();
  },

  formatAiResponse(text) {
    if (!text) return '';
    let str = String(text).trim().replace(/[\uFFFD\uFFFE\uFFFF]/g, '');
    // Clear raw bot markers
    str = str.replace(/^\*\*\s*\(?Kedy\)?\s*\*\*/gi, '');
    str = str.replace(/^Kedy:\s*/gi, '');

    // Detect Fenced Code Blocks ```lang ... ```
    str = str.replace(/```([a-z0-9_+-]*)\n([\s\S]*?)```/gi, (match, lang, code) => {
      const codeId = 'code_' + Math.random().toString(36).substring(2, 8);
      return `<div style="background:#0f172a;color:#f8fafc;border-radius:12px;padding:12px;margin:10px 0;font-family:monospace;direction:ltr;text-align:left;position:relative;overflow-x:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid #334155;padding-bottom:4px;">
          <span style="font-size:0.75rem;color:#94a3b8;font-weight:700;">${lang || 'code'}</span>
          <button onclick="CBS._copyCodeText('${codeId}')" style="background:#334155;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:0.72rem;cursor:pointer;"><i class="ri-file-copy-line"></i> نسخ الكود</button>
        </div>
        <pre id="${codeId}" style="margin:0;font-size:0.83rem;line-height:1.5;">${this.escapeHTML(code.trim())}</pre>
      </div>`;
    });

    // Math Equation Conversions
    str = str.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '<span class="ai-math-frac" style="font-weight:700;color:#4f46e5;"><span class="num">$1</span>&frasl;<span class="den">$2</span></span>');
    str = str.replace(/\\sqrt\{([^}]+)\}/g, '√($1)');
    str = str.replace(/\\int/g, '∫').replace(/\\sum/g, '∑').replace(/\\lim/g, 'lim');
    // كان ^n يُستبدل بحرف «ف» العربي — تشويه واضح لأي أُسّ رمزي مثل x^n
    str = str.replace(/\^2/g, '²').replace(/\^3/g, '³').replace(/\^n\b/g, 'ⁿ');
    str = str.replace(/\\rightarrow/g, '→').replace(/\\leftarrow/g, '').replace(/\\infty/g, '∞');

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
    if (isAssignmentPage) {
      document.getElementById('globalKedyFab')?.remove();
      document.getElementById('globalKedyModal')?.remove();
      return;
    }

    if (document.getElementById('globalKedyFab')) return;

    // Inject styles
    if (!document.getElementById('kedyGlobalStyle')) {
      const st = document.createElement('style');
      st.id = 'kedyGlobalStyle';
      st.textContent = `
        .kedy-global-fab {
          position: fixed; bottom: 85px; left: 20px; z-index: 8000;
          background: linear-gradient(135deg, #4f46e5, #7c3aed);
          color: #fff; border: none; border-radius: 30px;
          padding: 11px 18px; font-weight: 800; font-size: 0.88rem;
          cursor: pointer; display: flex; align-items: center; gap: 8px;
          box-shadow: 0 8px 24px rgba(79,70,229,0.4);
          transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          font-family: 'Cairo', system-ui, sans-serif; animation: kedyGlow 3s infinite;
        }
        @keyframes kedyGlow {
          0%, 100% { box-shadow: 0 8px 24px rgba(79,70,229,0.4); }
          50% { box-shadow: 0 12px 32px rgba(124,58,237,0.7); }
        }
        .kedy-global-fab:hover { transform: translateY(-4px) scale(1.04); }
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
        .kedy-chat-container {
          flex: 1; min-height: 0;
          overflow-y: auto; overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          padding: 16px;
          display: flex; flex-direction: column; gap: 12px;
          background: var(--bg-main, #f8fafc);
        }
        .kedy-chat-container::-webkit-scrollbar { width: 6px; }
        .kedy-chat-container::-webkit-scrollbar-thumb {
          background: var(--border, #cbd5e1); border-radius: 3px;
        }
        .kedy-chat-container::-webkit-scrollbar-track { background: transparent; }

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
          .page-content { padding-bottom: 110px !important; }
          .kedy-global-fab { bottom: calc(78px + env(safe-area-inset-bottom, 0px)); left: 14px; padding: 9px 14px; font-size: 0.8rem; z-index: 9990; }
          #globalKedyModal { padding: 0; align-items: flex-end; }
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
          .kedy-chat-container { padding: 12px; gap: 10px; }
          .kedy-input-bar { padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 8px)); }
          .kedy-msg-user, .kedy-msg-bot { max-width: 92%; font-size: 0.85rem; }
        }
      `;
      document.head.appendChild(st);
    }

    // FAB Button
    const fab = document.createElement('button');
    fab.id = 'globalKedyFab';
    fab.className = 'kedy-global-fab';
    fab.innerHTML = '<i class="ri-sparkles-fill" style="color:#fbbf24;font-size:1.1rem;"></i> اسأل كيدي AI';
    fab.onclick = () => CBS.openKedyAIModal();
    document.body.appendChild(fab);

    // Modal Overlay
    const modal = document.createElement('div');
    modal.id = 'globalKedyModal';
    modal.innerHTML = `
      <div class="kedy-modal-box">
        <div class="kedy-modal-header">
          <div class="kedy-modal-title"><i class="ri-sparkles-fill" style="color:#fbbf24;"></i> كيدي AI 2.0 <small style="opacity:0.75;font-weight:400;font-size:0.78rem;">(المساعد الأكاديمي الذكي)</small></div>
          <button class="kedy-modal-close" onclick="CBS.closeKedyAIModal()"><i class="ri-close-line"></i></button>
        </div>
        <div class="kedy-modal-tabs">
          <button class="kedy-tab-btn active" id="gkTabChat" onclick="CBS._switchKedyTab('chat')"><i class="ri-chat-smile-2-line"></i> المحادثة</button>
          <button class="kedy-tab-btn" id="gkTabNotes" onclick="CBS._switchKedyTab('notes')"><i class="ri-bookmark-3-line"></i> ملاحظاتي </button>
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
    modal.addEventListener('click', e => { if (e.target === modal) CBS.closeKedyAIModal(); });
    document.body.appendChild(modal);
  },

  openKedyAIModal() {
    const modal = document.getElementById('globalKedyModal');
    if (!modal) { this.renderGlobalKedyAI(); }
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
    botMsg.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite;display:inline-block"></i> جاري التفكير...';
    container.appendChild(botMsg);
    container.scrollTop = container.scrollHeight;

    try {
      const subjectTitle = document.getElementById('subjectTitle')?.textContent || document.title || '';
      const lectureTitle = document.getElementById('pdfModalTitle')?.textContent || '';
      const res = await this.apiPost('/api/ai/ask', {
        prompt: msg,
        subjectTitle,
        lectureTitle,
        history: this._kedyHistory.slice()   // يُرسل قبل إضافة الرسالة الحالية
      });
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
            `<button onclick="CBS._kedyQuickPrompt('ابحث لي عن جزئية في مادة ${this.escapeHTML(data.interactive.subjectName)}')" style="padding:8px 12px;background:var(--bg-card);color:#4f46e5;border:1.5px solid #4f46e5;border-radius:12px;font-size:0.8rem;font-weight:700;cursor:pointer;text-align:right;"> البحث عن جزئية/موضوع معين</button>` +
            (data.interactive.lectures.length ? `<strong style="font-size:0.78rem;margin-top:6px;color:var(--text-muted);">أو اختر محاضرة معينة:</strong>` +
            data.interactive.lectures.map(l =>
              `<button onclick="CBS._kedySelectLecture('${l._id}', '${this.escapeHTML(l.title)}', '${this.escapeHTML(data.interactive.subjectName)}')" style="padding:6px 10px;background:var(--bg-main);color:var(--text-main);border:1px solid var(--border);border-radius:8px;font-size:0.78rem;cursor:pointer;text-align:right;"><i class="ri-file-text-line"></i> ${this.escapeHTML(l.title)}</button>`
            ).join('') : '') + `</div>`;
        }

        botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml + 
          `<br><button onclick="CBS._saveGlobalNote('${this.escapeHTML(msg)}', '${this.escapeHTML(data.answer)}')" style="margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.75rem;font-weight:700;"><i class="ri-bookmark-3-line"></i> حفظ في ملاحظاتي </button>`;
      } else {
        botMsg.innerHTML = '<span style="color:var(--danger)">' + (data.message || 'حدث خطأ في الإجابة') + '</span>';
      }
    } catch {
      botMsg.innerHTML = '<span style="color:var(--danger)">تعذّر الاتصال بالخادم الذكي</span>';
    }
    sendBtn.disabled = false;
    container.scrollTop = container.scrollHeight;
  },

  _kedySelectSubject(subjectId, subjectName) {
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
    botMsg.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite;display:inline-block"></i> جاري جلب المحاضرات...';
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
            `<button onclick="CBS._kedyQuickPrompt('ابحث لي عن جزئية في مادة ${this.escapeHTML(subjectName)}')" style="padding:8px 12px;background:var(--bg-card);color:#4f46e5;border:1.5px solid #4f46e5;border-radius:12px;font-size:0.8rem;font-weight:700;cursor:pointer;text-align:right;"> البحث عن جزئية/موضوع معين</button>` +
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
    botMsg.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite;display:inline-block"></i> جاري قراءة المحاضرة...';
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
          `<br><button onclick="CBS._saveGlobalNote('${this.escapeHTML(lectureTitle)}', '${this.escapeHTML(data.answer)}')" style="margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.75rem;font-weight:700;"><i class="ri-bookmark-3-line"></i> حفظ في ملاحظاتي</button>`;
      } else {
        botMsg.innerHTML = '<span style="color:var(--danger)">' + (data.message || 'حدث خطأ') + '</span>';
      }
    } catch {
      botMsg.innerHTML = '<span style="color:var(--danger)">تعذّر الاتصال بالخادم الذكي</span>';
    }
    container.scrollTop = container.scrollHeight;
  },

  _saveGlobalNote(title, content) {
    try {
      const notes = JSON.parse(localStorage.getItem('cbs_saved_notes') || '[]');
      notes.unshift({
        id: 'note_' + Date.now(),
        subject: 'المساعد الذكي (كيدي)',
        title: title || 'ملاحظة كيدي',
        content: content,
        date: new Date().toLocaleDateString('ar-SD', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      });
      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));
      this.toast('تم الحفظ في ملاحظاتك بنجاح ', '', 'success');
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
    // على الهاتف يوجد عنصر "حسابي" في الشريط السفلي  لا داعي لزر ثان في الترويسة
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
     الموحّد وشريط التنقل السفلي فوقه  فيظهر زران بنفس الوظيفة جنباً إلى جنب. */
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
     ومرة في ترويسة الصفحة (.page-header). نبقي البانر ونحذف العنوان المكرر
     مع الحفاظ على أزرار الإجراءات الموجودة في الترويسة. */
  _dedupePageHeadings() {
    const banner = document.querySelector('.welcome-banner');
    const header = document.querySelector('.page-header');
    if (!banner || !header) return;
    const titleBlock = header.querySelector('.page-header-left');
    if (!titleBlock) return;

    // بعض العناوين الفرعية عدّادات تحدَّث بالـ id (مثل "جاري التحميل...").
    // ننقل الـ id إلى نص البانر أولاً، وإن تعذّر نبقي الترويسة كما هي
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

  /* ===== Splash Screen ===== */
  showSplash() {
    if (document.getElementById('app-splash')) return;
    const splash = document.createElement('div');
    splash.id = 'app-splash';
    splash.innerHTML = `
      <img src="/assets/logo.png" class="splash-logo" alt="Logo" onerror="this.style.display='none'">
      <div class="uib-loader"><div class="half"></div><div class="half"></div></div>
      <div class="splash-title">كلية تقنية المعلومات<br><small style="font-weight:400;font-size:0.75em;opacity:0.7">جامعة النصر التقنية</small></div>
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
    this._injectMobileCSS();
    this.initPullToRefresh();
    this.initBackgroundSync();

    /* شريط الحالة على أندرويد 15 (SDK 35+):
       - setBackgroundColor يعتمد على Window.setStatusBarColor المتوقّفة نهائياً
         وأصبح بلا أثر، والنظام يفرض "العرض حتى حافة الشاشة".
       - setOverlaysWebView({overlay:false}) كان يلغي هذا العرض تحديداً وهو
         ما تحذّر منه Google  أزيل.
       يبقى فقط ضبط لون أيقونات الشريط ليطابق سمة التطبيق (فاتح/داكن)،
       لأن المحتوى صار يرسم خلف الشريط مباشرةً. */
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
          alert('لا تملك صلاحيات للوصول إلى هذه الصفحة');
          window.location.replace('/dashboard.html');
          document.body.style.display = 'none';
          return false;
        }
      }
      
      // Multiple roles check (new)
      if (options.requireRoles && Array.isArray(options.requireRoles)) {
        if (!user.roles || !options.requireRoles.some(r => user.roles.includes(r))) {
          alert('لا تملك صلاحيات للوصول إلى هذه الصفحة');
          window.location.replace('/dashboard.html');
          document.body.style.display = 'none';
          return false;
        }
      }
      if (options.polling !== false) this.startNotifPolling();
      this.verifyToken();
      this.renderAccountShortcut();
      this.renderBatchSwitcher();
      if (window.innerWidth <= 900) this.renderBottomNav();
      else this._navItemsForRole();  // نحسب التبويبات ليعرف زر الرجوع أيها جذري

      const hasInjectedBack = this.renderBackButton(); // Add back button if child page
      this._dedupeHeaderControls(hasInjectedBack);     // إزالة أزرار الصفحة المكرّرة
      this._dedupePageHeadings();                      // إزالة العناوين المكرّرة
      this._initGlobalSearch(); // Global search overlay
      this.initScrollAnimations(); // Scroll animations for cards and stats
      
      // تهيئة الإشعارات الحقيقية (FCM) وقنوات Android (تطبيق الهاتف فقط)
      this._initNotifChannels();
      this._initPushNotifications();
      this.requestNotifPermission();
    }
    
    // Hardware Back Button (Android)
    if (this._isCapacitor() && window.Capacitor?.Plugins?.App) {
      window.Capacitor.Plugins.App.addListener('backButton', () => {
        // 1) أي طبقة مفتوحة تُغلق أولاً — سلوك التطبيقات الأصلية.
        //    كان زر الرجوع يغادر الصفحة كلها والنافذة المنبثقة مفتوحة.
        if (this._closeTopOverlay()) return;

        // 2) صفحة جذرية (تبويب في شريط هذا الدور) → تأكيد قبل الخروج
        if (this.isRootPage()) {
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

        // 3) صفحة داخلية → رجوع، وإن لم يوجد سجل تصفح نعود للوحة المناسبة
        if (window.history.length > 1) window.history.back();
        else this.goHome();
      });
    }
    
    return true;
  },

  /* ===== حقن mobile.css للموبايل ===== */
  _injectMobileCSS() {
    if (document.getElementById('mobile-css')) return;
    // معظم الصفحات تربط mobile.css في <head> مسبقاً؛ الحقن كان ينزّل الملف مرة ثانية
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
      if (window.scrollY > 5) return;
      if (shouldPreventPTR(e.target)) {
        isPulling = false;
        return;
      }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      dist = 0; // مسافة اللمسة السابقة قد تبقى لو ألغي السحب في منتصفه
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
        // الصفحة التي تعرّف مستمع cbs:refresh (مع preventDefault) تجدد بياناتها فقط 
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

  /* ===== إنشاء قنوات الإشعارات في Android ===== */
  async _initNotifChannels() {
    const plugin = this._getLocalNotif();
    if (!plugin?.createChannel) return; // ليس على Android
    try {
      // قناة الإشعارات العادية  نغمة message_sound المخصصة
      await plugin.createChannel({
        id:          'general',
        name:        'إشعارات كلية تقنية المعلومات',
        description: 'الإشعارات الاعتيادية من كلية تقنية المعلومات',
        importance:  4,              // IMPORTANCE_HIGH  لضمان الصوت دائماً
        visibility:  1,              // VISIBILITY_PUBLIC
        sound:       'cbs_notif', // ملف res/raw/cbs_notif.wav
        vibration:   true,
        lights:      true,
        lightColor:  '#2563eb'
      });
      // قناة الإشعارات الطارئة  نغمة La-La-Do الأعلى
      await plugin.createChannel({
        id:          'emergency',
        name:        'إشعارات طارئة',
        description: 'تنبيهات عاجلة وطارئة  صوت مميز وأولوية قصوى',
        importance:  5,               // IMPORTANCE_MAX
        visibility:  1,
        sound:       'cbs_emergency', // ملف res/raw/cbs_emergency.wav
        vibration:   true,
        lights:      true,
        lightColor:  '#ef4444'
      });
    } catch { /* silent  قد لا يدعمها الجهاز */ }
  },


  /* ===== تهيئة Push Notifications (FCM) عبر Capacitor ===== */
  async _initPushNotifications() {
    if (!this._isCapacitor() || !window.Capacitor?.Plugins?.PushNotifications) return;
    const PushNotifications = window.Capacitor.Plugins.PushNotifications;
    
    try {
      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive !== 'granted') {
        permStatus = await PushNotifications.requestPermissions();
      }
      
      if (permStatus.receive === 'granted') {
        await PushNotifications.register();
      }

      // عند استلام التوكن من Firebase، نرسله للـ Backend ونربطه بحساب المستخدم الحالي
      PushNotifications.addListener('registration', async (token) => {
        if (!token?.value) return;
        try {
          await this.apiPost('/api/device/register', { token: token.value });
          localStorage.setItem('fcm_token', token.value);
          console.log('✅ FCM Token Registered for User');
        } catch(err) {
          console.warn('⚠  FCM Token Register Warn:', err.message);
        }
      });

      // عند حدوث خطأ في التسجيل
      PushNotifications.addListener('registrationError', (error) => {
        console.error(' Push registration error: ', JSON.stringify(error));
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

            // إشعار "يوجد تحديث جديد": نسخة جديدة جاهزة لكنها تنتظر إغلاق كل التبويبات 
            // نعرض شريطاً بزر يحدّث فوراً بدل انتظار المستخدم
            const showUpdateBar = (waiting) => {
              if (document.getElementById('cbsUpdateBar')) return;
              const bar = document.createElement('div');
              bar.id = 'cbsUpdateBar';
              bar.style.cssText = 'position:fixed;bottom:calc(80px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);z-index:99999;background:#0d3b66;color:#fff;border-radius:14px;padding:12px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,0.4);font-family:inherit;direction:rtl;max-width:92%;';
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
     وتوفير البيانات. الملفات غير الصورية (PDF) تعاد كما هي دون مساس. */
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
      if (!blob || blob.size >= file.size) return file; // لم ننجح في التصغير، نبقي الأصل

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

  // يطلب من زر صريح (إذن الإشعارات يحتاج إيماءة مستخدم، خصوصاً على iOS).
  // يعيد true عند النجاح.
  async enableWebPush() {
    try {
      if (this._isCapacitor()) return false; // التطبيق الأصلي يستخدم FCM
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      const keyRes = await this.apiGet('/api/device/webpush/key');
      const { key, enabled } = await keyRes.json();
      if (!enabled || !key) { console.warn('[Push] VAPID غير معدّ في الخادم'); return false; }

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
  // (الاشتراك قد يتغيّر أو يفقد بعد تحديث). لا يطلب إذناً ولا يزعج المستخدم.
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
        await this.enableWebPush(); // الإذن ممنوح فإعادة الاشتراك لن تظهر أي نافذة
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
            <div style="font-size:1.2rem;font-weight:900;line-height:1.2;margin-bottom:3px;">ثبّت التطبيق 📲</div>
            <div style="font-size:0.8rem;opacity:0.7;">جامعة النصر التقنية  CBS</div>
          </div>
          <button id="iosInstallClose" style="
            margin-right:auto;margin-left:0;
            background:rgba(255,255,255,0.12);border:none;color:#fff;
            width:32px;height:32px;border-radius:50%;font-size:1.1rem;
            cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;
          ">✕</button>
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
            ">✓</div>
            <div>
              <div style="font-weight:700;font-size:0.95rem;">اضغط <span style="color:#a78bfa;">إضافة</span>  خلاص! 🎉</div>
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
        ">فاهم، راح أثبّت الآن 🚀</button>

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
      <div class="arrow-icon">👇</div>
    `;
    document.body.appendChild(arw);
    // يختفي بعد 6 ثوان
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

/* ----- Intercept target="_blank" Links in Native App ----- */
document.addEventListener('click', function(e) {
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
  // app.js قد يحمَّل في <head> قبل وجود body  الانتظار إلزامي وإلا ظهر toast خطأ لكل زائر
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
   محلياً في /vendor/qrcode.min.js  ترميز حقيقي مع تصحيح أخطاء ودعم UTF-8
   (ضروري للأسماء العربية). */
CBS.renderQRCode = function(canvasOrId, text, options = {}) {
  const canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
  if (!canvas) return false;
  if (typeof qrcode !== 'function') {
    console.warn('renderQRCode: مكتبة qrcode غير محمّلة  أضف <script src="/vendor/qrcode.min.js">');
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
    console.warn('renderQRCode: تعذر ترميز البيانات ', e.message);
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, size, size);
    return false;
  }

  const count = qr.getModuleCount();
  // نقرّب حجم الوحدة لعدد صحيح حتى تبقى الحواف حادة ولا تتشوّه عند المسح
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

/* المعالجات حسب نوع المهمة  أي نوع غير مسجَّل هنا كان يحذف بصمت */
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

  /* مهم: لا نفرّغ الطابور قبل الإرسال. النسخة السابقة كانت تمسحه أولاً،
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
        // خطأ في البيانات نفسها: إعادة المحاولة لن تنجح أبداً  نسقطها ونبلّغ
        console.warn('مهمة أوفلاين مرفوضة نهائياً:', task.type, res.status);
      } else {
        remaining.push(task);                      // خطأ خادم/مؤقت → نعيد المحاولة لاحقاً
      }
    } catch (e) {
      remaining.push(task);                        // انقطاع الشبكة → نبقيها
      console.warn('Offline sync item failed:', e.message);
    }
  }

  this._offlineQueue = remaining;
  localStorage.setItem('cbs_offline_queue', JSON.stringify(remaining));
  this._flushing = false;

  if (remaining.length > 0 && successCount === 0) {
    this.toast('تعذرت المزامنة', `${remaining.length} عمليّة ما زالت محفوظة وسترفع لاحقاً`, 'warning');
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
   يظهر للمستخدم شريط تنبيه عند انقطاع الشبكة ويخفيه عند عودتها */
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
    banner.innerHTML = '<i class="ri-wifi-off-line"></i> أنت غير متصل بالإنترنت  يمكنك تصفح الصفحات المحفوظة';
    document.body.prepend(banner);
  }

  function hideOfflineBanner() {
    const banner = document.getElementById('cbs-offline-banner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s ease';
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 400);
      CBS.toast('عاد الاتصال بالإنترنت ✓', '', 'success', 3000);
    }
  }

  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online',  hideOfflineBanner);

  // التحقق عند التحميل
  if (!navigator.onLine) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showOfflineBanner);
    } else {
      showOfflineBanner();
    }
  }
})();
