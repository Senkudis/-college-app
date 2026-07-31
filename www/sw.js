// Service Worker for CBS College LMS — v1.4.8 (Offline + Speed Boost)
const CACHE_VERSION = 'cbs-v1.4.8';
const STATIC_CACHE  = CACHE_VERSION + '-static';
const API_CACHE     = CACHE_VERSION + '-api';
const FILES_CACHE   = 'cbs-offline-files'; // الثبات للحفاظ على الملفات المحملة يدوياً

const STATIC_ASSETS = [
  '/',
  '/offline.html',
  '/login.html',
  '/dashboard.html',
  '/subjects.html',
  '/subject.html',
  '/assignments.html',
  '/submit-assignment.html',
  '/notifications.html',
  '/video-library.html',
  '/watch-video.html',
  '/attendance-history.html',
  '/financials.html',
  '/quizzes.html',
  '/campus.html',
  '/batch-selector.html',
  '/admin_dashboard.html',
  '/admin_batch_details.html',
  '/manage-users.html',
  '/manage-batches.html',
  '/manage-subjects.html',
  '/manage-lectures.html',
  '/manage-attendance.html',
  '/manage-notifications.html',
  '/manage-submissions.html',
  '/creator-studio.html',
  '/reports.html',
  '/force-change-password.html',
  '/forgot-password.html',
  '/new-password.html',
  '/reset-code.html',
  '/404.html',
  '/admin-content.html',
  '/profile.html',
  '/welcome.html',
  '/index.html',
  '/assets/logo.png',
  '/assets/icon.png',
  '/css/style.css',
  '/css/mobile.css',
  '/js/shared.js',
  '/js/app.js',
  '/manifest.json',
  '/vendor/remixicon/remixicon.css',
  '/vendor/remixicon/remixicon.woff2',
  '/vendor/fonts/cairo.css',
  '/vendor/simplewebauthn.umd.min.js',
  '/sounds/cbs_notif.wav',
  '/sounds/cbs_emergency.wav',
  '/sounds/message-sound.mp3'
];

// API paths to cache for offline viewing
const API_CACHE_PATTERNS = [
  '/api/subjects',
  '/api/lectures',
  '/api/assignments',
  '/api/notifications',
  '/api/videos',
  '/api/batches',
  '/api/attendance/history'
];

/* ═══════════════════════════════════════════
   INSTALL — Pre-cache all static assets
   ═══════════════════════════════════════════ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(
          STATIC_ASSETS.map(url => new Request(url, { credentials: 'same-origin' }))
        ).catch(err => {
          console.warn('[SW] Some assets failed to cache:', err);
          return Promise.allSettled(
            STATIC_ASSETS.map(url =>
              cache.add(new Request(url, { credentials: 'same-origin' })).catch(() => {})
            )
          );
        });
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ═══════════════════════════════════════════
   PUSH — إشعارات Web Push (متصفح/آيفون PWA)
   ═══════════════════════════════════════════ */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = { body: event.data && event.data.text() }; }

  const isEmergency = payload.data?.isEmergency === 'true' || payload.data?.isEmergency === true;
  const title = payload.title || 'كلية تقنية المعلومات';
  const options = {
    body: payload.body || '',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-72.png',
    dir: 'rtl',
    lang: 'ar',
    tag: isEmergency ? 'emergency' : 'general',
    renotify: isEmergency,
    requireInteraction: isEmergency,
    sound: isEmergency ? '/sounds/cbs_emergency.wav' : '/sounds/cbs_notif.wav',
    vibrate: isEmergency ? [200, 100, 200, 100, 200] : [100],
    data: { url: (payload.data && payload.data.url) || '/notifications.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/notifications.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // لو التطبيق مفتوح، نركّز عليه وننقله للصفحة بدل فتح نافذة جديدة
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

/* ═══════════════════════════════════════════
   ACTIVATE — Clean old caches
   ═══════════════════════════════════════════ */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(n => n !== STATIC_CACHE && n !== API_CACHE && n !== FILES_CACHE)
             .map(n => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

/* ═══════════════════════════════════════════
   FETCH — Smart routing strategies
   ═══════════════════════════════════════════ */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // طلبات النطاق (Range) — يرسلها <video>/<audio> وعارض PDF عند التقديم/الترجيع.
  // الخادم يرد عليها بـ 206 Partial Content، و Cache API يرفض تخزينه ويرمي
  // "Failed to execute 'put' on 'Cache': Partial response (status code 206) is unsupported".
  // نتركها للمتصفح مباشرة — لا اعتراض ولا تخزين.
  if (request.headers.has('range')) return;

  const isRemoteApi = (url.hostname === 'elnasrcsit.website' || url.pathname.startsWith('/api/'));
  const isSameOrigin = url.origin === location.origin;
  if (!isSameOrigin && !isRemoteApi) return;

  // API requests → Network First (cache response for offline)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Uploaded Files (PDF, Video) → Cache First (only if explicitly downloaded by user)
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(filesCacheStrategy(request));
    return;
  }

  // Static assets (CSS, JS, images) → Cache First (fast!)
  if (/\.(css|js|png|jpg|jpeg|svg|gif|ico|woff2?|ttf|wav|mp3)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages → Network First with offline.html fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // Everything else → Network First
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

/* ─── Safe Cache Put Helper ───
   خط الدفاع الأخير: Cache API يرفض أي استجابة جزئية (206) ويرمي استثناءً غير ملتقط.
   نتحقق من كل الشروط صراحةً بدل الاعتماد على المُستدعي. */
function isCacheable(request, response) {
  if (!response) return false;
  if (response.status !== 200) return false;          // يشمل 206 و 3xx و 4xx و 5xx
  if (response.type === 'opaque') return false;       // لا يمكن التحقق منها
  if (response.headers.get('content-range')) return false; // استجابة جزئية رغم الحالة 200
  if (request && request.headers.has('range')) return false;
  return true;
}

function safeCachePut(cache, request, response) {
  if (!isCacheable(request, response)) return;
  try {
    // put غير متزامنة وقد ترفض لاحقاً — لا بد من catch وإلا ظهر Uncaught (in promise)
    cache.put(request, response).catch(() => {});
  } catch {
    // بعض المتصفحات ترمي بشكل متزامن بدل الرفض
  }
}

/* ─── Strategy: Network First ─── */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.status === 200) safeCachePut(cache, request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return new Response(JSON.stringify({ success: false, message: 'أنت غير متصل بالإنترنت' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/* ─── Strategy: Network First for HTML (offline.html fallback) ─── */
async function networkFirstHTML(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.status === 200) {
      safeCachePut(cache, request, response.clone());
      return response;
    }
    // إذا أرجع السيرفر 500 أو 503 (تعطل مؤقت في cPanel أو إعادة تشغيل الخادم)
    if (response.status >= 500) {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
    }
    return response;
  } catch {
    // Try cached version of this page first (مع ignoreSearch لدعم المعاملات مثل ?id=...)
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Fallback to offline page
    const offlinePage = await cache.match('/offline.html');
    if (offlinePage) return offlinePage;
    return new Response('Offline', { status: 503 });
  }
}

/* ─── Strategy: Cache First (for static assets — blazing fast) ─── */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    // Update in background (stale-while-revalidate)
    fetch(request).then(res => {
      if (res.status === 200) safeCachePut(cache, request, res);
    }).catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.status === 200) safeCachePut(cache, request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

/* ─── Strategy: Cache First for files (PDFs, Videos) — يخزّن تلقائياً عند الفتح ─── */
async function filesCacheStrategy(request) {
  const cache = await caches.open(FILES_CACHE);

  // أولاً: هل الملف محفوظ؟ → اخدمه فوراً بدون نت
  const cached = await cache.match(request);
  if (cached) {
    // تحديث الكاش في الخلفية إذا كان النت متاح (stale-while-revalidate)
    fetch(request).then(res => {
      if (res.status === 200) safeCachePut(cache, request, res);
    }).catch(() => {});
    return cached;
  }

  // لا يوجد في الكاش → اجلب من النت وخزّن تلقائياً للمرة القادمة
  try {
    const response = await fetch(request);
    if (response.status === 200) {
      // خزّن الملف تلقائياً بمجرد فتحه (PDF أو فيديو)
      safeCachePut(cache, request, response.clone());
    }
    return response;
  } catch {
    // لا نت ولا كاش → رسالة واضحة
    return new Response(
      JSON.stringify({ offline: true, message: 'هذا الملف لم يُفتح من قبل — يحتاج اتصال بالإنترنت لأول مرة' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}


/* ═══════════════════════════════════════════
   BACKGROUND SYNC (Offline)
   ═══════════════════════════════════════════ */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CBS_Sync', 1);
    request.onupgradeneeded = e => {
      e.target.result.createObjectStore('submissions', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = e => resolve(e.target.result);
    request.onerror = e => reject(e.target.error);
  });
}

async function saveSubmission(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('submissions', 'readwrite');
    const store = tx.objectStore('submissions');
    const req = store.add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getSubmissions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('submissions', 'readonly');
    const store = tx.objectStore('submissions');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteSubmission(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('submissions', 'readwrite');
    const store = tx.objectStore('submissions');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-submissions') {
    event.waitUntil(
      getSubmissions().then(async (submissions) => {
        for (const sub of submissions) {
          try {
            const formData = new FormData();
            formData.append('assignmentId', sub.assignmentId);
            formData.append('submissionType', sub.submissionType);
            formData.append('notes', sub.notes);
            if (sub.file) formData.append('file', sub.file, sub.fileName || 'offline-file');
            
            const res = await fetch('/api/submissions/submit', {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + sub.token },
              body: formData
            });
            if (res.ok) await deleteSubmission(sub.id);
          } catch (e) {
            console.error('Sync failed for submission', e);
          }
        }
      })
    );
  }
  if (event.tag === 'sync-attendance') {
    event.waitUntil(Promise.resolve());
  }
});