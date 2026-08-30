const fs = require('fs');

const css = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/css/style.css', 'utf8');
const js  = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js', 'utf8');
const html = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/dashboard.html', 'utf8');
const mob = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/css/mobile.css', 'utf8');
const sw  = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/sw.js', 'utf8');
const ai  = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/routes/ai.routes.js', 'utf8');
const student = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/routes/student.routes.js', 'utf8');
const profile = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/profile.html', 'utf8');
const socket = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/js/socket-client.js', 'utf8');
const notifications = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/notifications.html', 'utf8');
const admin = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/admin_dashboard.html', 'utf8');

const checks = [
  ['1. --primary-gradient in style.css',       css.includes('--primary-gradient')],
  ['2. --glass-filter in style.css',            css.includes('--glass-filter')],
  ['3. @keyframes bannerFlow (Animated Banner)',css.includes('@keyframes bannerFlow')],
  ['4. OLED True Black (#050505) dark mode',   css.includes('050505')],
  ['5. Floating Bottom Nav (border-radius:40px)',css.includes('border-radius: 40px')],
  ['6. New Indigo primary (#4F46E5)',            css.includes('#4F46E5')],
  ['7. Colored shadow on buttons',              css.includes('shadow-colored')],
  ['8. kedyPop animation in app.js',            js.includes('kedyPop')],
  ['9. Glassmorphism in Kedy chat bot bubble',  js.includes('backdrop-filter: blur(12px)')],
  ['10. Inline style removed from welcome-banner', !html.includes('welcome-banner" style=')],
  ['11. Old #bottom-nav flat style removed',   !css.includes('rgba(255,255,255,0.92)')],
  ['12. Old mobile.css bottom-nav padding removed', !mob.includes('padding: 5px 4px')],
  ['13. Spring transitions defined',            css.includes('--transition-spring')],
  ['14. card:hover has scale(1.01)',            css.includes('scale(1.01)')],
  ['15. stat-item:hover has gradient fill',     css.includes('stat-item:hover::before')],
  ['16. Offline banner styles exist',            css.includes('.cbs-offline-banner')],
  ['17. Offline queue event is wired',           js.includes('cbs:offline-queue-changed')],
  ['18. Service Worker cache bumped',            sw.includes("cbs-v2.0.2")],
  ['19. Kedy quiz uses backend correct field',    js.includes('q.correct')],
  ['20. Kedy history is user-scoped',            js.includes('cbs_kedy_chat_history_')],
  ['21. AI content ownership helper exists',     ai.includes('canAccessAISubject')],
  ['22. AI quiz schema normalizer exists',       ai.includes('normalizeQuizItems')],
  ['23. Study plan card exists',                  html.includes('studyPlanCard')],
  ['24. Role health card exists',                html.includes('roleHealthCard')],
  ['25. Kedy voice support exists',               js.includes('_kedySpeak')],
  ['26. Smart alerts are generated',             student.includes('buildStudentSmartAlerts')],
  ['27. Notification sound preference exists',    js.includes('_notificationSoundEnabled') && profile.includes('notificationSoundCheckbox')],
  ['28. Foreground push plays sound',              js.includes('pushNotificationReceived') && js.includes('this.playNotificationSound(isEmergency)')],
  ['29. Android sound channel is versioned',       js.includes("general-v2") && js.includes("emergency-v2")],
  ['30. Socket uses shared sound helper',          socket.includes('CBS.playNotificationSound')],
  ['31. Notification search and category filters',   notifications.includes('notifSearch') && notifications.includes('notifCategory')],
  ['32. Notification grouping exists',               notifications.includes('_notificationGroups') && notifications.includes('notif-group-count')],
  ['33. Notification snooze exists',                 notifications.includes('snoozeGroup') && notifications.includes('snoozedNotifications')],
  ['34. Vibration preference exists',                js.includes('notificationVibration') && profile.includes('notificationVibrationCheckbox')],
  ['35. Notification list is accessible',            notifications.includes('aria-live="polite"') && notifications.includes('role="log"')],
  ['36. Reduced-motion accessibility support',        css.includes('prefers-reduced-motion: reduce')],
  ['37. Notification tab semantics',                  notifications.includes('role="tablist"') && notifications.includes('aria-selected')],
  ['38. Notification loading state is exposed',       notifications.includes('aria-busy') && notifications.includes("setAttribute('aria-busy'")],
  ['39. Connection retry panel exists',                 js.includes('showConnectionError') && js.includes('cbs-retry-btn')],
  ['40. Kedy anonymous feedback exists',                js.includes('_kedyAddFeedbackButtons') && ai.includes("router.post('/feedback'")],
  ['41. Media performance hook exists',                 js.includes('initMediaPerformance') && js.includes("loading', 'lazy'")],
  ['42. Admin observability card exists',                admin.includes('observabilityCard') && admin.includes('/api/admin/observability')],
];

let passed = 0, failed = 0;
for (const [name, result] of checks) {
  const icon = result ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  result ? passed++ : failed++;
}

console.log(`\n--- ${passed}/${checks.length} checks passed ---`);
if (failed === 0) console.log('All UI/UX changes verified successfully!');
else console.log(`WARNING: ${failed} check(s) failed!`);
