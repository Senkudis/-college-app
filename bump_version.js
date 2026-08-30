const fs = require('fs');
const path = require('path');

const VERSION = '2.1.0';
const VERSION_CODE = '28';

// package.json
const pkgPath = path.join(__dirname, 'package.json');
let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = VERSION;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');

// build.gradle
const gradlePath = path.join(__dirname, 'android/app/build.gradle');
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle.replace(/versionCode \d+/, `versionCode ${VERSION_CODE}`);
  gradle = gradle.replace(/versionName "[^"]+"/, `versionName "${VERSION}"`);
  fs.writeFileSync(gradlePath, gradle, 'utf8');
}

// index.html splash badge
const indexPath = path.join(__dirname, 'www/index.html');
if (fs.existsSync(indexPath)) {
  let indexHtml = fs.readFileSync(indexPath, 'utf8');
  indexHtml = indexHtml.replace(/v\d+\.\d+\.\d+/g, `v${VERSION}`);
  fs.writeFileSync(indexPath, indexHtml, 'utf8');
}

// sw.js Service Worker
const swPath = path.join(__dirname, 'www/sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  swContent = swContent.replace(/v\d+\.\d+\.\d+/g, `v${VERSION}`);
  fs.writeFileSync(swPath, swContent, 'utf8');
}

console.log(`Version successfully bumped across all components to v${VERSION} (${VERSION_CODE})`);
