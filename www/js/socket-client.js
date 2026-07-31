/* =====================================================
   CBS Socket Client — Real-time WebSocket
   يدعم Socket.io مع auto-reconnect + Long Polling fallback
   ===================================================== */

(function () {
  'use strict';

  // لا تفعّل في Capacitor Native (يستخدم FCM بدلاً منه)
  if (typeof window === 'undefined') return;
  if (window.Capacitor?.isNativePlatform?.()) return;

  const PROD_URL = 'https://elnasrcsit.website';
  const _IS_CAP = !!(window.Capacitor?.isNativePlatform?.());
  const SOCKET_URL = _IS_CAP ? PROD_URL : (window.location.origin);

  let socket = null;
  let _reconnectTimer = null;
  let _connected = false;

  /* ───── تهيئة الاتصال ───── */
  function initSocket() {
    if (!window.io) {
      // حمّل مكتبة socket.io-client من الخادم ثم أعد الاتصال
      const s = document.createElement('script');
      s.src = SOCKET_URL + '/socket.io/socket.io.js';
      s.onload = () => connect();
      s.onerror = () => console.warn('[Socket] io.js failed to load');
      document.head.appendChild(s);
      return;
    }
    connect();
  }

  function connect() {
    if (socket) socket.disconnect();

    const token = localStorage.getItem('token');
    if (!token) return; // غير مسجل الدخول

    socket = window.io(SOCKET_URL, {
      auth: { token },
      /* polling أولاً ثم ترقية تلقائية إلى websocket.
         كان الترتيب معكوساً ('websocket' أولاً)، وSocket.IO لا يتراجع إلى
         polling ضمن نفس المحاولة — بل يفشل ويعيد المحاولة، فتمتلئ الطرفية
         برسائل "websocket error" ويتأخر الاتصال. الترتيب الافتراضي يتصل
         فوراً عبر polling ثم يرقّي بصمت إن سمح الوسيط. */
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 20000,
      timeout: 10000
    });

    socket.on('connect', () => {
      _connected = true;
      console.log('[Socket] Connected:', socket.id);
      // انضم لغرفة المستخدم ولغرفة الدفعة
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const batchId = new URLSearchParams(location.search).get('batch') || localStorage.getItem('cbs_active_batch_id');
      if (user.id || user._id) socket.emit('join:user', user.id || user._id);
      if (batchId) socket.emit('join:batch', batchId);
    });

    socket.on('disconnect', (reason) => {
      _connected = false;
      console.warn('[Socket] Disconnected:', reason);
    });

    /* الاتصال اللحظي ميزة إضافية لا شرط لعمل التطبيق (هناك استطلاع دوري
       للإشعارات). لذا نسجّل أول خطأ فقط بدل إغراق الطرفية برسالة مع كل
       محاولة من محاولات إعادة الاتصال العشر. */
    let _errLogged = false;
    socket.on('connect_error', (err) => {
      if (_errLogged) return;
      _errLogged = true;
      console.warn('[Socket] تعذّر الاتصال اللحظي (سيُعاد المحاولة بصمت):', err.message);
    });
    socket.on('connect', () => { _errLogged = false; });
    // تفعيل فك حظر الصوت بلمسة المستخدم الأولى على الشاشة
    let _audioUnlocked = false;
    function _unlockAudio() {
      if (_audioUnlocked) return;
      _audioUnlocked = true;
      try {
        const dummy = new Audio('/sounds/cbs_notif.wav');
        dummy.volume = 0.001;
        dummy.play().then(() => dummy.pause()).catch(() => {});
      } catch(e) {}
      window.removeEventListener('click', _unlockAudio);
      window.removeEventListener('touchstart', _unlockAudio);
    }
    window.addEventListener('click', _unlockAudio);
    window.addEventListener('touchstart', _unlockAudio);

    /* ─── تشغيل ملف الصوت الخاص بالتنبيهات ─── */
    function playNotifSound(isEmergency = false) {
      const soundUrl = isEmergency ? '/sounds/cbs_emergency.wav' : '/sounds/cbs_notif.wav';
      try {
        const audio = new Audio(soundUrl);
        audio.volume = 1.0;
        const playPromise = audio.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(() => {
            // تراجع لنغمة المصنّع إذا حظر المتصفح التشغيل التلقائي للملف
            _playOscillatorFallback(isEmergency);
          });
        }
      } catch(e) {
        _playOscillatorFallback(isEmergency);
      }

      if (navigator.vibrate) {
        navigator.vibrate(isEmergency ? [200, 100, 200] : [100]);
      }
    }

    function _playOscillatorFallback(isEmergency) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0.2;
        if (isEmergency) {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.5);
        } else {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(523, ctx.currentTime);
          osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
        }
      } catch(e) {}
    }

    /* ─── الأحداث الفورية ─── */

    // إشعار جديد → Toast + تحديث Badge
    socket.on('notification:new', (data) => {
      // تجاهل الإشعارات الموجهة لدور لا يملكه المستخدم (target بصيغة الجمع)
      if (data && data.target && data.target !== 'all') {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const roles = user.roles || [];
        const isDeanOrAdmin = roles.includes('dean') || roles.includes('admin');
        const matches = isDeanOrAdmin || roles.some(r => r + 's' === data.target);
        if (!matches) return;
      }
      if (typeof CBS !== 'undefined') {
        const isEmergency = data.type === 'emergency';
        playNotifSound(isEmergency);
        CBS.toast(data.title || 'إشعار جديد', data.message || '', isEmergency ? 'emergency' : 'info', isEmergency ? 10000 : 5000);
        // تحديث عداد الإشعارات في الهيدر
        const badge = document.getElementById('notifBadge');
        if (badge) {
          const cur = parseInt(badge.textContent) || 0;
          badge.textContent = cur + 1;
          badge.style.display = '';
        }
        // إذا كانت الصفحة هي الإشعارات، حدّث القائمة
        if (window.refreshNotifications && typeof window.refreshNotifications === 'function') {
          window.refreshNotifications();
        }
      }
    });

    // واجب جديد
    socket.on('assignment:new', (data) => {
      if (typeof CBS !== 'undefined') {
        playNotifSound(false);
        CBS.toast('واجب جديد: ' + (data.title || ''), 'اضغط لعرض التفاصيل', 'info');
      }
    });

    // تحديث حالة التسليم (تقييم)
    socket.on('submission:graded', (data) => {
      if (typeof CBS !== 'undefined') {
        playNotifSound(false);
        CBS.toast('تم تقييم واجبك', `الدرجة: ${data.grade ?? '—'}`, 'success');
      }
    });

    // تحديث الحضور
    socket.on('attendance:recorded', () => {
      if (typeof CBS !== 'undefined') {
        CBS.toast('تم تسجيل حضورك', '', 'success');
      }
    });
  }

  /* ───── Smart Install Banner (APK / iOS PWA) ───── */
  function detectAndShowInstall() {
    if (localStorage.getItem('pwa_dismissed')) return;
    if (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches) return; // Already installed

    const ua = navigator.userAgent.toLowerCase();
    const isAndroid = /android/.test(ua);
    const isIOS = /iphone|ipad|ipod/.test(ua);

    // تأخير ظهور البانر قليلاً لتجربة مستخدم أفضل
    setTimeout(() => {
      if (isAndroid) {
        showSmartBanner('android');
      } else if (isIOS) {
        showSmartBanner('ios');
      }
    }, 2000);
  }

  function showSmartBanner(os) {
    if (document.getElementById('pwa-install-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    
    if (os === 'android') {
      banner.innerHTML = `
        <div class="pwa-icon"><i class="ri-download-2-line"></i></div>
        <div class="pwa-text">
          <strong>التطبيق الرسمي للأندرويد</strong>
          <small>حمل التطبيق الحقيقي لتجربة أسرع وأفضل</small>
        </div>
        <div class="pwa-actions">
          <button class="btn-install" onclick="window._dismissPWA(); location.href='/assets/kedwebcbs.apk'">تحميل</button>
          <button class="btn-dismiss" onclick="window._dismissPWA()">لاحقاً</button>
        </div>`;
    } else {
      // iOS
      banner.innerHTML = `
        <div class="pwa-icon"><i class="ri-apple-line"></i></div>
        <div class="pwa-text">
          <strong>ثبّت التطبيق على الآيفون</strong>
          <small>اضغط على أيقونة المشاركة <i class="ri-share-box-line" style="font-size:1.1rem;vertical-align:middle"></i> ثم (Add to Home Screen)</small>
        </div>
        <div class="pwa-actions">
          <button class="btn-dismiss" onclick="window._dismissPWA()">حسناً</button>
        </div>`;
    }
    document.body.appendChild(banner);
  }

  window._dismissPWA = () => {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.remove();
    localStorage.setItem('pwa_dismissed', '1');
  };

  /* ───── Offline Bar ───── */
  function setupOfflineBar() {
    let bar = document.getElementById('offline-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'offline-bar';
      bar.innerHTML = '<i class="ri-wifi-off-line"></i> لا يوجد اتصال بالإنترنت';
      bar.style.cssText = 'display: none; background: #ef4444; color: white; text-align: center; padding: 8px; font-weight: bold; position: sticky; top: 0; z-index: 9999; font-size: 0.9rem;';
      document.body.insertAdjacentElement('afterbegin', bar);
    }

    const updateOfflineStatus = () => {
      if (bar) {
        bar.style.display = navigator.onLine ? 'none' : 'block';
      }
    };

    window.addEventListener('online', updateOfflineStatus);
    window.addEventListener('offline', updateOfflineStatus);
    updateOfflineStatus();
  }

  /* ───── Bootstrap ───── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupOfflineBar();
      initSocket();
      detectAndShowInstall();
    });
  } else {
    setupOfflineBar();
    initSocket();
    detectAndShowInstall();
  }

  // نصدّر للاستخدام الخارجي
  window.CBSSocket = {
    get connected() { return _connected; },
    emit: (ev, data) => socket?.emit(ev, data),
    on: (ev, fn)    => socket?.on(ev, fn),
    reconnect: () => connect()
  };
})();
