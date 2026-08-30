const fs = require('fs');
const path = require('path');
const vm = require('vm');

let totalErrors = 0;
let totalWarnings = 0;

function logError(file, msg) {
  console.error(`❌ [ERROR] ${file}: ${msg}`);
  totalErrors++;
}

function logWarning(file, msg) {
  console.warn(`⚠️ [WARN] ${file}: ${msg}`);
  totalWarnings++;
}

console.log('🔍 Starting UI & Frontend Deep Verification Check...\n');

const wwwDir = path.join(__dirname, '..', 'www');
const jsAppPath = path.join(wwwDir, 'js', 'app.js');

// 1. Read app.js and extract defined CBS functions/properties
let appJsContent = '';
const cbsMethods = new Set();

if (fs.existsSync(jsAppPath)) {
  appJsContent = fs.readFileSync(jsAppPath, 'utf8');

  // Syntax check app.js
  try {
    new vm.Script(appJsContent);
    console.log('✅ www/js/app.js syntax valid.');
  } catch (err) {
    logError('www/js/app.js', `Syntax error: ${err.message}`);
  }

  // Extract CBS.methodName definitions
  const cbsDefMatches = appJsContent.matchAll(/CBS\.([a-zA-Z0-9_$]+)\s*=/g);
  for (const m of cbsDefMatches) {
    cbsMethods.add(m[1]);
  }
  const cbsObjMatches = appJsContent.matchAll(/([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g);
  for (const m of cbsObjMatches) {
    cbsMethods.add(m[1]);
  }
} else {
  logError('www/js/app.js', 'File not found!');
}

// Built-in JS & Browser globals to ignore in handler checks
const builtinGlobals = new Set([
  'alert', 'confirm', 'prompt', 'fetch', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'encodeURIComponent', 'decodeURIComponent',
  'history', 'location', 'console', 'document', 'window', 'event',
  'Math', 'Date', 'JSON', 'String', 'Number', 'Array', 'Object',
  'open', 'close', 'focus', 'blur', 'print', 'stop'
]);

// 2. Scan all HTML files in www/
const htmlFiles = fs.readdirSync(wwwDir).filter(f => f.endsWith('.html'));

console.log(`\n📄 Auditing ${htmlFiles.length} HTML pages in www/ ...\n`);

htmlFiles.forEach(file => {
  const filePath = path.join(wwwDir, file);
  const content = fs.readFileSync(filePath, 'utf8');

  // A. Check external <script src="..."> tags
  const scriptSrcMatches = content.matchAll(/<script[\s\S]*?src=["']([^"']+)["']/gi);
  for (const match of scriptSrcMatches) {
    let src = match[1].trim();
    if (src.startsWith('http') || src.startsWith('//') || src.includes('${')) continue;

    src = src.split('?')[0];
    const relPath = src.startsWith('/') ? src.slice(1) : src;
    const resolvedPath = path.join(wwwDir, relPath);
    if (!fs.existsSync(resolvedPath)) {
      logError(file, `Script src="${match[1]}" not found on disk! (Resolved: ${resolvedPath})`);
    }
  }

  // B. Parse inline <script> tags and check syntax
  const scriptTags = content.matchAll(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi);
  let inlineScriptsCode = '';
  let scriptIndex = 0;

  for (const scriptMatch of scriptTags) {
    scriptIndex++;
    const code = scriptMatch[1];
    if (!code.trim()) continue;
    inlineScriptsCode += '\n' + code;

    try {
      new vm.Script(code);
    } catch (err) {
      logError(file, `Inline script #${scriptIndex} syntax error: ${err.message}`);
    }
  }

  // Combine page inline code + appJsContent for handler lookup
  const pageCombinedCode = appJsContent + '\n' + inlineScriptsCode;

  // C. Check inline event handlers (onclick="foo()", oninput="bar(this.value)", etc.)
  const handlerMatches = content.matchAll(/on([a-z]+)=["']([^"']+)["']/gi);
  for (const match of handlerMatches) {
    const handlerAttr = match[2].trim();
    if (!handlerAttr || handlerAttr.startsWith('javascript:')) continue;

    const funcCalls = handlerAttr.matchAll(/([a-zA-Z0-9_$]+)\s*\(/g);
    for (const fc of funcCalls) {
      const funcName = fc[1];

      if (['if', 'for', 'while', 'switch', 'return', 'typeof', 'delete'].includes(funcName)) continue;
      if (builtinGlobals.has(funcName)) continue;

      const isDefinedInCode = new RegExp(`(?:function\\s+${funcName}|${funcName}\\s*\\(|CBS\\.${funcName}|window\\.${funcName}|let\\s+${funcName}|const\\s+${funcName}|var\\s+${funcName})`).test(pageCombinedCode);

      if (!isDefinedInCode) {
        logError(file, `Event handler 'on${match[1]}' calls undefined function '${funcName}' in expression: "${handlerAttr}"`);
      }
    }
  }

  // D. Check CBS.foo() calls
  const cbsCalls = content.matchAll(/CBS\.([a-zA-Z0-9_$]+)\s*\(/g);
  for (const match of cbsCalls) {
    const methodName = match[1];
    if (!cbsMethods.has(methodName) && !appJsContent.includes(methodName)) {
      logError(file, `Calls undefined CBS method 'CBS.${methodName}()'`);
    }
  }

  // E. Check document.getElementById('someId') references exist in HTML DOM
  const domIds = new Set();
  const idMatches = content.matchAll(/id=["']([a-zA-Z0-9_-]+)["']/g);
  for (const m of idMatches) {
    domIds.add(m[1]);
  }

  const getElementCalls = inlineScriptsCode.matchAll(/document\.getElementById\(["']([a-zA-Z0-9_-]+)["']\)/g);
  for (const m of getElementCalls) {
    const targetId = m[1];
    // Dynamic / global layout elements that exist in app.js or common layout
    const commonGlobalIds = new Set(['toast-container', 'year', 'batchSwitcherSelect', 'bottomNavContainer', 'pdfModal', 'pdfCanvasWrap', 'pdfIframe', 'pdfDownloadBtn', 'globalSearchOverlay', 'globalSearchInput', 'globalSearchResults', 'reportOverlay', 'searchEmptyState', 'subjectTitle']);
    if (!domIds.has(targetId) && !commonGlobalIds.has(targetId)) {
      logWarning(file, `document.getElementById('${targetId}') referenced in script but id="${targetId}" not found in HTML markup!`);
    }
  }

  /* F-0. shared.js يجب أن يُحمّل قبل app.js.
     app.js يفوّض إليه escapeHTML و publicBaseUrl، فنسيانه يعطّل كل الصفحة. */
  const appIdx = content.indexOf('/js/app.js');
  const sharedIdx = content.indexOf('/js/shared.js?');
  if (appIdx !== -1) {
    if (sharedIdx === -1) {
      logError(file, 'يحمّل app.js دون /js/shared.js — سيفشل CBS.escapeHTML و CBS.publicBaseUrl');
    } else if (sharedIdx > appIdx) {
      logError(file, '/js/shared.js يجب أن يسبق /js/app.js في ترتيب التحميل');
    }
  }

  /* F. إدراج بيانات المستخدم داخل HTML بلا هروب.
     أُصلح ~30 موضعاً يدوياً في 2026-07-31، ولا شيء كان يمنع عودتها.

     الدقة تأتي من شرطين معاً، وإلا امتلأ التقرير بإنذارات كاذبة فأُهمل:
       1) الإدراج داخل قالب نصي يحوي وسم HTML فعلياً (يستبعد textContent وconfirm)
       2) التعبير يشير إلى حقل يملؤه المستخدم، وغير ممرَّر على دالة هروب */
  const ESCAPER_CALL = /^(?:[A-Za-z_$][\w$]*\.)?(?:esc[\w$]*|encodeURI|encodeURIComponent|Number|parseInt|parseFloat|String\.raw)\s*\(/i;
  const USER_FIELDS = /\.(name|title|email|message|caption|notes|description|comment|reason|summary|body|subtitle|feedback|location)\b/;

  // القوالب النصية التي تبني HTML: تحوي `<` متبوعاً بحرف (بداية وسم)
  const templates = inlineScriptsCode.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g);
  for (const t of templates) {
    const tpl = t[1];
    if (!/<[a-zA-Z]/.test(tpl)) continue;   // ليس HTML

    for (const m of tpl.matchAll(/\$\{([^{}]*)\}/g)) {
      const expr = m[1].trim();
      if (!expr || !USER_FIELDS.test(expr)) continue;
      if (ESCAPER_CALL.test(expr)) continue;
      // النمط الدفاعي: CBS.escapeHTML ? CBS.escapeHTML(x) : x
      if (/\besc[\w$]*\s*\(/i.test(expr)) continue;
      // نداء دالة مساعدة تبني HTML بنفسها (مثل credRow(...)) — الهروب مسؤوليتها
      if (/^[a-zA-Z_$][\w$]*\s*\(/.test(expr)) continue;
      // شرط ثلاثي يبدأ بمقارنة → القيمة المعروضة ثابتة غالباً
      if (/^[^?]*(===|!==|==|!=)[^?]*\?/.test(expr)) continue;
      if (/^CBS\.(formatDate|formatDateTime|formatTime|roleLabel|roleBadgeClass|getMediaUrl)\s*\(/.test(expr)) continue;

      // خطأ لا تحذير: هذه ثغرة حقن فعلية، ويجب أن تُفشل npm test فوراً
      logError(file, `إدراج غير مهرَّب داخل HTML: \${${expr.slice(0, 60)}} — مرّره على CBS.escapeHTML()`);
    }
  }
});

console.log('\n------------------------------------------------');
if (totalErrors > 0) {
  console.error(`❌ Deep UI Check Failed with ${totalErrors} error(s) and ${totalWarnings} warning(s).`);
  process.exit(1);
} else {
  console.log(`✅ Deep UI & Frontend Verification Passed! (${totalWarnings} warnings)`);
  process.exit(0);
}
