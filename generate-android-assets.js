/**
 * generate-android-assets.js
 * =====================================================
 * ينسخ icon.png و splash.png إلى كل مجلدات الموارد
 * في مشروع Android مع الأسماء والأحجام المطلوبة.
 *
 * ملاحظة: Android Studio سيعيد ضبط الأحجام تلقائياً.
 * الاستخدام: node generate-android-assets.js
 * =====================================================
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = __dirname;
const ANDROID = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ICON    = path.join(ROOT, 'assets', 'icon.png');
const SPLASH  = path.join(ROOT, 'assets', 'splash.png');

// التحقق من وجود الصور
if (!fs.existsSync(ICON))   { console.error('❌ assets/icon.png غير موجود'); process.exit(1); }
if (!fs.existsSync(SPLASH)) { console.error('❌ assets/splash.png غير موجود'); process.exit(1); }
if (!fs.existsSync(ANDROID)) { console.error('❌ مجلد android/ غير موجود — شغّل cap add android أولاً'); process.exit(1); }

// ===== مجلدات الأيقونات في Android =====
// سنضع نفس الصورة في كل المجلدات — Android Studio يتعامل معها
const iconDirs = [
  'mipmap-mdpi',
  'mipmap-hdpi',
  'mipmap-xhdpi',
  'mipmap-xxhdpi',
  'mipmap-xxxhdpi',
];

console.log('🎨 نسخ أيقونة التطبيق...');
iconDirs.forEach(dir => {
  const destDir = path.join(ANDROID, dir);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  // أيقونة عادية
  fs.copyFileSync(ICON, path.join(destDir, 'ic_launcher.png'));
  // أيقونة دائرية (Adaptive icon foreground)
  fs.copyFileSync(ICON, path.join(destDir, 'ic_launcher_round.png'));
  // Foreground للـ adaptive icon
  fs.copyFileSync(ICON, path.join(destDir, 'ic_launcher_foreground.png'));

  console.log(`  ✅ ${dir}/`);
});

// ===== نسخ الأيقونة للـ drawable أيضاً =====
const drawableDir = path.join(ANDROID, 'drawable');
if (!fs.existsSync(drawableDir)) fs.mkdirSync(drawableDir, { recursive: true });

// ===== شاشة الفتح (Splash Screen) =====
console.log('\n🖼️  نسخ شاشة الفتح...');
fs.copyFileSync(SPLASH, path.join(drawableDir, 'splash.png'));
console.log('  ✅ drawable/splash.png');

// نسخ لكل مجلدات drawable
['drawable-land', 'drawable-port', 'drawable-mdpi', 'drawable-hdpi',
 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi'].forEach(dir => {
  const destDir = path.join(ANDROID, dir);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(SPLASH, path.join(destDir, 'splash.png'));
  console.log(`  ✅ ${dir}/splash.png`);
});

// ===== إنشاء ملف colors.xml بلون شاشة الفتح =====
const valuesDir = path.join(ANDROID, 'values');
if (!fs.existsSync(valuesDir)) fs.mkdirSync(valuesDir, { recursive: true });

// تحقق من وجود colors.xml
const colorsPath = path.join(valuesDir, 'colors.xml');
const colorsContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0d3b66</color>
    <color name="splash_background">#0d3b66</color>
</resources>`;

fs.writeFileSync(colorsPath, colorsContent, 'utf8');
console.log('\n🎨 تم إنشاء values/colors.xml');

// ===== تحديث strings.xml باسم التطبيق =====
const stringsPath = path.join(valuesDir, 'strings.xml');
const stringsContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">IT College</string>
    <string name="title_activity_main">IT College</string>
    <string name="package_name">com.elnasrcsit.cbs</string>
    <string name="custom_url_scheme">com.elnasrcsit.cbs</string>
</resources>`;

fs.writeFileSync(stringsPath, stringsContent, 'utf8');
console.log('📝 تم تحديث values/strings.xml (اسم التطبيق: IT College)');

// ===== تحديث ic_launcher_background.xml =====
const backgroundPath = path.join(path.join(ANDROID, 'mipmap-anydpi-v26'), 'ic_launcher_background.xml');
const anydpiDir = path.join(ANDROID, 'mipmap-anydpi-v26');
if (!fs.existsSync(anydpiDir)) fs.mkdirSync(anydpiDir, { recursive: true });

// Adaptive icon لـ Android 8+
const adaptiveIconContent = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>`;

fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveIconContent, 'utf8');
fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveIconContent, 'utf8');
console.log('📐 تم إنشاء Adaptive Icons لـ Android 8+');

console.log('\n✅ تم إنشاء جميع ملفات الأيقونة وشاشة الفتح!');
console.log('');
console.log('📱 الخطوة التالية:');
console.log('   1. افتح Android Studio');
console.log('   2. Build → Clean Project');
console.log('   3. Build → Rebuild Project');
console.log('   4. شغّل التطبيق ✅');
