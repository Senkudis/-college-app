/**
 * shared.js — دوال مشتركة بين تطبيق CBS وصفحات الاستقبال العامة.
 *
 * سبب وجود هذا الملف: `welcome.html` صفحة عامة مستقلة لا تحمّل `app.js`
 * (بتصميم مقصود: هويتها البصرية مختلفة ولا تحتاج المصادقة ولا شريط التنقل).
 * فكانت تحتفظ بنسختها الخاصة من دالة الهروب وبناء الرابط العام — ونسختاها
 * تباعدتا فعلياً: بقيت الصفحة بلا أي هروب لفترة، وشاركت روابط بـ localhost.
 *
 * لذلك: التعريف الوحيد هنا، ويحمّله الطرفان.
 * ملاحظة: يجب تحميل هذا الملف **قبل** app.js — يفرض ذلك فحصٌ في
 * scripts/check-ui.js فلا يمكن نسيانه في صفحة جديدة.
 */
(function (global) {
  'use strict';

  var PUBLIC_BASE_URL = 'https://elnasrcsit.website';

  var HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  /** يهرّب نصاً قبل إدراجه في HTML. آمن مع null/undefined/الأرقام. */
  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; });
  }

  /**
   * النطاق العام لأي رابط يخرج من الجهاز (مشاركة، رسائل واتساب، دعوات).
   * داخل تطبيق Capacitor يكون location.origin هو "http://localhost"، فأي
   * رابط مبني عليه لا يفتح عند أي شخص آخر.
   */
  function publicBaseUrl() {
    var host = global.location ? (global.location.hostname || '') : '';
    var origin = global.location ? (global.location.origin || '') : '';
    var isNative = !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());

    if (isNative || !host || host === 'localhost' || host === '127.0.0.1'
        || origin === 'null' || (global.location && global.location.protocol === 'file:')) {
      return PUBLIC_BASE_URL;
    }
    return origin;
  }

  function initNetworkListener() {
    if (!global.addEventListener || typeof document === 'undefined') return;
    global.addEventListener('offline', function () {
      var banner = document.getElementById('cbs-offline-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'cbs-offline-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#b91c1c;color:#fff;text-align:center;padding:6px 12px;font-size:0.8rem;font-weight:700;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
        banner.innerHTML = '<i class="ri-wifi-off-line"></i> انقطع الاتصال بالإنترنت — التصفح المحلي مفعل';
        if (document.body) document.body.appendChild(banner);
      } else {
        banner.style.background = '#ef4444';
        banner.innerHTML = '<i class="ri-wifi-off-line"></i> انقطع الاتصال بالإنترنت — التصفح المحلي مفعل';
        banner.style.display = 'block';
      }
    });

    global.addEventListener('online', function () {
      var banner = document.getElementById('cbs-offline-banner');
      if (banner) {
        banner.style.background = '#10b981';
        banner.innerHTML = '<i class="ri-wifi-line"></i> تم استعادة الاتصال بالإنترنت';
        setTimeout(function () { banner.style.display = 'none'; }, 2500);
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initNetworkListener);
    } else {
      initNetworkListener();
    }
  }

  global.CBSShared = {
    PUBLIC_BASE_URL: PUBLIC_BASE_URL,
    escapeHTML: escapeHTML,
    publicBaseUrl: publicBaseUrl
  };
})(typeof window !== 'undefined' ? window : globalThis);
