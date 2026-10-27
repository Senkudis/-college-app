/* ==========================================================================
   عارض الملفات الموحّد داخل التطبيق (CBSViewer) — 2026-10-24
   يُحمَّل عند أول فتح لملف (CBS.openFileViewer / CBS.renderFileInto).

   كانت المحاضرات تُفتح بطرق مختلفة في كل صفحة: صفحة المادة تعرض PDF والصور
   فقط وترفض Word/PowerPoint/Excel برسالة «لا يُعرض داخل التطبيق»، وبقية
   الصفحات (إدارة المحاضرات، الامتحانات السابقة، الواجبات، التسليمات، الإيصالات)
   روابط عادية تُخرج المستخدم إلى المتصفح. وملف PDF كان يُرسم بكل صفحاته قبل
   ظهور أي شيء، فمحاضرة من 80 صفحة تعلّق التطبيق أو تُغلقه لنفاد الذاكرة.

   الأنواع المدعومة:
   - PDF: عرض تدريجي (الصفحات القريبة فقط) بمحرك أندرويد الأصلي أو pdf.js، مع
     رقم الصفحة والتكبير، وتحرير الصفحات البعيدة من الذاكرة.
   - الصور، الفيديو، الصوت، النصوص والأكواد، CSV كجدول.
   - Word (docx): docx-preview محلياً (يعمل بلا إنترنت للملفات المحفوظة).
   - PowerPoint / Excel / Word القديم: عارض Office Online للملفات العامة فقط —
     الملفات الخاصة (تسليمات/إيصالات، روابطها تحمل توكن الجلسة) لا تُرسل إلى أي
     جهة خارجية.
   - الملفات المضغوطة: قائمة محتوياتها.
   - روابط الفيديو: يوتيوب وGoogle Drive ومقاطع مباشرة داخل التطبيق.
   ما لا يمكن عرضه إطلاقاً يُفتح بتطبيق آخر على الجهاز (لا رسالة بلا مخرج).
   ========================================================================== */
(function () {
  'use strict';
  const PUBLIC_ORIGIN = 'https://elnasrcsit.website';
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const esc = s => (window.CBS && CBS.escapeHTML ? CBS.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const OFFICE_VIEWER_MAX = { word: 10e6, ppt: 10e6, excel: 5e6 };

  const EXT = {
    pdf: ['pdf'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'],
    video: ['mp4', 'webm', 'mov', 'm4v', 'ogv', '3gp'],
    audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'amr'],
    docx: ['docx'],
    office: ['doc', 'ppt', 'pptx', 'pps', 'ppsx', 'xls', 'xlsx', 'odt', 'odp', 'ods', 'rtf'],
    csv: ['csv', 'tsv'],
    text: ['txt', 'md', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sql', 'sh', 'bat', 'kt', 'swift', 'go', 'rb', 'dart', 'yaml', 'yml', 'ini', 'log'],
    zip: ['zip', 'rar', '7z', 'tar', 'gz']
  };
  const LABEL = {
    pdf: 'ملف PDF', image: 'صورة', video: 'فيديو', audio: 'ملف صوتي', docx: 'مستند Word',
    doc: 'مستند Word', ppt: 'عرض PowerPoint', pptx: 'عرض PowerPoint', pps: 'عرض PowerPoint', ppsx: 'عرض PowerPoint',
    xls: 'جدول Excel', xlsx: 'جدول Excel', csv: 'جدول بيانات', zip: 'ملف مضغوط', rar: 'ملف مضغوط', '7z': 'ملف مضغوط',
    text: 'ملف نصي'
  };

  function extOf(name) {
    const clean = String(name || '').split(/[?#]/)[0];
    const m = clean.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    return m ? m[1] : '';
  }
  function kindFromExt(ext) {
    for (const k of Object.keys(EXT)) if (EXT[k].includes(ext)) return k;
    return '';
  }

  /* النوع من أول بايتات الملف قبل الامتداد: كثير من الملفات تُرفع بأسماء بلا امتداد
     أو بامتداد خاطئ (.bin)، والامتداد وحده كان يُفشل العرض. */
  function sniff(buf, name, contentType) {
    const ext = extOf(name);
    if (!buf || !buf.byteLength) return kindFromExt(ext) || 'unknown';
    const b = new Uint8Array(buf.slice(0, 16));
    const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
    if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'pdf';
    if (at(0, 0x89, 0x50, 0x4E, 0x47) || at(0, 0xFF, 0xD8, 0xFF) || at(0, 0x47, 0x49, 0x46) || at(0, 0x42, 0x4D)) return 'image';
    if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image';
    if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return 'audio';
    if (at(4, 0x66, 0x74, 0x79, 0x70)) return ['m4a', 'aac'].includes(ext) ? 'audio' : (ext === 'heic' ? 'image' : 'video');
    if (at(0, 0x1A, 0x45, 0xDF, 0xA3)) return 'video';
    if (at(0, 0x49, 0x44, 0x33) || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return 'audio';
    if (at(0, 0x4F, 0x67, 0x67, 0x53)) return ext === 'ogv' ? 'video' : 'audio';
    if (at(0, 0x50, 0x4B, 0x03, 0x04)) {
      if (ext === 'docx') return 'docx';
      if (EXT.office.includes(ext)) return 'office';
      return 'zip';
    }
    if (at(0, 0xD0, 0xCF, 0x11, 0xE0)) return 'office';
    if (at(0, 0x52, 0x61, 0x72, 0x21) || at(0, 0x37, 0x7A, 0xBC, 0xAF)) return 'zip';
    const byExt = kindFromExt(ext);
    if (byExt) return byExt;
    if (/^text\/|json|xml/.test(contentType || '')) return 'text';
    // لا بايت صفري في أول 4KB = نص على الأرجح
    const head = new Uint8Array(buf.slice(0, 4096));
    if (!head.includes(0)) return 'text';
    return 'unknown';
  }

  function nameFrom(url, fallback) {
    try {
      const n = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || '');
      return n || fallback || 'ملف';
    } catch (e) { return fallback || 'ملف'; }
  }
  function absUrl(url) {
    try { return new URL(url, (typeof API_BASE !== 'undefined' && API_BASE) || location.href).href; } catch (e) { return url; }
  }
  function isPrivateUrl(url) { return /[?&]token=/.test(url) || /\/uploads\/(submissions|receipts)\//.test(url); }
  function fmtSize(n) {
    if (!n) return '';
    return n > 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب';
  }

  const _scripts = {};
  function loadScript(src) {
    if (!_scripts[src]) {
      _scripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = resolve;
        s.onerror = () => { delete _scripts[src]; reject(new Error('تعذّر تحميل ' + src)); };
        document.head.appendChild(s);
      });
    }
    return _scripts[src];
  }
  async function loadPdfJs() {
    if (window.pdfjsLib) return;
    await loadScript('/vendor/pdfjs/pdf.min.js');
    try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('/vendor/pdfjs/pdf.worker.min.js', location.href).href; } catch (e) {}
  }

  /* التنزيل مع نسبة التقدم — الملف المحفوظ بلا نت يُقرأ من الجهاز أولاً */
  async function fetchBuffer(url, { signal, onProgress } = {}) {
    if (window.CBS && CBS.offlineGet) {
      const cached = await CBS.offlineGet(url);
      if (cached) return { buf: cached, contentType: '', offline: true };
    }
    const res = await fetch(url, { signal });
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    const contentType = res.headers.get('content-type') || '';
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !res.body.getReader) return { buf: await res.arrayBuffer(), contentType };
    const reader = res.body.getReader();
    const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.byteLength;
      if (onProgress) onProgress(got, total);
    }
    const out = new Uint8Array(got); let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return { buf: out.buffer, contentType };
  }

  /* ===== PDF: عرض تدريجي ===== */
  async function renderPdf(buf, host, ctx) {
    const nativePlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativePdf;
    let engine = null;
    if (nativePlugin && isNative()) {
      try {
        const b64 = CBS._abToBase64(buf.slice(0));
        const { pageCount } = await nativePlugin.load({ data: b64 });
        if (!pageCount) throw new Error('ملف بلا صفحات');
        engine = {
          count: pageCount,
          // المحرك الأصلي يملك خطوط النظام العربية فيعرض الملفات التي لم تُضمّن خطها
          async render(i, cssWidth) {
            const width = Math.min(2000, Math.round(cssWidth * Math.min(2.5, window.devicePixelRatio || 2)));
            const r = await nativePlugin.renderPage({ page: i, width });
            const img = new Image();
            img.decoding = 'async';
            img.src = 'data:image/jpeg;base64,' + r.data;
            await img.decode().catch(() => {});
            return { el: img, ratio: r.height / r.width };
          }
        };
      } catch (e) { console.warn('[viewer] المحرك الأصلي تعذّر، نستخدم pdf.js:', e.message || e); }
    }
    if (!engine) {
      await loadPdfJs();
      const base = new URL('/vendor/pdfjs/', location.href).href;
      const doc = await window.pdfjsLib.getDocument({
        data: new Uint8Array(buf.slice(0)), cMapUrl: base + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: base + 'standard_fonts/', useSystemFonts: true
      }).promise;
      engine = {
        count: doc.numPages,
        async render(i, cssWidth) {
          const page = await doc.getPage(i + 1);
          const vp1 = page.getViewport({ scale: 1 });
          const scale = (cssWidth / vp1.width) * Math.min(2.5, Math.max(1.5, window.devicePixelRatio || 1));
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
          await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp }).promise;
          page.cleanup();
          return { el: canvas, ratio: vp1.height / vp1.width };
        }
      };
    }

    host.innerHTML = '';
    host.classList.add('cv-pdf');
    const pages = [];
    let ratio = 1.4142;
    for (let i = 0; i < engine.count; i++) {
      const p = document.createElement('div');
      p.className = 'cv-page';
      p.dataset.i = i;
      p.style.aspectRatio = `1 / ${ratio}`;
      p.innerHTML = `<span class="cv-page-num">${i + 1}</span>`;
      host.appendChild(p);
      pages.push({ el: p, state: 'empty' });
    }
    ctx.setPages(engine.count);

    // طابور رسم واحد: المحرك الأصلي يقرأ ملفاً واحداً، والرسم المتوازي يضاعف الذاكرة
    let chain = Promise.resolve();
    const want = i => {
      const pg = pages[i];
      if (!pg || pg.state !== 'empty' || ctx.closed()) return;
      pg.state = 'loading';
      chain = chain.then(async () => {
        if (ctx.closed() || pg.state !== 'loading') return;
        try {
          const { el, ratio: r } = await engine.render(i, pg.el.clientWidth || host.clientWidth || 360);
          if (ctx.closed()) return;
          if (r && Math.abs(r - ratio) > 0.01 && i === 0) {
            ratio = r; pages.forEach(x => { if (x.state === 'empty') x.el.style.aspectRatio = `1 / ${r}`; });
          }
          pg.el.style.aspectRatio = `1 / ${r || ratio}`;
          el.className = 'cv-page-img';
          pg.el.querySelector('.cv-page-img')?.remove();
          pg.el.appendChild(el);
          pg.state = 'done';
        } catch (e) {
          pg.state = 'empty';
          console.warn('[viewer] صفحة', i + 1, e.message || e);
        }
      });
    };
    const drop = i => {
      const pg = pages[i];
      if (!pg || pg.state !== 'done') return;
      pg.el.querySelector('.cv-page-img')?.remove();
      pg.state = 'empty';
    };
    const near = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) want(Number(en.target.dataset.i)); });
    }, { root: ctx.scroller, rootMargin: '120% 0px' });
    // الصفحات البعيدة جداً تُحرَّر من الذاكرة وتُرسم من جديد عند العودة إليها
    const far = new IntersectionObserver(entries => {
      entries.forEach(en => { if (!en.isIntersecting) drop(Number(en.target.dataset.i)); });
    }, { root: ctx.scroller, rootMargin: '600% 0px' });
    const current = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) ctx.setPage(Number(en.target.dataset.i) + 1); });
    }, { root: ctx.scroller, rootMargin: '-45% 0px -45% 0px' });
    pages.forEach(p => { near.observe(p.el); far.observe(p.el); current.observe(p.el); });
    ctx.onClose(() => { near.disconnect(); far.disconnect(); current.disconnect(); });
    want(0);
  }

  /* ===== Word (docx) ===== */
  async function renderDocx(buf, host) {
    await loadScript('/vendor/office/jszip.min.js');
    await loadScript('/vendor/office/docx-preview.min.js');
    host.innerHTML = '';
    host.classList.add('cv-docx');
    const styles = document.createElement('div');
    await window.docx.renderAsync(buf.slice(0), host, styles, {
      className: 'cv-docx-doc', inWrapper: true, ignoreWidth: false, ignoreHeight: true,
      breakPages: true, experimental: true, useBase64URL: true
    });
    host.prepend(styles);
  }

  /* ===== نص / CSV ===== */
  function decodeText(buf) {
    const bytes = new Uint8Array(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) {
      // ملفات عربية قديمة من Windows (cp1256) تظهر رموزاً بلا هذا
      try { return new TextDecoder('windows-1256').decode(bytes); } catch (e2) { return new TextDecoder().decode(bytes); }
    }
  }
  function parseCsv(text, sep) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length && rows.length < 501; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function renderText(buf, host, name, kind) {
    const text = decodeText(buf);
    host.classList.add('cv-text');
    if (kind === 'csv') {
      const rows = parseCsv(text, extOf(name) === 'tsv' ? '\t' : (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ','));
      host.innerHTML = `<div class="cv-table-wrap"><table class="cv-table">${rows.slice(0, 500).map((r, i) =>
        `<tr>${r.map(c => i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>` +
        (rows.length > 500 ? '<p class="cv-note">يُعرض أول 500 صف فقط.</p>' : '');
      return;
    }
    const big = text.length > 400000;
    host.innerHTML = `<pre class="cv-pre" dir="auto">${esc(big ? text.slice(0, 400000) : text)}</pre>` +
      (big ? '<p class="cv-note">الملف طويل جداً — يُعرض أوله فقط. افتحه بتطبيق آخر لرؤيته كاملاً.</p>' : '');
  }

  async function renderZip(buf, host) {
    await loadScript('/vendor/office/jszip.min.js');
    const zip = await window.JSZip.loadAsync(buf.slice(0));
    const files = Object.values(zip.files).filter(f => !f.dir).slice(0, 300);
    host.classList.add('cv-text');
    host.innerHTML = `<div class="cv-zip"><h3><i class="ri-folder-zip-line"></i> محتويات الملف المضغوط (${files.length})</h3><ul>${
      files.map(f => `<li><i class="ri-file-line"></i><span dir="auto">${esc(f.name)}</span><small>${fmtSize(f._data && f._data.uncompressedSize)}</small></li>`).join('')
    }</ul><p class="cv-note">لاستخراج الملفات افتحه بتطبيق آخر.</p></div>`;
  }

  function officeViewerUrl(url) {
    // عارض Office Online يجلب الملف بنفسه: يلزم رابط عام، ولا نرسل أبداً روابط تحمل توكن
    if (isPrivateUrl(url)) return null;
    let abs = absUrl(url);
    if (/^https?:\/\/(localhost|127\.|10\.|192\.168\.)/.test(abs)) {
      if (!isNative()) return null;
    }
    if (abs.startsWith('https://localhost') || abs.startsWith('capacitor://')) abs = PUBLIC_ORIGIN + new URL(abs).pathname;
    return 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(abs);
  }

  function unsupported(host, name, ctx, reason) {
    const ext = extOf(name);
    host.innerHTML = `<div class="cv-empty">
      <i class="ri-file-3-line"></i>
      <strong>${esc(LABEL[ext] || 'هذا الملف')}</strong>
      <span dir="auto">${esc(name)}</span>
      <p>${esc(reason || 'لا يمكن عرض هذا النوع داخل التطبيق.')}</p>
      <button type="button" class="cv-btn cv-btn-primary" data-cv="external"><i class="ri-external-link-line"></i> فتح بتطبيق آخر</button>
    </div>`;
    host.querySelector('[data-cv="external"]').onclick = () => ctx.external();
  }

  /* يعرض الملف داخل حاوية معطاة. يُستخدم من نافذة العارض ومن نافذة صفحة المادة.
     يعيد { kind, name, buf } ليتمكن المستدعي من الحفظ أو الفتح الخارجي. */
  async function renderInto(host, url, opts = {}) {
    const ctxBase = opts.ctx || {};
    const ctx = {
      scroller: ctxBase.scroller || null,
      closed: ctxBase.closed || (() => false),
      onClose: ctxBase.onClose || (() => {}),
      setPages: ctxBase.setPages || (() => {}),
      setPage: ctxBase.setPage || (() => {}),
      external: ctxBase.external || (() => openExternally(url, null, opts.title))
    };
    const name = opts.name || nameFrom(url, opts.title);
    const extKind = kindFromExt(extOf(name));

    // الفيديو والصوت يُشغَّلان مباشرة من الرابط بلا تنزيل الملف كاملاً أولاً
    if ((extKind === 'video' || extKind === 'audio') && !isPrivateUrl(url)) {
      const tag = extKind === 'video' ? 'video' : 'audio';
      host.innerHTML = `<div class="cv-media"><${tag} controls playsinline preload="metadata" src="${esc(absUrl(url))}"></${tag}></div>`;
      const media = host.querySelector(tag);
      ctx.onClose(() => { try { media.pause(); media.removeAttribute('src'); media.load(); } catch (e) {} });
      return { kind: extKind, name, buf: null };
    }

    host.innerHTML = `<div class="cv-loading"><div class="cv-spinner"></div><span class="cv-loading-text">جاري تحميل الملف…</span><div class="cv-bar"><i style="width:0%"></i></div></div>`;
    const bar = host.querySelector('.cv-bar i'), txt = host.querySelector('.cv-loading-text');
    let fetched;
    try {
      fetched = await fetchBuffer(url, {
        signal: opts.signal,
        onProgress: (got, total) => {
          if (!bar) return;
          if (total) { bar.style.width = Math.round(got / total * 100) + '%'; txt.textContent = `جاري تحميل الملف… ${Math.round(got / total * 100)}% من ${fmtSize(total)}`; }
          else txt.textContent = `جاري تحميل الملف… ${fmtSize(got)}`;
        }
      });
    } catch (e) {
      if (e.name === 'AbortError') return { kind: 'aborted', name, buf: null };
      const offline = !navigator.onLine;
      host.innerHTML = `<div class="cv-empty">
        <i class="${offline ? 'ri-wifi-off-line' : 'ri-error-warning-line'}"></i>
        <strong>${offline ? 'لا يوجد اتصال بالإنترنت' : (e.status === 404 ? 'الملف غير موجود على الخادم' : 'تعذّر تحميل الملف')}</strong>
        <p>${offline ? 'هذا الملف غير محفوظ على جهازك. افتحه مرة واحدة بالإنترنت واحفظه ليصبح متاحاً بدون نت.' : (e.status === 404 ? 'ربما حُذف الملف أو أعيد رفعه. أبلغ المحاضر أو الليدر.' : 'تحقّق من الاتصال ثم أعد المحاولة.')}</p>
        ${e.status === 404 ? '' : '<button type="button" class="cv-btn cv-btn-primary" data-cv="retry"><i class="ri-refresh-line"></i> أعد المحاولة</button>'}
      </div>`;
      host.querySelector('[data-cv="retry"]')?.addEventListener('click', () => renderInto(host, url, opts));
      return { kind: 'error', name, buf: null };
    }
    if (ctx.closed()) return { kind: 'aborted', name, buf: null };

    const { buf, contentType } = fetched;
    let kind = sniff(buf, name, contentType);
    let finalName = name;
    if (kind === 'pdf' && extOf(finalName) !== 'pdf') finalName = finalName.replace(/\.[^.]*$/, '') + '.pdf';
    const extCtx = { ...ctx, external: () => openExternally(url, buf, finalName) };
    host.className = host.className.replace(/\bcv-(pdf|docx|text)\b/g, '').trim();

    try {
      if (kind === 'pdf') await renderPdf(buf, host, extCtx);
      else if (kind === 'image') {
        const blobUrl = URL.createObjectURL(new Blob([buf], contentType ? { type: contentType } : undefined));
        host.innerHTML = `<div class="cv-image"><img src="${blobUrl}" alt="${esc(opts.title || finalName)}"></div>`;
        const img = host.querySelector('img');
        img.addEventListener('click', () => img.classList.toggle('zoomed'));
        ctx.onClose(() => URL.revokeObjectURL(blobUrl));
      } else if (kind === 'video' || kind === 'audio') {
        const blobUrl = URL.createObjectURL(new Blob([buf], contentType ? { type: contentType } : undefined));
        const tag = kind;
        host.innerHTML = `<div class="cv-media"><${tag} controls playsinline src="${blobUrl}"></${tag}></div>`;
        ctx.onClose(() => URL.revokeObjectURL(blobUrl));
      } else if (kind === 'docx') {
        try { await renderDocx(buf, host); }
        catch (e) {
          console.warn('[viewer] docx-preview:', e.message || e);
          const viewer = buf.byteLength <= OFFICE_VIEWER_MAX.word && officeViewerUrl(url);
          if (viewer) renderOfficeFrame(host, viewer, finalName, extCtx);
          else unsupported(host, finalName, extCtx, 'تعذّر قراءة هذا المستند داخل التطبيق.');
        }
      } else if (kind === 'office') {
        const ext = extOf(finalName);
        const limit = /^xl|ods/.test(ext) ? OFFICE_VIEWER_MAX.excel : OFFICE_VIEWER_MAX.ppt;
        const viewer = officeViewerUrl(url);
        if (!navigator.onLine) unsupported(host, finalName, extCtx, 'عرض هذا النوع يحتاج اتصالاً بالإنترنت. يمكنك فتحه بتطبيق Office على جهازك.');
        else if (!viewer) unsupported(host, finalName, extCtx, isPrivateUrl(url)
          ? 'هذا ملف خاص لا يُرسل لعارض خارجي. افتحه بتطبيق Office على جهازك.'
          : 'عرض هذا النوع يتطلب أن يكون الملف على الخادم العام. افتحه بتطبيق Office على جهازك.');
        else if (buf.byteLength > limit) unsupported(host, finalName, extCtx, `حجم الملف (${fmtSize(buf.byteLength)}) أكبر مما يعرضه العارض. افتحه بتطبيق Office على جهازك، أو اطلب من المحاضر رفعه بصيغة PDF.`);
        else renderOfficeFrame(host, viewer, finalName, extCtx);
      } else if (kind === 'text' || kind === 'csv') renderText(buf, host, finalName, kind);
      else if (kind === 'zip') {
        try { await renderZip(buf, host); } catch (e) { unsupported(host, finalName, extCtx, 'ملف مضغوط لا يمكن قراءة محتوياته هنا (RAR/7z). افتحه بتطبيق آخر.'); }
      } else unsupported(host, finalName, extCtx);
    } catch (e) {
      console.warn('[viewer] render failed:', e);
      unsupported(host, finalName, extCtx, 'تعذّر عرض الملف داخل التطبيق.');
      kind = 'error';
    }
    return { kind, name: finalName, buf };
  }

  function renderOfficeFrame(host, viewerUrl, name, ctx) {
    host.innerHTML = `<div class="cv-office">
      <div class="cv-office-loading"><div class="cv-spinner"></div><span>جاري تجهيز ${esc(LABEL[extOf(name)] || 'الملف')} للعرض…</span></div>
      <iframe src="${esc(viewerUrl)}" title="${esc(name)}" allowfullscreen referrerpolicy="no-referrer"></iframe>
      <button type="button" class="cv-office-alt" data-cv="external"><i class="ri-external-link-line"></i> لم يظهر؟ افتحه بتطبيق آخر</button>
    </div>`;
    const frame = host.querySelector('iframe');
    frame.addEventListener('load', () => host.querySelector('.cv-office-loading')?.remove());
    host.querySelector('[data-cv="external"]').onclick = () => ctx.external();
  }

  /* فتح بتطبيق آخر: داخل التطبيق نكتب الملف ثم نافذة "فتح بواسطة/مشاركة"،
     وفي المتصفح تنزيل عادي. */
  async function openExternally(url, buf, name) {
    try {
      if (buf && window.CBS && CBS.openFileExternally) {
        const r = await CBS.openFileExternally(buf.slice(0), name || nameFrom(url), absUrl(url));
        if (r === 'shared') CBS.toast('اختر التطبيق المناسب لفتح الملف', '', 'info');
        return;
      }
    } catch (e) { console.warn('[viewer] external:', e); }
    window.open(absUrl(url), isNative() ? '_system' : '_blank');
  }

  /* ===== نافذة العارض ===== */
  let current = null;
  function open(url, opts = {}) {
    if (current) current.close(true);
    const title = opts.title || nameFrom(url);
    const overlay = document.createElement('div');
    overlay.className = 'cv-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.innerHTML = `
      <header class="cv-head">
        <button type="button" class="cv-icon" data-cv="close" aria-label="إغلاق"><i class="ri-arrow-right-line"></i></button>
        <div class="cv-title"><strong dir="auto">${esc(title)}</strong><small class="cv-sub"></small></div>
        <button type="button" class="cv-icon" data-cv="zoomout" aria-label="تصغير" hidden><i class="ri-zoom-out-line"></i></button>
        <button type="button" class="cv-icon" data-cv="zoomin" aria-label="تكبير" hidden><i class="ri-zoom-in-line"></i></button>
        <button type="button" class="cv-icon" data-cv="external" aria-label="فتح بتطبيق آخر أو مشاركة"><i class="${isNative() ? 'ri-share-forward-line' : 'ri-download-2-line'}"></i></button>
      </header>
      <div class="cv-scroller"><div class="cv-host"></div></div>
      <div class="cv-pagechip" hidden></div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open', 'cv-open');
    const host = overlay.querySelector('.cv-host');
    const scroller = overlay.querySelector('.cv-scroller');
    const chip = overlay.querySelector('.cv-pagechip');
    const sub = overlay.querySelector('.cv-sub');
    const abort = new AbortController();
    const closers = [];
    let closed = false, total = 0, zoom = 1, result = null;

    const close = (silent) => {
      if (closed) return;
      closed = true;
      abort.abort();
      closers.forEach(fn => { try { fn(); } catch (e) {} });
      overlay.classList.add('leaving');
      document.body.classList.remove('cv-open');
      if (!document.querySelector('.modal-overlay.active, .modal.show, #globalKedyModal.active')) document.body.classList.remove('modal-open');
      setTimeout(() => overlay.remove(), 220);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      if (!silent && history.state && history.state.cbsViewer) history.back();
      current = null;
    };
    // زر الرجوع في أندرويد يُغلق العارض بدل مغادرة الصفحة
    const onPop = () => close(true);
    try { history.pushState({ cbsViewer: true }, ''); } catch (e) {}
    window.addEventListener('popstate', onPop);
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    const setZoom = z => {
      zoom = Math.max(1, Math.min(3, z));
      host.style.setProperty('--cv-zoom', zoom);
      overlay.querySelector('[data-cv="zoomout"]').disabled = zoom <= 1;
      overlay.querySelector('[data-cv="zoomin"]').disabled = zoom >= 3;
    };
    overlay.addEventListener('click', e => {
      const btn = e.target.closest('[data-cv]');
      if (!btn || !overlay.contains(btn)) return;
      const a = btn.dataset.cv;
      if (a === 'close') close();
      else if (a === 'zoomin') setZoom(zoom + 0.5);
      else if (a === 'zoomout') setZoom(zoom - 0.5);
      else if (a === 'external' && btn.closest('.cv-head')) openExternally(url, result && result.buf, result && result.name);
    });

    renderInto(host, url, {
      title, name: opts.name, signal: abort.signal,
      ctx: {
        scroller, closed: () => closed, onClose: fn => closers.push(fn),
        setPages: n => {
          total = n;
          sub.textContent = n + ' صفحة';
          chip.hidden = false;
          overlay.querySelectorAll('[data-cv="zoomin"],[data-cv="zoomout"]').forEach(b => { b.hidden = false; });
          setZoom(1);
        },
        setPage: p => { chip.textContent = `${p} / ${total}`; }
      }
    }).then(r => {
      result = r;
      if (r && r.kind && !['pdf', 'error', 'aborted'].includes(r.kind)) sub.textContent = LABEL[r.kind] || LABEL[extOf(r.name)] || '';
      if (r && r.buf) sub.textContent += (sub.textContent ? ' · ' : '') + fmtSize(r.buf.byteLength);
    });

    current = { close };
    setTimeout(() => overlay.querySelector('[data-cv="close"]').focus({ preventScroll: true }), 50);
    return current;
  }

  /* ===== روابط الفيديو (يوتيوب / Drive / مقطع مباشر) ===== */
  function mediaEmbed(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host.endsWith('youtube.com')) {
      id = u.searchParams.get('v') || (u.pathname.match(/\/(embed|shorts|live)\/([^/?#]+)/) || [])[2];
    }
    if (id) {
      const t = parseInt(u.searchParams.get('t') || '0', 10);
      return { type: 'frame', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&playsinline=1${t ? '&start=' + t : ''}` };
    }
    if (host === 'drive.google.com') {
      const m = u.pathname.match(/\/file\/d\/([^/]+)/) || [null, u.searchParams.get('id')];
      if (m[1]) return { type: 'frame', src: `https://drive.google.com/file/d/${encodeURIComponent(m[1])}/preview` };
    }
    if (kindFromExt(extOf(u.pathname)) === 'video' || kindFromExt(extOf(u.pathname)) === 'audio') return { type: 'file' };
    return null;
  }

  function openMedia(url, title) {
    const embed = mediaEmbed(url);
    if (!embed) return false;
    if (embed.type === 'file') { open(url, { title }); return true; }
    if (current) current.close(true);
    const overlay = document.createElement('div');
    overlay.className = 'cv-overlay cv-video';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <header class="cv-head">
        <button type="button" class="cv-icon" data-cv="close" aria-label="إغلاق"><i class="ri-arrow-right-line"></i></button>
        <div class="cv-title"><strong dir="auto">${esc(title || 'فيديو المحاضرة')}</strong></div>
        <button type="button" class="cv-icon" data-cv="ext" aria-label="فتح في التطبيق الأصلي"><i class="ri-external-link-line"></i></button>
      </header>
      <div class="cv-scroller"><div class="cv-frame-wrap"><iframe src="${esc(embed.src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div></div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open', 'cv-open');
    let closed = false;
    const close = silent => {
      if (closed) return; closed = true;
      overlay.querySelector('iframe').src = 'about:blank';
      overlay.classList.add('leaving');
      document.body.classList.remove('cv-open');
      if (!document.querySelector('.modal-overlay.active, .modal.show, #globalKedyModal.active')) document.body.classList.remove('modal-open');
      setTimeout(() => overlay.remove(), 220);
      window.removeEventListener('popstate', onPop);
      if (!silent && history.state && history.state.cbsViewer) history.back();
      current = null;
    };
    const onPop = () => close(true);
    try { history.pushState({ cbsViewer: true }, ''); } catch (e) {}
    window.addEventListener('popstate', onPop);
    overlay.addEventListener('click', e => {
      const a = e.target.closest('[data-cv]')?.dataset.cv;
      if (a === 'close') close();
      else if (a === 'ext') window.open(url, isNative() ? '_system' : '_blank');
    });
    current = { close };
    return true;
  }

  window.CBSViewer = { open, renderInto, openMedia, mediaEmbed, sniff, openExternally };
})();
