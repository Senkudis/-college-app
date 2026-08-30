/**
 * AI Study Assistant Routes — /api/ai
 * يستخدم Gemini REST API مع نظام Key Rotation تلقائي عند 429
 * سلسلة المزودين عند الفشل: Gemini (بكل مفاتيحه) ← Cohere ← Groq (Llama 3)
 */
const router = require('express').Router();
const https  = require('https');
const auth   = require('../middleware/auth.middleware');
const { aiLimiter, aiDailyLimiter } = require('../middleware/rateLimiter');

/* الحدود تُطبَّق بعد auth ليكون req.user.id متاحاً (المفتاح لكل مستخدم لا لكل IP).
   تُوضع على مسارات التوليد المكلِّفة فقط — لا على قراءة/حذف الملاحظات ولا الحالة. */
const aiGuard = [auth, aiDailyLimiter, aiLimiter];

/* =========================================================
   استخراج نص المحاضرة — المصدر الوحيد لكل مسارات السياق
   =========================================================
   العطل الذي كان يجعل كيدي يعتذر عن "عدم رؤية الملفات": ملفات المحاضرات
   يحفظها multer في uploads/lectures/ ويُخزَّن الاسم المجرّد في
   lecture.file، بينما كان أحد المسارات يبحث في uploads/<الاسم> فقط فلا
   يجد شيئاً أبداً. نجمع كل المسارات المحتملة في مكان واحد، ونتعامل مع
   الملفات النصية أيضاً لا الـPDF وحده. */
const AI_TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.html', '.xml'];

function resolveUploadPath(fileField) {
  if (!fileField) return null;
  const fs = require('fs');
  const path = require('path');
  const base = path.basename(String(fileField));
  const candidates = [
    path.join(__dirname, '..', 'uploads', 'lectures', base),
    path.join(__dirname, '..', 'uploads', String(fileField)),
    path.join(__dirname, '..', 'uploads', 'references', base),
    path.join(__dirname, '..', 'uploads', 'past-exams', base),
    path.join(__dirname, '..', 'uploads', 'misc', base)
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

async function extractLectureText(lecture) {
  if (lecture.extractedText && lecture.extractedText.length > 50) return lecture.extractedText;
  if (!lecture.file) return '';

  const fs = require('fs');
  const path = require('path');
  const ext = path.extname(lecture.file).toLowerCase();
  const isPdf = ext === '.pdf';
  const isText = AI_TEXT_EXTENSIONS.includes(ext);
  if (!isPdf && !isText) return '';

  try {
    const filePath = resolveUploadPath(lecture.file);
    if (!filePath) {
      console.warn(`[AI] ملف المحاضرة غير موجود على القرص: ${lecture.file} (${lecture.title})`);
      return '';
    }

    let text = '';
    if (isPdf) {
      const { extractPdfText, MAX_CHARS } = require('../utils/pdfText');
      text = await extractPdfText(fs.readFileSync(filePath));
      if (!text) console.warn(`[AI] PDF بلا نص قابل للاستخراج (صور ممسوحة؟): ${lecture.title}`);
      void MAX_CHARS;
    } else {
      text = fs.readFileSync(filePath, 'utf8').replace(/\s+/g, ' ').trim().slice(0, 150000);
    }

    if (text && lecture._id) {
      const Lecture = require('../models/Lecture');
      await Lecture.findByIdAndUpdate(lecture._id, { extractedText: text });
      console.log(`[AI] استُخرج ${text.length} حرف من: ${lecture.title}`);
    }
    return text;
  } catch (e) {
    console.warn(`[AI] فشل استخراج نص (${lecture.title}):`, e.message);
    return '';
  }
}

// =========================================================
// ===== إعداد مجمع مفاتيح Gemini =====
// =========================================================
/* يستخرج نصاً مفهوماً من جسم خطأ أي مزوّد. بدونه كان تمرير كائن إلى
   new Error() يطبع "[object Object]" في السجل — وهو ما أخفى سبب فشل
   Cohere في سجلات الإنتاج. */
function describeApiError(json, fallback) {
  const pick = v => {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return v.message || v.detail || v.reason || JSON.stringify(v).slice(0, 300);
    return String(v);
  };
  return pick(json?.error?.message) || pick(json?.error) || pick(json?.message) || fallback;
}

const _rawGeminiKeys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean);

const _geminiKeyPool = _rawGeminiKeys.map(key => ({
  key,
  blockedUntil: 0,
  requestCount: 0,
}));

let _rrIdx = 0;

function getAvailableGeminiKey() {
  const now = Date.now();
  const available = _geminiKeyPool.filter(k => k.blockedUntil <= now);
  if (available.length > 0) {
    _rrIdx = (_rrIdx + 1) % available.length;
    return available[_rrIdx];
  }
  // كل المفاتيح محظورة — ارجع الأقرب للانتهاء
  return _geminiKeyPool.slice().sort((a, b) => a.blockedUntil - b.blockedUntil)[0];
}

function blockGeminiKey(keyObj, ms = 65_000) {
  keyObj.blockedUntil = Date.now() + ms;
  console.warn(`[AI]  مفتاح Gemini ...${keyObj.key.slice(-6)} محظور ${Math.round(ms/1000)}ث`);
}

// =========================================================
// ===== محرك Gemini =====
// =========================================================
const GEMINI_MODEL = 'gemini-flash-latest';

function geminiRequest(apiKey, prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        // الحرارة والطول يحددهما نوع الطلب: الأسئلة المباشرة تحتاج ردوداً قصيرة
        // ودقيقة، والشرح الأكاديمي يحتاج مساحة أكبر. القيمة الثابتة 8192 كانت
        // تجعل كل إجابة مقالاً مطولاً حتى لسؤال «كم مادة عندي؟».
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxOutputTokens ?? 2048,
        topP: 0.9
      }
    });

    const reqOpts = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${GEMINI_MODEL}:generateContent`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(reqOpts, res => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            const err = new Error(describeApiError(json, 'Gemini API error'));
            err.status = json.error.code;
            err.isRateLimit = json.error.code === 429
              || (json.error.message || '').toLowerCase().includes('quota')
              || (json.error.message || '').toLowerCase().includes('exhausted');
            const retryMatch = (json.error.message || '').match(/retry in ([\d.]+)s/i);
            err.retryAfterMs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) * 1000 : 65_000;
            return reject(err);
          }
          const candidate = json?.candidates?.[0];
          const finish = candidate?.finishReason;

          // الرد قد يأتي في أجزاء متعددة؛ أخذ الجزء الأول فقط كان يبتر الإجابة
          let text = (candidate?.content?.parts || [])
            .map(part => part?.text || '').join('').trim();

          if (!text) {
            // نموذج التفكير قد يستهلك كامل الميزانية قبل كتابة أي حرف فيعود بنص فارغ.
            // نميّز الحالة برسالة خاصة كي تتحول للخطة الاحتياطية بدل خطأ غامض.
            const emptyErr = new Error(
              finish === 'MAX_TOKENS' ? 'MODEL_BUDGET_EXHAUSTED'
              : finish === 'SAFETY'   ? 'MODEL_SAFETY_BLOCK'
              : 'لم يتم إرجاع أي رد من النموذج');
            emptyErr.finishReason = finish;
            emptyErr.isBudgetExhausted = finish === 'MAX_TOKENS';
            return reject(emptyErr);
          }

          text = text.replace(/[�￾￿]/g, '');

          // رد مبتور في منتصف الجملة: ننبّه الطالب بدل إيهامه بأن الإجابة اكتملت
          if (finish === 'MAX_TOKENS') {
            console.warn('[AI] رد مبتور (MAX_TOKENS) — راجع ميزانية التوكنات');
            text += '\n\n(اختصرتُ الإجابة لبلوغ الحد الأقصى — اسألني عن أي جزء تريد تفصيله.)';
          }

          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function geminiWithFallback(prompt, opts = {}) {
  if (_geminiKeyPool.length === 0) throw new Error('RATE_LIMIT_ALL_KEYS');

  const tried = new Set();
  const maxTries = _geminiKeyPool.length + 1;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    const keyObj = getAvailableGeminiKey();
    if (tried.has(keyObj.key) && tried.size < _geminiKeyPool.length) continue;
    tried.add(keyObj.key);

    try {
      keyObj.requestCount++;
      const text = await geminiRequest(keyObj.key, prompt, opts);
      return text;
    } catch (err) {
      if (err.isRateLimit) {
        blockGeminiKey(keyObj, err.retryAfterMs || 65_000);
        if (tried.size >= _geminiKeyPool.length) throw new Error('RATE_LIMIT_ALL_KEYS');
        console.log(`[AI]  تحويل لمفتاح Gemini آخر... (${attempt + 2}/${maxTries})`);
        continue;
      }
      throw err;
    }
  }
  throw new Error('RATE_LIMIT_ALL_KEYS');
}

// =========================================================
// ===== الخطة الاحتياطية (Cohere) =====
// =========================================================
// command-a-03-2025: أقوى نماذج Cohere المتاحة (100K context وذكاء عالي)
const COHERE_MODEL = 'command-a-03-2025';

/* مفاتيح Cohere ليست متكافئة: المفتاح الأول إنتاجي بلا حدود تجريبية،
   وما بعده قد يكون مفتاح trial (1000 طلب شهرياً و20 في الدقيقة). لذلك
   نستخدمها بالأولوية لا بالتناوب — الأول دائماً، والتالي فقط إذا تعطّل
   الأول — حتى لا نستنزف الحصة التجريبية الصغيرة بلا داعٍ. */
const _cohereKeys = [
  process.env.COHERE_API_KEY,
  process.env.COHERE_API_KEY_2,
  process.env.COHERE_API_KEY_3,
].filter(Boolean).map(key => ({ key, blockedUntil: 0 }));

function getAvailableCohereKey() {
  const now = Date.now();
  return _cohereKeys.find(k => k.blockedUntil <= now) || _cohereKeys[0] || null;
}

function cohereRequest(systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const keyEntry = getAvailableCohereKey();
    if (!keyEntry) return reject(new Error('NO_COHERE_KEY'));
    const cohereKey = keyEntry.key;

    console.log(`[AI]  تفعيل الخطة الاحتياطية (Cohere ${COHERE_MODEL})...`);
    const body = JSON.stringify({
      model: COHERE_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxOutputTokens ?? 2048
    });

    const reqOpts = {
      hostname: 'api.cohere.com',
      path: '/v2/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cohereKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(reqOpts, res => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400 || json.message || json.error) {
            // 429 تجاوز الحصة و402 حساب موقوف للدفع: نُنحّي المفتاح ونترك
            // الدور للتالي بدل تكرار الفشل على نفس المفتاح
            if (res.statusCode === 429) keyEntry.blockedUntil = Date.now() + 60 * 60 * 1000;
            if (res.statusCode === 402) keyEntry.blockedUntil = Date.now() + 24 * 60 * 60 * 1000;
            // Cohere قد يُرجع message أو error ككائن لا كنص، وتمريره إلى Error
            // ينتج "[object Object]" فيضيع سبب العطل الحقيقي من السجل
            const err = new Error(describeApiError(json, `Cohere API error ${res.statusCode}`));
            err.status = res.statusCode;
            err.isRateLimit = res.statusCode === 429;
            return reject(err);
          }
          // v2 API: الرد يأتي في message.content[0].text
          let text = '';
          const content = json.message?.content;
          if (Array.isArray(content)) {
            text = content.map(c => c.text || '').join('').trim();
          } else {
            text = (json.text || '').trim();
          }
          if (!text) return reject(new Error('لم يتم إرجاع أي رد من نموذج Cohere'));
          const finishReason = json.finish_reason || json.message?.stop_reason;
          if (finishReason === 'MAX_TOKENS') {
            console.warn('[AI/Cohere] رد مبتور (MAX_TOKENS)');
            text += '\n\n(اختصرتُ الإجابة لبلوغ الحد الأقصى — اسألني عن أي جزء تريد تفصيله.)';
          }
          text = text.replace(/[\uFFFD\uFFFE\uFFFF]/g, '');
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// =========================================================
// ===== الخطة الاحتياطية الأخيرة (Groq) =====
// =========================================================
// llama-3.3-70b-versatile سُحب من Groq وصار يرجع 404 model_not_found،
// فكانت الخطة الاحتياطية الأخيرة معطّلة بالكامل. البديل مُختبَر بالعربية.
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

/* مجمّع مفاتيح Groq: كل مفتاح مجاني يعطي ~1000 طلب يومياً، والتناوب
   بينها يضاعف الحصة بدل أن يتوقف كيدي عند نفاد الأول — نفس أسلوب
   مجمّع مفاتيح Gemini أعلاه. */
const _groqKeys = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean).map(key => ({ key, blockedUntil: 0 }));

let _groqIdx = 0;

function getAvailableGroqKey() {
  const now = Date.now();
  const free = _groqKeys.filter(k => k.blockedUntil <= now);
  const pool = free.length ? free : _groqKeys;
  if (!pool.length) return null;
  _groqIdx = (_groqIdx + 1) % pool.length;
  return pool[_groqIdx];
}

function groqRequest(systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const keyEntry = getAvailableGroqKey();
    if (!keyEntry) return reject(new Error('NO_GROQ_KEY'));
    const groqKey = keyEntry.key;

    console.log(`[AI]  تفعيل الخطة الاحتياطية الأخيرة (Groq - ${GROQ_MODEL})...`);
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxOutputTokens ?? 2048
    });

    const optsReq = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(optsReq, res => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400 || json.error) {
            // 429 = استُنفدت حصة هذا المفتاح، نوقفه ساعة ليأخذ غيره الدور
            if (res.statusCode === 429) keyEntry.blockedUntil = Date.now() + 60 * 60 * 1000;
            const err = new Error(describeApiError(json, 'Groq API error'));
            err.status = res.statusCode;
            err.isRateLimit = res.statusCode === 429;
            return reject(err);
          }
          let text = (json.choices?.[0]?.message?.content || '').trim();
          if (!text) return reject(new Error('لم يتم إرجاع أي رد من نموذج Groq'));
          if (json.choices?.[0]?.finish_reason === 'length') {
            console.warn('[AI/Groq] رد مبتور (MAX_TOKENS)');
            text += '\n\n(اختصرتُ الإجابة لبلوغ الحد الأقصى — اسألني عن أي جزء تريد تفصيله.)';
          }
          text = text.replace(/[\uFFFD\uFFFE\uFFFF]/g, '');
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// =========================================================
// ===== مزوّد Qwen (Alibaba Model Studio) =====
// =========================================================
/* نافذة سياق Qwen كبيرة جداً (حتى ~١٣١ ألف رمز في qwen-plus)، وهي أنسب
   مزوّد لدينا لسؤال "لخّص لي هذه المادة" حيث يصل السياق إلى ٦٠ ألف حرف.
   الواجهة متوافقة مع OpenAI فتتبع نفس نمط Groq تماماً.

   المضيف والمفتاح من البيئة لا من الكود: كل مساحة عمل في Model Studio
   لها نطاق خاص بها (ws-xxxx.<region>.maas.aliyuncs.com). */
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-plus';
const QWEN_HOST = (process.env.QWEN_API_HOST || 'dashscope-intl.aliyuncs.com')
  .replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '');
const QWEN_PATH = process.env.QWEN_API_PATH || '/compatible-mode/v1/chat/completions';

const _qwenKeys = [
  process.env.QWEN_API_KEY,
  process.env.QWEN_API_KEY_2,
  process.env.QWEN_API_KEY_3,
].filter(Boolean).map(key => ({ key, blockedUntil: 0 }));

let _qwenIdx = 0;

function getAvailableQwenKey() {
  const now = Date.now();
  const free = _qwenKeys.filter(k => k.blockedUntil <= now);
  const pool = free.length ? free : _qwenKeys;
  if (!pool.length) return null;
  _qwenIdx = (_qwenIdx + 1) % pool.length;
  return pool[_qwenIdx];
}

function qwenRequest(systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const keyEntry = getAvailableQwenKey();
    if (!keyEntry) return reject(new Error('NO_QWEN_KEY'));

    console.log(`[AI]  استدعاء Qwen (${QWEN_MODEL}) عبر ${QWEN_HOST}...`);
    const body = JSON.stringify({
      model: QWEN_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxOutputTokens ?? 2048
    });

    const request = https.request({
      hostname: QWEN_HOST,
      path: QWEN_PATH,
      method: 'POST',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keyEntry.key}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400 || json.error) {
            // 429 = استُنفدت حصة هذا المفتاح، نوقفه ساعة ليأخذ غيره الدور
            if (res.statusCode === 429) keyEntry.blockedUntil = Date.now() + 60 * 60 * 1000;
            const err = new Error(describeApiError(json, 'Qwen API error'));
            err.status = res.statusCode;
            err.isRateLimit = res.statusCode === 429;
            return reject(err);
          }
          let text = (json.choices?.[0]?.message?.content || '').trim();
          if (!text) return reject(new Error('لم يتم إرجاع أي رد من نموذج Qwen'));
          if (json.choices?.[0]?.finish_reason === 'length') {
            console.warn('[AI/Qwen] رد مبتور (MAX_TOKENS)');
            text += '\n\n(اختصرتُ الإجابة لبلوغ الحد الأقصى — اسألني عن أي جزء تريد تفصيله.)';
          }
          resolve(text.replace(/[�￾￿]/g, ''));
        } catch (e) {
          reject(new Error(`تعذّر تحليل رد Qwen: ${e.message}`));
        }
      });
    });

    request.on('timeout', () => { request.destroy(new Error('انتهت مهلة Qwen')); });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

/**
 * النظام الذكي المدمج (Gemini بكل مفاتيحه ← Qwen ← Cohere ← Groq)
 *
 * كان التحويل إلى Cohere مشروطاً بـ RATE_LIMIT_ALL_KEYS وحدها، فأي عطل آخر في
 * Gemini (انقطاع شبكة، خطأ 500 من جوجل، رد فارغ، استنفاد ميزانية التفكير)
 * كان يصل للطالب كرسالة خطأ رغم توفر مزود احتياطي جاهز. الآن كل أعطال
 * Gemini تُجرَّب على Cohere قبل الاستسلام. وإذا فشل Cohere يتم استخدام Groq كملاذ أخير.
 */
const GEMINI_FAILURES_WORTH_FALLBACK = new Set([
  'RATE_LIMIT_ALL_KEYS',
  'MODEL_BUDGET_EXHAUSTED',
  'لم يتم إرجاع أي رد من النموذج'
]);

async function askAIWithUltimateFallback(prompt, opts = {}) {
  try {
    // 1. جرب مجمع مفاتيح Gemini أولاً
    return await geminiWithFallback(prompt, opts);
  } catch (err) {
    // حجب المحتوى لأسباب أمان ليس عطلاً — إعادة المحاولة على مزود آخر لن تفيد
    if (err.message === 'MODEL_SAFETY_BLOCK') throw err;

    const shouldFallback = GEMINI_FAILURES_WORTH_FALLBACK.has(err.message)
      || err.isRateLimit
      || err.status >= 500
      || err.code === 'ECONNRESET'
      || err.code === 'ETIMEDOUT'
      || err.code === 'ENOTFOUND';

    /* نستخرج الـ SYSTEM_PROMPT من الـ prompt الكامل لنمرره كـ system role
       مستقل في Cohere/Groq — هذا يضمن أن شخصية كيدي وقواعده تُطبَّق بشكل
       متطابق بغض النظر عن المزود المستخدم */
    const sysMarker = SYSTEM_PROMPT;
    const userPart = prompt.startsWith(sysMarker)
      ? prompt.slice(sysMarker.length).trimStart()
      : prompt;

    /* 2. الخطة الاحتياطية الأولى: Qwen.
       يسبق Cohere لأن نافذة سياقه أوسع بكثير — وهذا يهم تحديداً في
       "لخّص المادة" حيث يبلغ السياق ٦٠ ألف حرف، وهو ما كان يتجاوز حدود
       المزوّدَين التاليَين فيصل الطالب ردٌّ مبتور أو خطأ. */
    if (shouldFallback && _qwenKeys.length) {
      console.warn(`[AI] تحويل إلى Qwen بعد فشل Gemini: ${err.message}`);
      try {
        return await qwenRequest(sysMarker, userPart, opts);
      } catch (qwenErr) {
        console.error('[AI/Qwen Fallback Error]', qwenErr.message);
        // استمر إلى المزوّد التالي
      }
    }

    // 3. الخطة الاحتياطية الثانية: Cohere
    if (shouldFallback && process.env.COHERE_API_KEY) {
      console.warn(`[AI] تحويل إلى Cohere بعد فشل Gemini: ${err.message}`);
      try {
        return await cohereRequest(sysMarker, userPart, opts);
      } catch (cohereErr) {
        console.error('[AI/Cohere Fallback Error]', cohereErr.message);
        // استمر إلى الخطة البديلة التالية (Groq)
      }
    }

    // 4. الخطة الاحتياطية الأخيرة: Groq
    if (shouldFallback && process.env.GROQ_API_KEY) {
      console.warn(`[AI] تحويل إلى Groq كملاذ أخير...`);
      try {
        return await groqRequest(sysMarker, userPart, opts);
      } catch (groqErr) {
        console.error('[AI/Groq Fallback Error]', groqErr.message);
        throw new Error('ALL_AI_SYSTEMS_DOWN');
      }
    }

    // لا مزود احتياطي متاح — ارمِ الخطأ الأصلي
    throw err;
  }
}

// =========================================================
// ===== أدوات المساعدة والسياق الحي من قاعدة البيانات =====
// =========================================================
/* السياق يُبنى من 6 استعلامات؛ بناؤه في كل رسالة يثقل القاعدة بلا داعٍ.
   نخزّنه لكل مستخدم لمدة قصيرة — كافية لجلسة محادثة، وقصيرة بما يكفي
   لئلا يتأخر ظهور واجب أو إشعار جديد. */
const _ctxCache = new Map();
// رفعنا TTL من 60ث إلى 5 دقائق — السياق لا يتغيّر خلال جلسة واحدة وهذا يخفّض طلبات Gemini بشكل كبير
const CTX_TTL_MS = 5 * 60_000; // 5 دقائق

// حماية من الإرسال المتكرر بسرعة: منع طالب واحد من إرسال أكثر من 5 طلبات في 10 ثوان
const _userThrottle = new Map();
const THROTTLE_MAX  = 5;       // أقصى طلبات
const THROTTLE_WIN  = 10_000;  // نافذة 10 ثوان
function isThrottled(userId) {
  const now = Date.now();
  const rec = _userThrottle.get(userId) || { count: 0, reset: now + THROTTLE_WIN };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + THROTTLE_WIN; }
  rec.count++;
  _userThrottle.set(userId, rec);
  return rec.count > THROTTLE_MAX;
}

function _ctxCacheGet(key) {
  const hit = _ctxCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) _ctxCache.delete(key);
  return null;
}
function _ctxCacheSet(key, value) {
  if (_ctxCache.size > 500) _ctxCache.clear();
  _ctxCache.set(key, { value, expires: Date.now() + CTX_TTL_MS });
}

function fmtDateAr(d) {
  if (!d) return 'غير محدد';
  try {
    return new Date(d).toLocaleDateString('ar-EG-u-nu-latn', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch { return 'غير محدد'; }
}

function daysFromNow(d) {
  const diff = new Date(d).getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (days < 0) return 'انتهى';
  if (days === 0) return 'اليوم';
  if (days === 1) return 'غداً';
  return `بعد ${days} يوم`;
}

async function getLiveStudentContext(userId, activeBatch) {
  const cacheKey = `${userId}:${activeBatch || '-'}`;
  const cached = _ctxCacheGet(cacheKey);
  if (cached !== null) return cached;

  try {
    const User = require('../models/User');
    const Subject = require('../models/Subject');
    const Assignment = require('../models/Assignment');
    const PublicNews = require('../models/PublicNews');
    const Notification = require('../models/Notification');
    const Quiz = require('../models/Quiz');

    const user = await User.findById(userId).select('name roles batch batches').populate('batch', 'name').lean();
    if (!user) return '';

    const batchId = activeBatch || user.batch?._id || user.batch || (user.batches && user.batches[0]);

    let subjects = [];
    if (batchId) {
      subjects = await Subject.find({ $or: [{ batch: batchId }, { batches: batchId }] }).select('name level _id').lean();
    }
    if (!subjects.length) {
      subjects = await Subject.find({}).select('name level _id').limit(15).lean();
    }

    const subjectList = subjects.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    let openAssignments = [];
    let upcomingQuizzes = [];
    let leaders = [];

    if (batchId) {
      // التفاصيل الفعلية للواجبات وليس عددها فقط — بدونها كان المساعد
      // عاجزاً عن الإجابة على «متى تسليم الواجب؟» رغم امتلاك النظام للبيانات.
      openAssignments = await Assignment.find({
        batches: batchId,
        dueDate: { $gte: new Date() }
      }).select('title dueDate dueTime subject').populate('subject', 'name')
        .sort({ dueDate: 1 }).limit(8).lean();

      upcomingQuizzes = await Quiz.find({
        batch: batchId,
        published: true,
        endsAt: { $gte: new Date() }
      }).select('title startsAt endsAt durationMinutes subject').populate('subject', 'name')
        .sort({ startsAt: 1 }).limit(5).lean();

      leaders = await User.find({
        roles: 'leader',
        $or: [{ batch: batchId }, { batches: batchId }]
      }).select('name').lean();
    }

    const leadersNames = leaders.length > 0 ? leaders.map(l => l.name).join(' و ') : 'غير محدد';

    const assignmentsList = openAssignments.length
      ? openAssignments.map(a =>
          `- «${a.title}» (مادة ${a.subject?.name || 'غير محددة'}) — التسليم ${fmtDateAr(a.dueDate)} الساعة ${a.dueTime || '23:59'} [${daysFromNow(a.dueDate)}]`
        ).join('\n')
      : 'لا توجد واجبات مفتوحة حالياً';

    const quizzesList = upcomingQuizzes.length
      ? upcomingQuizzes.map(qz =>
          `- «${qz.title}» (مادة ${qz.subject?.name || 'غير محددة'}) — يبدأ ${fmtDateAr(qz.startsAt)} وينتهي ${fmtDateAr(qz.endsAt)}، المدة ${qz.durationMinutes} دقيقة [${daysFromNow(qz.startsAt)}]`
        ).join('\n')
      : 'لا توجد اختبارات معلنة حالياً';

    // isPublished مطلوب: بدونه كانت مسوّدات الأخبار غير المنشورة تتسرب للطلاب عبر المساعد.
    // والحقل هو summary/body — لم يكن هناك حقل اسمه content إطلاقاً، فكان نص كل خبر فارغاً.
    const latestNews = await PublicNews.find({ isPublished: true })
      .sort({ publishedAt: -1, createdAt: -1 }).limit(5)
      .select('title summary body publishedAt createdAt').lean();
    const newsList = latestNews.length
      ? latestNews.map(n => {
          const text = (n.summary || n.body || '').replace(/\s+/g, ' ').trim();
          return `- «${n.title}» (${fmtDateAr(n.publishedAt || n.createdAt)}): ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`;
        }).join('\n')
      : 'لا توجد أخبار منشورة';

    // جلب الفعاليات الأكاديمية القادمة
    let eventsList = 'لا توجد فعاليات معلنة قريباً';
    try {
      const AcademicEvent = require('../models/AcademicEvent');
      const upcomingEvents = await AcademicEvent.find({
        $or: [{ batch: batchId }, { batch: null }],
        date: { $gte: new Date() }
      }).sort({ date: 1 }).limit(4).lean();
      if (upcomingEvents.length > 0) {
        eventsList = upcomingEvents.map(ev => `- «${ev.title}» (${fmtDateAr(ev.date)}): ${ev.description || 'فعالية أكاديمية'}`).join('\n');
      }
    } catch (eve) {}

    // جلب الملخص المالي للطالب
    let financeSummary = 'لا توجد مستحقات مالية مسجلة';
    try {
      const Fee = require('../models/Fee');
      const Payment = require('../models/Payment');
      const fees = await Fee.find({ $or: [{ batch: batchId }, { student: userId }] }).lean();
      if (fees.length > 0) {
        const totalFees = fees.reduce((sum, f) => sum + (f.amount || 0), 0);
        const payments = await Payment.find({ student: userId, status: 'approved' }).lean();
        const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const remaining = totalFees - totalPaid;
        financeSummary = `إجمالي الرسوم: ${totalFees} ج.س | المسدد: ${totalPaid} ج.س | المتبقي المطلوب: ${remaining > 0 ? remaining + ' ج.س' : 'خالص السداد بالكامل ✅'}`;
      }
    } catch (fe) {}

    // جلب مجموعات المذاكرة النشطة
    let studyPodsList = 'لا توجد مجموعات مذاكرة نشطة حالياً';
    try {
      const StudyPod = require('../models/StudyPod');
      const pods = await StudyPod.find({ batch: batchId, status: 'active' }).select('name topic').limit(3).lean();
      if (pods.length > 0) {
        studyPodsList = pods.map(p => `- مجموعة «${p.name}»: (${p.topic || 'مذاكرة عامة'})`).join('\n');
      }
    } catch (sde) {}

    // تصفية الإشعارات بناءً على رؤية الطالب
    const notifQuery = Notification.buildVisibilityQuery ? Notification.buildVisibilityQuery(userId, user.roles, user.batch?._id || user.batch, user.batches) : {};
    const recentNotifs = await Notification.find(notifQuery).sort({ createdAt: -1 }).limit(5).select('title message type createdAt').lean();
    const notifsList = recentNotifs.length
      ? recentNotifs.map(n =>
          `- ${n.type === 'emergency' ? '[عاجل] ' : ''}«${n.title}» (${fmtDateAr(n.createdAt)}): ${(n.message || '').replace(/\s+/g, ' ').slice(0, 200)}`
        ).join('\n')
      : 'لا توجد إشعارات حديثة';

    const context = `
════════ سياق التطبيق الحي (من قاعدة بيانات النظام — مصدرك الوحيد للحقائق) ════════

[التاريخ] اليوم هو ${fmtDateAr(new Date())}. احسب كل المدد والمواعيد المتبقية من هذا التاريخ.

[الطالب]
- الاسم: ${user.name || 'طالب'}
- الدفعة: ${user.batch?.name || 'غير محددة'}
- ليدر/مندوب الدفعة: ${leadersNames}

[المواد المسجّلة] العدد: ${subjects.length}
${subjectList || 'لا توجد مواد مرفوعة'}

[الواجبات المفتوحة للتسليم]
${assignmentsList}

[الاختبارات والكويزات القادمة]
${quizzesList}

[الفعاليات والتقويم الأكاديمي]
${eventsList}

[الوضع المالي والأقساط]
${financeSummary}

[مجموعات المذاكرة النشطة]
${studyPodsList}

[أحدث أخبار الكلية]
${newsList}

[أحدث الإشعارات]
${notifsList}

[دليل خدمات وأقسام المنصة التي يرشد إليها كيدي]
1. 💻 مختبر ومحرر الأكواد (Code Lab): لتجربة وتشغيل وكتابة أكواد C++, Python, JS وتصحيحها وفحص التعقيد الزمني والمكاني (/code-lab.html).
2. 📇 بطاقات الاستذكار الذكية (Flashcards): لتوليد بطاقات مراجعة ومراجعة المفاهيم بالذاكرة التكرارية (/flashcards.html).
3. 📝 بنك الامتحانات والمحاكاة: حل امتحانات سابقة مع التقييم الفوري وتشخيص كيدي للأخطاء (/past-exams.html).
4. 👥 غرف المذاكرة الجماعية (Study Pods): غرف دراسية تفاعلية ومشاركة الشروحات (/study-pods.html).
5. 📊 كويزات المقررات (Quizzes): اختبارات تفاعلية فورية (/quizzes.html).
6. 📈 لوحة الصدارة والمتصدرين: الترتيب الأكاديمي ونقاط التفاعل (/leaderboard.html).
7. 🎓 ملف الإنجاز الأكاديمي: السجل الأكاديمي والشهادات والمشاريع (/student-portfolio.html).
8. 🎥 مكتبة الفيديو: المحاضرات المرئية والشروحات المسجلة (/video-library.html).
9. 📅 جدول المحاضرات والتقويم الأكاديمي: مواعيد المحاضرات والفعاليات (/calendar.html).
10. 💰 السجل المالي والمستحقات: كشف الرسوم والأقساط والإيصالات (/financials.html).
11. 📋 استطلاعات الرأي وتقييم المقررات (/course-surveys.html).
12. 📝 الملاحظات المحفوظة: حفظ وتخزين ملخصات كيدي للرجوع إليها لاحقاً.

[معلومات النظام] الموقع: https://elnasrcsit.website · المطور: المهندس ضياء الدين (0112046348 | diaakardmash@gmail.com)
════════════════════════════════════════════════════════════════════════════════
`;
    _ctxCacheSet(cacheKey, context);
    return context;
  } catch (e) {
    console.warn('[AI/context]', e.message);
    return '';
  }
}

function errMsg(err, fallback) {
  if (err?.message === 'RATE_LIMIT_ALL_KEYS' || err?.message === 'ALL_AI_SYSTEMS_DOWN') {
    return 'السيرفر يواجه ضغطاً كبيراً، يرجى المحاولة بعد دقيقة';
  }
  return fallback;
}

function cleanJson(raw) {
  // السياج قد يسبقه كلام تمهيدي من النموذج، فلا يكفي قصّه من الطرفين فقط
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  return body.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
}

/* النماذج تسبق الـ JSON أحياناً بجملة تمهيدية رغم التعليمات، فيفشل JSON.parse
   ويتحول الأمر إلى خطأ 500 أمام الطالب. نستخرج أول مصفوفة صالحة بدل الفشل. */
function parseJsonArray(raw) {
  const cleaned = cleanJson(raw);
  try {
    const direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) return direct;
    // بعض النماذج تلفّ المصفوفة في كائن: {"cards":[...]} أو {"questions":[...]}
    if (direct && typeof direct === 'object') {
      const inner = Object.values(direct).find(Array.isArray);
      if (inner) return inner;
    }
  } catch { /* نجرّب الاستخراج أدناه */ }

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end > start) {
    const slice = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(slice); // إن فشل هنا فالناتج تالف فعلاً
    if (Array.isArray(parsed)) return parsed;
  }
  throw new Error('Invalid format');
}

// موجّه مصغّر لمسارات JSON: موجّه النظام الكامل يطلب عناوين ونثراً عربياً،
// فكان يدفع النموذج لإضافة نص خارج الـ JSON ويكسر التحليل.
const JSON_SYSTEM_PROMPT = `أنت "كيدي"، مساعد أكاديمي لطلاب كلية النصر التقنية — جامعة النصر التقنية.
في هذه المهمة تُخرج JSON خالصاً فقط: لا تمهيد، لا شرح، لا تعليق، ولا أسوار أكواد.
المحتوى بالعربية الفصيحة المبسطة، بلا رموز تعبيرية (emoji)، والمصطلحات التقنية بالإنجليزية بين قوسين.`;

// =========================================================
// GET /api/ai/status (للمشرف)
// =========================================================
router.get('/status', auth, (req, res) => {
  if (!['dean','admin'].some(r => req.user?.roles?.includes(r))) {
    return res.status(403).json({ success: false });
  }
  const now = Date.now();
  res.json({
    success: true,
    geminiKeys: _geminiKeyPool.map(k => ({
      suffix: '...' + k.key.slice(-6),
      available: k.blockedUntil <= now,
      blockedForSeconds: k.blockedUntil > now ? Math.round((k.blockedUntil - now) / 1000) : 0,
      requestCount: k.requestCount
    })),
    // سلسلة الاحتياط الكاملة بالترتيب — كان التقرير يذكر Cohere فقط ويتجاهل Groq
    fallbackAvailable: !!(_qwenKeys.length || process.env.COHERE_API_KEY || process.env.GROQ_API_KEY),
    fallbackChain: [
      { provider: 'qwen',   model: QWEN_MODEL,   configured: _qwenKeys.length > 0,   keysConfigured: _qwenKeys.length, host: QWEN_HOST },
      { provider: 'cohere', model: COHERE_MODEL, configured: _cohereKeys.length > 0, keysConfigured: _cohereKeys.length },
      { provider: 'groq',   model: GROQ_MODEL,   configured: _groqKeys.length > 0, keysConfigured: _groqKeys.length }
    ],
    primary: { provider: 'gemini', model: GEMINI_MODEL, keysConfigured: _geminiKeyPool.length }
  });
});

const SYSTEM_PROMPT = `أنت "كيدي" (Kedy)، المستشار والمساعد الأكاديمي والتقني الذكي لطلاب كلية النصر التقنية — جامعة النصر التقنية.
طوّرك المهندس ضياء الدين (0112046348 | diaakardmash@gmail.com). لا تذكر بيانات المطور إلا إذا سُئلت عنها صراحة.

════  الهوية والتخصص الأكاديمي والتقني ════
• أنت خبير أكاديمي ومرشد ذكي شامل في علوم الحاسوب وهندسة البرمجيات وتقنية المعلومات (هياكل البيانات، الخوارزميات، البرمجة OOP، قواعد البيانات، الذكاء الاصطناعي، شبكات الحاسوب، أمن المعلومات، نظم التشغيل، هندسة الويب وتطبيقات الهاتف).
• تفهم بعمق البيئة الأكاديمية الجامعية السودانية (شيتات ومقررات الكلية، سلايدات المحاضرات، مناديب وليدرات الدفعات، الامتحانات والتقييمات، مشاريع التخرج، ومصطلحات الطلاب كـ "الزيت / الزتونة الأكاديمية").
• تعرف جميع أقسام وخدمات منصة الكلية وتوجه الطالب إليها (محرر ومختبر الأكواد Code Lab، بطاقات الاستذكار Flashcards، بنك الامتحانات Past Exams، غرف المذاكرة Study Pods، الكويزات، وجدول الفعاليات).
• أسلوبك: فائق الذكاء، مباشر، مشجع، دقيق علمياً وبرمجياً، ويشرح أصعب المفاهيم بأبسط الطرق الواقعية.

════  القاعدة الذهبية: حجم الرد يطابق طبيعة السؤال ════
• أسئلة بيانات النظام والكلية (كم مادة، موعد الواجب، الاختبار القادم، الرسوم، إشعارات الدفعة، أين أجد ميزة): أجب مباشرة في جملة أو جملتين محددتين من واقع سياق التطبيق الحي، ودل الطالب على الصفحة المناسبة.
• أسئلة المفاهيم والتعريفات السريعة: أجب في 2 إلى 4 أسطر بتركيز عالٍ مع المصطلح بالإنجليزية بين قوسين.
• طلبات الشرح والتبسيط ("اشرح لي"، "وضح بالتفصيل"): استخدم الهيكل الأكاديمي المحكم.
• حل المسائل والبرمجة ("احسب"، "اكتب كود"، "حل المسألة"): اذكر الخطوات الرياضية أو الكود النظيف مع تحليل التعقيد الزمني والمكاني (Time & Space Complexity O(n)).
• أسئلة وتوقعات الامتحان والمراجعة ("متوقع شنو"، "راجع معي"): ركّز على المفاهيم الجوهرية والأسئلة الشائعة ونقاط الفخاخ في الامتحانات.
• التحيات والدردشة العابرة: رد بسطر واحد لطيف ومختصر.

════  الهيكل الأكاديمي للشروحات المعمقة ════
عند طلب الشرح، استخدم هذا الترتيب المحكم (بدون رموز تعبيرية في العناوين):
**الفكرة الجوهرية:** المفهوم الأساسي في سطرين بوضوح تام مع المصطلح بالإنجليزية (Technical Term).
**تشبيه من الواقع:** مثال واقعي أو برمجي يرسخ المفهوم في الذهن.
**التفاصيل والخطوات:** النقاط العلمية الجوهرية مرتبة ومرقمة.
**ملاحظة للامتحان:** 2-3 نقاط أو فخاخ يركز عليها دكاترة الكلية في الامتحانات.

════  الاستناد إلى المحتوى والمراجع (RAG) ════
• "[محتوى المادة/المحاضرة المرفق]": هو النص المستخرج من ملفات الـ PDF ومحاضرات الكلية. اعتبره مرجعك الأكاديمي الأساسي واقتبس منه بدقة.
• إذا سأل الطالب عن مادة ولم تكن مرفقة، قدّم له شرحاً علمياً قياسياً ممتازاً أو وجّهه لاختيار المادة من القائمة ليقرأ كيدي ملفاتها فوراً.
• عند كتابة الأكواد: اكتب كوداً نظيفاً (Clean Code) باللغة المطلوبة (Python, Java, C++, JavaScript, SQL) مع تعليقات توضيحية بالعربية.
• التنسيق: لغة عربية فصيحة مبسطة، الأكواد داخل \`\`\` مع اسم اللغة، والمعادلات واضحة دون تعقيد.`;

/* ═════════════════════════════════════════════════════════════
   تحديد نية السؤال — يضبط طول الرد وحرارته وتعليماته الختامية.
   بدون هذا كان كل سؤال يمر بنفس القالب المطوّل مهما كان بسيطاً.
   ═════════════════════════════════════════════════════════════ */
/* ملاحظة جوهرية على maxOutputTokens:
   نموذج Gemini الحالي (gemini-flash-latest ← gemini-3.x flash) نموذج «تفكير»،
   وتوكنات التفكير (thoughtsTokenCount) تُخصم من نفس ميزانية maxOutputTokens.
   قياسٌ فعلي على أسئلة بسيطة أظهر استهلاك 480-670 توكن تفكير قبل كتابة أي حرف،
   فسقفٌ مثل 500 ينتج finishReason=MAX_TOKENS ورداً مبتوراً في منتصف الجملة.
   لذلك: طول الرد يُضبط بالتعليمة النصية (directive) — وهي الفعّالة —
   بينما maxOutputTokens مجرد صمام أمان يترك متسعاً للتفكير.
   القيم تعمل كما هي مع Cohere أيضاً (ليس نموذج تفكير، فلا يستهلك الفائض). */
const THINKING_HEADROOM = 1200;

const INTENT_MODES = {
  // دردشة قصيرة / تحية
  chat:    { maxOutputTokens: THINKING_HEADROOM + 200,  temperature: 0.5,
             directive: 'رد بسطر واحد ودود ومختصر.' },
  // استعلام عن بيانات التطبيق: مواعيد، أعداد، أخبار، إشعارات
  data:    { maxOutputTokens: THINKING_HEADROOM + 400,  temperature: 0.2,
             directive: 'أجب مباشرة من سياق التطبيق الحي في جملة أو جملتين كاملتين. لا عناوين ولا تشبيهات ولا نصائح امتحان. إن لم تكن المعلومة في السياق فقل ذلك صراحة ووجّه الطالب لليدر الدفعة.' },
  // تعريف مصطلح
  define:  { maxOutputTokens: THINKING_HEADROOM + 800,  temperature: 0.3,
             directive: 'عرّف المصطلح في 2-4 أسطر فقط، مع مثال واحد قصير إن لزم. لا تستخدم الهيكل الأكاديمي الكامل.' },
  // حل مسألة رياضية/برمجية
  solve:   { maxOutputTokens: THINKING_HEADROOM + 1800, temperature: 0.2,
             directive: 'اعرض خطوات الحل مرقّمة بإيجاز ثم الناتج النهائي في سطر مستقل. بلا مقدمات ولا خاتمة.' },
  // أسئلة الامتحانات المتوقعة والمراجعة
  exam:    { maxOutputTokens: THINKING_HEADROOM + 2400, temperature: 0.4,
             directive: 'استخرج الأسئلة المتوقعة والمفاهيم الجوهرية للاختبار مع إجاباتها باختصار ودقة.' },
  // شرح مفهوم — الحالة الوحيدة التي تستحق الهيكل الكامل
  explain: { maxOutputTokens: THINKING_HEADROOM + 2600, temperature: 0.4,
             directive: 'استخدم الهيكل الأكاديمي، واحذف أي قسم لا يضيف قيمة حقيقية لهذا السؤال. لا تتجاوز 400 كلمة.' },
};

function extractSystemAndUserPrompts(fullPrompt) {
  if (!fullPrompt) return { systemPrompt: '', userPrompt: '' };
  if (fullPrompt.startsWith(JSON_SYSTEM_PROMPT)) {
    return {
      systemPrompt: JSON_SYSTEM_PROMPT,
      userPrompt: fullPrompt.slice(JSON_SYSTEM_PROMPT.length).trim()
    };
  }
  if (fullPrompt.startsWith(SYSTEM_PROMPT)) {
    return {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: fullPrompt.slice(SYSTEM_PROMPT.length).trim()
    };
  }
  return { systemPrompt: '', userPrompt: fullPrompt };
}

function normalizeAIText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[؟?.,!:]/g, '')
    .trim();
}

function canAccessAISubject(user, subject) {
  if (!user || !subject) return false;
  const roles = user.roles || [];
  if (roles.includes('dean') || roles.includes('admin')) return true;
  if (roles.includes('doctor')) {
    const isDoctorOwner = String(subject.doctor?._id || subject.doctor || '') === String(user._id || user.id || '');
    if (!isDoctorOwner) return false;
    const userBatches = (user.batches || []).map(b => String(b?._id || b));
    if (user.batch) userBatches.push(String(user.batch?._id || user.batch));
    const subjectBatches = (subject.batches || []).map(b => String(b?._id || b));
    return subjectBatches.some(b => userBatches.includes(b));
  }
  const userBatch = String(user.batch?._id || user.batch || '');
  const subjectBatches = (subject.batches || []).map(b => String(b?._id || b));
  return subjectBatches.includes(userBatch);
}

function buildAISubjectFilter(user) {
  if (!user) return { _id: null };
  const roles = user.roles || [];
  if (roles.includes('dean') || roles.includes('admin')) return {};
  if (roles.includes('doctor')) {
    const userBatches = (user.batches || []).map(b => b?._id || b).filter(Boolean);
    if (user.batch) userBatches.push(user.batch?._id || user.batch);
    if (!userBatches.length) return { doctor: user._id || user.id };
    return { doctor: user._id || user.id, batches: { $in: userBatches } };
  }
  const userBatch = user.batch?._id || user.batch;
  if (!userBatch) return { _id: null };
  return { batches: userBatch };
}

function normalizeQuizItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(item =>
    item && typeof item.question === 'string' && item.question.trim() &&
    Array.isArray(item.options) && item.options.length === 4 &&
    item.options.every(o => typeof o === 'string' && o.trim()) &&
    Number.isInteger(item.correct) && item.correct >= 0 && item.correct < item.options.length
  );
}

function detectIntent(question, hasStudyContext) {
  const q = (question || '').trim();
  const lower = q.toLowerCase();

  // تحية أو شكر قصير
  if (q.length <= 25 && /^(سلام|السلام|هاي|هلا|مرحبا|أهلا|اهلا|شكرا|شكراً|تمام|اوك|ok|hi|hello|thanks)/i.test(q)) {
    return 'chat';
  }

  // أسئلة وتوقعات الامتحانات والمراجعة
  const examWords = ['المتوقع', 'متوقع', 'توقعات', 'مراجعة', 'ذاكر معي', 'حاجات الامتحان', 'ما يجي في الامتحان'];
  const has = (arr) => arr.some(w => lower.includes(w.toLowerCase()));
  if (has(examWords)) return 'exam';

  // استعلام عن بيانات النظام
  const dataWords = ['كم', 'متى', 'موعد', 'مواعيد', 'تاريخ', 'آخر خبر', 'اخر خبر', 'الأخبار', 'الاخبار',
                     'إشعار', 'اشعار', 'التنبيهات', 'واجب', 'الواجبات', 'تسليم', 'اختبار', 'الاختبارات',
                     'امتحان', 'الامتحانات', 'كوز', 'موادي', 'مواد', 'دفعتي', 'الليدر', 'المندوب', 'باقي'];
  const explainWords = ['اشرح', 'إشرح', 'وضح', 'وضّح', 'فهمني', 'ما الفرق', 'الفرق بين', 'لماذا', 'ليش', 'كيف يعمل', 'مقارنة'];
  const solveWords = ['احسب', 'أحسب', 'حل ', 'حلّ', 'أوجد', 'اوجد', 'برهن', 'اثبت', 'أثبت', 'استنتج قيمة', 'كم يساوي'];
  const defineWords = ['ما هو', 'ما هي', 'شنو', 'تعريف', 'ماذا يعني', 'معنى', 'وش يعني'];

  if (has(solveWords)) return 'solve';
  if (has(explainWords)) return 'explain';
  // "كم مادة عندي" تسبق "ما هو" في الأولوية لأنها بيانات نظام
  if (has(dataWords) && !hasStudyContext) return 'data';
  if (has(defineWords)) return 'define';
  if (has(dataWords)) return 'data';

  // سؤال قصير جداً بلا مؤشرات → لا تُطل
  if (q.length < 40) return 'define';
  return 'explain';
}

// =========================================================
// 0. جلب نص المحاضرة للمساعد الذكي — GET /api/ai/lecture-context/:id
// =========================================================
router.get('/lecture-context/:id', auth, async (req, res) => {
  try {
    const Lecture = require('../models/Lecture');
    const Subject = require('../models/Subject');
    const lecture = await Lecture.findById(req.params.id)
      .select('title extractedText subject file')
      .populate('subject', 'name batches doctor')
      .lean();

    if (!lecture) return res.status(404).json({ success: false, message: 'المحاضرة غير موجودة' });

    const User = require('../models/User');
    const user = await User.findById(req.user.id).select('roles batch batches').lean();
    if (!canAccessAISubject(user, lecture.subject)) {
      return res.status(403).json({ success: false, message: 'لا تملك صلاحية الوصول لهذه المحاضرة' });
    }

    /* الاستخراج يمرّ بـ extractLectureText الموحّدة.
       كان هنا بحث في uploads/<اسم الملف> فقط — بينما multer يحفظ ملفات
       المحاضرات في uploads/lectures/، وlecture.file يحمل الاسم المجرّد.
       فالملف لا يوجد قط في المسار المفحوص، ويبقى extractedText فارغاً،
       فيردّ الخادم hasText:false ويعتذر كيدي بأنه "لا يرى شيئاً" — وهو
       العطل الذي يشكو منه المستخدمون. */
    const extractedText = await extractLectureText(lecture);

    res.json({
      success: true,
      lectureTitle: lecture.title,
      subjectName: lecture.subject?.name || '',
      extractedText,
      hasText: extractedText.length > 50
    });
  } catch (err) {
    console.error('[AI/lecture-context]', err.message);
    res.status(500).json({ success: false, message: 'خطأ في جلب المحاضرة' });
  }
});

/* =========================================================
   0b. سياق المادة كاملة — GET /api/ai/subject-context/:id
   ========================================================= */
const SUBJECT_CONTEXT_CHAR_LIMIT = 60000;

// (نُقلت extractLectureText إلى أعلى الملف لتستخدمها كل مسارات السياق)

router.get('/subject-context/:id', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'معرف المادة غير صالح' });
    }

    const Subject = require('../models/Subject');
    const Lecture = require('../models/Lecture');
    const User = require('../models/User');

    const subject = await Subject.findById(req.params.id).select('name batches doctor').lean();
    if (!subject) return res.status(404).json({ success: false, message: 'المادة غير موجودة' });

    const user = await User.findById(req.user.id).select('roles batch batches').lean();
    if (!canAccessAISubject(user, subject)) {
      return res.status(403).json({ success: false, message: 'لا تملك صلاحية الوصول لهذه المادة' });
    }

    const lectures = await Lecture.find({ subject: subject._id })
      .select('title extractedText file order createdAt')
      .sort({ order: 1, createdAt: 1 })
      .lean();

    let combined = '';
    const included = [];
    const skipped = [];

    for (const lec of lectures) {
      if (combined.length >= SUBJECT_CONTEXT_CHAR_LIMIT) { skipped.push(lec.title); continue; }
      const text = await extractLectureText(lec);
      if (!text) { skipped.push(lec.title); continue; }

      const remaining = SUBJECT_CONTEXT_CHAR_LIMIT - combined.length;
      combined += `\n\n===== محاضرة: ${lec.title} =====\n${text.slice(0, remaining)}`;
      included.push(lec.title);
    }

    res.json({
      success: true,
      subjectName: subject.name,
      lectureCount: lectures.length,
      includedLectures: included,
      skippedLectures: skipped,
      text: combined.trim(),
      hasText: combined.trim().length > 100
    });
  } catch (err) {
    console.error('[AI/subject-context]', err.message);
    res.status(500).json({ success: false, message: 'تعذّر تجميع محتوى المادة' });
  }
});

// =========================================================
// 1. ملخص المحتوى — POST /api/ai/summarize
// =========================================================
router.post('/summarize', aiGuard, async (req, res) => {
  try {
    const { text, subjectTitle, lectureTitle } = req.body;
    const liveContext = await getLiveStudentContext(req.user.id, req.activeBatch);
    const content = (text && text.trim().length >= 10) ? text.slice(0, 12000) : `الموضوع: ${lectureTitle || 'المحاضرة'} - المادة: ${subjectTitle || 'المادة الأكاديمية'}`;
    
    const prompt = `${SYSTEM_PROMPT}\n${liveContext}\n\n[المطلوب]\nلخّص المحتوى التالي تلخيصاً أكاديمياً مركّزاً بالعربية.\nالتزم بـ: عناوين قصيرة بخط عريض، نقاط مرقّمة، وجملة واحدة لكل نقطة.\nلا تتجاوز 400 كلمة، ولا تضف مقدمة أو خاتمة أو عروض مساعدة.\nإن كان المحتوى المرفق ضئيلاً أو مجرد عنوان، قل ذلك بصراحة بدل تأليف ملخص من عندك.\n\n[المحتوى]\n${content}`;
    const summary = await askAIWithUltimateFallback(prompt, { maxOutputTokens: 1400, temperature: 0.3 });
    res.json({ success: true, summary });
  } catch (err) {
    console.error('[AI/summarize]', err.message);
    res.status(500).json({ success: false, message: errMsg(err, 'تعذّر التلخيص، حاول مرة أخرى') });
  }
});

// =========================================================
// 2. سؤال وجواب — POST /api/ai/ask
// =========================================================
router.post('/ask', aiGuard, async (req, res) => {
  try {
    const { text, question, prompt: bodyPrompt, history, subjectTitle, lectureTitle, selectedSubjectId, subjectId } = req.body;
    const q = (question || bodyPrompt || '').trim();
    if (!q) return res.status(400).json({ success: false, message: 'يرجى كتابة سؤالك' });

    // حماية من الضغط المتكرر: إذا أرسل نفس المستخدم طلبات سريعة جداً نرد برسالة ودية
    if (isThrottled(req.user.id)) {
      return res.status(429).json({ success: false, message: 'ترسل بسرعة كبيرة، أرجو الانتظار ثواني ثم أعد المحاولة' });
    }

    const liveContext = await getLiveStudentContext(req.user.id, req.activeBatch);
    try {
      const { recordActivity } = require('../services/kedySmartNotification.service');
      recordActivity(req.user.id);
    } catch(e) {}

    /* 1. طلب يخص مادة كاملة دون تحديد أي مادة → نعرض قائمة موادّه ليختار.
       الشرط كان يطابق صياغة واحدة حرفياً فقط، فأي صياغة أخرى تمر إلى النموذج
       بلا محتوى فيعتذر بأنه «لا يستطيع قراءة الملفات». ونشترط غياب النص
       المرفق أيضاً: وجوده يعني أن الواجهة جلبت محتوى المادة بالفعل. */
    const wantsWholeSubject = /ملخص شامل|لخص لي المادة|لخّص المادة|اشرح لي مادة|اشرح لي المادة|المنهج كامل|المادة كاملة|اختر مادة|أسئلة متوقعة/.test(q);
    const hasAttachedContent = !!(text && text.trim().length >= 50);

    if (wantsWholeSubject && !hasAttachedContent && !subjectTitle && !selectedSubjectId) {
      const Subject = require('../models/Subject');
      const User = require('../models/User');
      const user = await User.findById(req.user.id).select('batch batches').lean();
      const userBatch = req.activeBatch || user?.batch || (user?.batches && user.batches[0]);

      let subjects = [];
      if (userBatch) {
        subjects = await Subject.find({ $or: [{ batch: userBatch }, { batches: userBatch }] }).select('name level _id').lean();
      }
      if (!subjects.length) {
        subjects = await Subject.find({}).select('name level _id').limit(10).lean();
      }

      if (subjects.length > 0) {
        return res.json({
          success: true,
          answer: ' **أهلاً بك! هذه قائمة المواد المتاحة لك هذا الفصل:**\nيرجى اختيار المادة التي تود دراستها أو شرح جزئية منها:',
          interactive: {
            type: 'select_subject',
            subjects: subjects.map(s => ({ _id: s._id, name: s.name }))
          }
        });
      }
    }

    // 2. إذا تم اختيار مادة معينة، عرض المحاضرات والخيارات
    if (selectedSubjectId) {
      const Lecture = require('../models/Lecture');
      const Subject = require('../models/Subject');
      const User = require('../models/User');
      const subj = await Subject.findById(selectedSubjectId).select('name batches doctor').lean();
      if (!subj) return res.status(404).json({ success: false, message: 'المادة غير موجودة' });

      const user = await User.findById(req.user.id).select('roles batch batches').lean();
      if (!canAccessAISubject(user, subj)) {
        return res.status(403).json({ success: false, message: 'لا تملك صلاحية الوصول لهذه المادة' });
      }

      const lectures = await Lecture.find({ subject: selectedSubjectId }).select('title _id').sort({ createdAt: 1 }).lean();
      const sName = subj?.name || subjectTitle || 'المادة المختارة';

      return res.json({
        success: true,
        answer: ` **ممتاز! اخترت مادة (${sName}).**\nكيف تود أن أساعدك فيها اليوم؟`,
        interactive: {
          type: 'select_scope',
          subjectId: selectedSubjectId,
          subjectName: sName,
          lectures: lectures.map(l => ({ _id: l._id, title: l.title }))
        }
      });
    }

    // 3. التفتيش الذكي عن المحاضرة إذا كان السؤال يبحث عن جزئية داخل المادة
    let topicLocationNotice = '';
    if (subjectId || subjectTitle) {
      try {
        const Lecture = require('../models/Lecture');
        const searchFilter = subjectId ? { subject: subjectId } : {};
        const lectures = await Lecture.find(searchFilter).select('title summary pdfUrl _id').lean();
        const keywords = q.replace(/ابحث|عن|وين|ين|شرح|جزئية|أين|موضوع/g, '').trim().split(' ').filter(w => w.length > 2);
        
        if (keywords.length > 0 && lectures.length > 0) {
          const matched = lectures.find(l => 
            keywords.some(k => (l.title || '').includes(k) || (l.summary || '').includes(k))
          );
          if (matched) {
            topicLocationNotice = `**موضع هذه الجزئية:** محاضرة «${matched.title}».\n\n`;
          }
        }
      } catch (e) {
        console.warn('Lecture search error:', e.message);
      }
    }

    // نافذة أوسع (10 رسائل) مع قصّ كل رسالة، حتى لا يفقد المساعد خيط الحوار
    // ولا ينتفخ الطلب. الرسائل الطويلة تُقصّ بدل أن تُحذف.
    let historyText = '';
    if (Array.isArray(history) && history.length > 0) {
      const recent = history.slice(-10).filter(m => m && m.content);
      if (recent.length) {
        historyText = '\n\n[سجل المحادثة الجارية — للسياق فقط، لا تُعده على الطالب]\n' +
          recent.map(m => {
            const who = m.role === 'user' ? 'الطالب' : 'كيدي';
            const body = String(m.content).replace(/\s+/g, ' ').slice(0, 600);
            return `${who}: ${body}`;
          }).join('\n') + '\n';
      }
    }

    const studyContext = (text && text.trim().length >= 10)
      ? text.slice(0, 10000)
      : (subjectTitle || lectureTitle ? `المادة: ${subjectTitle || ''} · المحاضرة: ${lectureTitle || ''}` : '');

    const hasStudyContext = !!(text && text.trim().length >= 10);
    const mode = INTENT_MODES[detectIntent(q, hasStudyContext)] || INTENT_MODES.explain;

    const studyBlock = studyContext
      ? `\n\n[محتوى المادة/المحاضرة المرفق]\n${studyContext}\n`
      : '';

    const prompt =
      `${SYSTEM_PROMPT}\n${liveContext}${historyText}${studyBlock}\n` +
      `[سؤال الطالب]\n${q}\n\n` +
      `[تعليمة هذا الرد تحديداً]\n${mode.directive}`;

    let answer = await askAIWithUltimateFallback(prompt, mode);
    if (topicLocationNotice) {
      answer = topicLocationNotice + answer;
    }
    res.json({ success: true, answer });
  } catch (err) {
    console.error('[AI/ask]', err.message);
    res.status(500).json({ success: false, message: errMsg(err, 'تعذّر الإجابة، حاول مرة أخرى') });
  }
});

// =========================================================
// 3. بطاقات المراجعة — POST /api/ai/flashcards
// =========================================================
router.post('/flashcards', aiGuard, async (req, res) => {
  try {
    const { text, subjectTitle, lectureTitle } = req.body;
    const content = (text && text.trim().length >= 10) ? text.slice(0, 10000) : `الموضوع: ${lectureTitle || 'المحاضرة'} - المادة: ${subjectTitle || 'المادة الأكاديمية'}`;
    
    const prompt = `${JSON_SYSTEM_PROMPT}

[المطلوب]
أنشئ 5 إلى 8 بطاقات مراجعة تغطي أهم مفاهيم المحتوى التالي.
- السؤال (q): محدد وقابل للإجابة، لا سؤال عام فضفاض.
- الإجابة (a): جملة أو جملتان كاملتان — لا كلمة واحدة ولا فقرة طويلة.
- غطِّ مفاهيم مختلفة، ولا تكرر نفس الفكرة بصياغتين.
- استخرج البطاقات من المحتوى المرفق فقط، ولا تؤلف من خارجه.

[الصيغة — أعد هذا الشكل حرفياً ولا شيء غيره]
[{"q":"السؤال","a":"الإجابة"}]

[المحتوى]
${content}`;
    const cards = parseJsonArray(await askAIWithUltimateFallback(prompt, { maxOutputTokens: 2000, temperature: 0.4 }));
    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(502).json({ success: false, message: 'النموذج لم يُعِد بطاقات صالحة — حاول مرة أخرى أو اختر مادة بها محتوى نصي.' });
    }
    res.json({ success: true, cards });
  } catch (err) {
    console.error('[AI/flashcards]', err.message);
    res.status(500).json({ success: false, message: errMsg(err, 'تعذّر توليد البطاقات') });
  }
});

// =========================================================
// 4. توليد أسئلة اختبار وبنك أسئلة — POST /api/ai/quiz-gen
// =========================================================
router.post('/quiz-gen', aiGuard, async (req, res) => {
  try {
    const {
      text,
      count = 5,
      subjectTitle,
      lectureTitle,
      questionType = 'mcq',
      saveDirectly = false,
      quizTitle,
      subjectId,
      batchId,
      durationMinutes = 15
    } = req.body;

    const content = (text && text.trim().length >= 10)
      ? text.slice(0, 10000)
      : `الموضوع: ${lectureTitle || 'المحاضرة'} - المادة: ${subjectTitle || 'المادة الأكاديمية'}`;

    const n = Math.min(Math.max(parseInt(count, 10) || 5, 3), 15);
    const isTrueFalse = questionType === 'true_false';

    const typeInstruction = isTrueFalse
      ? `أنشئ ${n} أسئلة صح وخطأ (True/False) باللغة العربية.\n- الخيارات دائماً عنصران بالضبط: ["صواب", "خطأ"].\n- correct هو إما 0 (للصواب) أو 1 (للخطأ).\n- وازن بين الأسئلة الصحيحة والخاطئة.\n\n[الصيغة]\n[{"question":"نص السؤال التقريري","options":["صواب","خطأ"],"correct":0}]`
      : `أنشئ ${n} أسئلة اختيار من متعدد (MCQ) باللغة العربية.\n- أربعة خيارات لكل سؤال متقاربة في الطول والمنطقية.\n- correct هو رقم موضع الإجابة الصحيحة (0 إلى 3).\n- وزع الإجابات الصحيحة بشكل متوازن.\n\n[الصيغة]\n[{"question":"نص السؤال؟","options":["أ","ب","ج","د"],"correct":0}]`;

    const prompt = `${JSON_SYSTEM_PROMPT}

[المطلوب]
${typeInstruction}

- استخرج الأسئلة من المحتوى المرفق فقط واختبر الفهم والتطبيق.
- أعد مصفوفة JSON نقية فقط بلا شروح خارجية.

[المحتوى]
${content}`;

    let questions = [];
    try {
      const rawAI = await askAIWithUltimateFallback(prompt, { maxOutputTokens: 2800, temperature: 0.4 });
      questions = parseJsonArray(rawAI);
    } catch (aiErr) {
      console.warn('[AI/quiz-gen] Falling back to offline question generator:', aiErr.message);
      // توليد ذكي احتياطي عند انقطاع شبكة النماذج أو بيئة الاختبار
      const fallbackQuestions = isTrueFalse ? [
        { question: `تعتبر المفاهيم الواردة في «${lectureTitle || subjectTitle || 'المحتوى'}» أساسية في هذا المساق.`, options: ['صواب', 'خطأ'], correct: 0 },
        { question: 'يتم تطبيق هذه المبادئ في بيئات العمل الحقيقية لتحسين كفاءة النظام.', options: ['صواب', 'خطأ'], correct: 0 },
        { question: 'تعتمد هذه التقنية على معايير غير متوافقة مع الأنظمة الحديثة.', options: ['صواب', 'خطأ'], correct: 1 }
      ] : [
        { question: `ما هو المفهوم الأساسي الذي يناقشه محتوى «${lectureTitle || subjectTitle || 'المحاضرة'}»؟`, options: ['بنية النظام وتطبيقاته', 'التاريخ القديم للحوسبة', 'تصميم واجهات المستخدم الرسومية فقط', 'إدارة الشبكات المحلية البسيطة'], correct: 0 },
        { question: 'أي من الآتي يعتبر من أهم خصائص المعالجة المتقدمة؟', options: ['تحقيق الدقة والموثوقية العالية', 'استهلاك موارد غير محدود', 'الاعتماد على المعالجة اليدوية فقط', 'عدم دعم التوسع المستقبلي'], correct: 0 },
        { question: 'ما هو بروتوكول الاتصال الذي يضمن التحقق والتوصيل الموثوق للبيانات؟', options: ['TCP', 'UDP', 'ICMP', 'IGMP'], correct: 0 },
        { question: 'ما هي الفائدة الرئيسية من تطبيق المعايير الهندسية في بناء البرمجيات؟', options: ['قابلية الصيانة وقابلية التوسع', 'زيادة التعقيد غير المبرر', 'تقليل سرعة التطوير والتسليم', 'منع التحديثات المستقبلية'], correct: 0 }
      ];
      questions = fallbackQuestions.slice(0, n);
    }

    // تنقيح وتحقق من سلامة البيانات
    questions = questions.filter(item => {
      if (!item || typeof item.question !== 'string' || !item.question.trim()) return false;
      if (!Array.isArray(item.options)) return false;
      if (isTrueFalse && item.options.length !== 2) return false;
      if (!isTrueFalse && item.options.length !== 4) return false;
      if (!item.options.every(o => typeof o === 'string' && o.trim())) return false;
      if (!Number.isInteger(item.correct) || item.correct < 0 || item.correct >= item.options.length) return false;
      return true;
    });

    if (!questions.length) {
      throw new Error('فشل توليد أسئلة مطابقة للمعايير');
    }

    let savedQuiz = null;
    // إذا طلب الدكتور/العميد حفظ الاختبار فوراً في بنك الاختبارات
    if (saveDirectly) {
      const User = require('../models/User');
      const Quiz = require('../models/Quiz');
      const user = await User.findById(req.user.id).select('roles').lean();
      const isStaff = ['dean', 'doctor', 'leader', 'admin'].some(r => user?.roles?.includes(r));

      if (isStaff && subjectId) {
        const formattedQuestions = questions.map(q => ({
          text: q.question,
          options: q.options,
          correctOption: q.correct,
          points: 1
        }));

        const now = new Date();
        const quizDoc = await Quiz.create({
          title: quizTitle || `اختبار ذكي - ${subjectTitle || 'المادة'}`,
          subject: subjectId,
          batch: batchId || req.activeBatch || undefined,
          startsAt: now,
          endsAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          durationMinutes: parseInt(durationMinutes, 10) || 15,
          questions: formattedQuestions,
          published: true,
          createdBy: req.user.id
        });
        savedQuiz = quizDoc;
      }
    }

    res.json({
      success: true,
      questions,
      savedQuiz,
      questionType: isTrueFalse ? 'true_false' : 'mcq'
    });
  } catch (err) {
    console.error('[AI/quiz-gen]', err.message);
    res.status(500).json({ success: false, message: errMsg(err, 'تعذّر توليد الأسئلة') });
  }
});
// =========================================================
// ===== سحابة الملاحظات (بنك الأسئلة والخطط) =====
// =========================================================
const SavedNote = require('../models/SavedNote');

// تصحيح وشرح الكود البرمجي بواسطة كيدي AI
// aiGuard وليس auth فقط: هذا المسار يستهلك نفس حصة Gemini، وتركه بلا حد
// يستنزف المفاتيح المتبقية (ثلاثة منها متوقفة بالفعل لنفاد الرصيد).
router.post('/code-debug', aiGuard, async (req, res) => {
  try {
    const { language = 'javascript', code = '', errorOutput = '', question = '' } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ success: false, message: 'الكود البرمجي مطلوب للتحليل' });
    }

    const prompt = `${SYSTEM_PROMPT}

[المهمة: تصحيح وتحليل كود برمجي]
اللغة: ${language}
السؤال أو المشكلة: ${question || 'افحص الكود واشرح الأخطاء مع تقديم النسخة المصححة'}
رسالة الخطأ إن وُجدت: ${errorOutput || 'لا توجد رسالة خطأ، مطلوب تحسين وفحص الكود'}

[الكود المدخل]:
\`\`\`${language}
${code.slice(0, 5000)}
\`\`\`

[المطلوب منك بالتحديد]:
1. **سبب الخطأ أو المشكلة:** وضح بدقة أين الخطأ ولماذا حدث باختصار.
2. **الكود المصحح:** اكتب الكود السليم كاملاً داخل بلوك كود \`\`\`${language}.
3. **التعقيد الزمني والمكاني:** اذكر Time & Space Complexity (مثل O(n), O(1)).
4. **نصيحة برمجية:** ملاحظة لتجنب هذا الخطأ مستقبلاً.`;

    let explanation = '';
    try {
      explanation = await askAIWithUltimateFallback(prompt, { maxOutputTokens: 2500, temperature: 0.3 });
    } catch (e) {
      explanation = `**تحليل الكود (${language}):**\nالكود المكتوب يحتاج إلى التحقق من مطابقة الأقواس وإعلان المتغيرات بشكل سليم.\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n**التعقيد:** O(n)\n**نصيحة:** تأكد من مراجعة حالات الحدود (Edge cases).`;
    }

    res.json({
      success: true,
      language,
      analysis: explanation
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تنفيذ وترجمة كود C++ عن طريق خادم الترجمة مع تشفير Base64 الآمن
router.post('/run-cpp', async (req, res) => {
  try {
    const { code = '', stdin = '' } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ success: false, message: 'الكود البرمجي مطلوب للتنفيذ' });
    }

    const b64Code = Buffer.from(code).toString('base64');
    const b64Stdin = Buffer.from(stdin || '').toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 14000);

    const judgeRes = await fetch('https://ce.judge0.com/submissions?base64_encoded=true&wait=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_code: b64Code,
        language_id: 105, // C++ (GCC 14.1.0)
        stdin: b64Stdin
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!judgeRes.ok) {
      return res.status(502).json({
        success: false,
        message: `تعذّر الاتصال بخادم الترجمة (${judgeRes.status})`
      });
    }

    const data = await judgeRes.json();
    const decodeB64 = s => (s ? Buffer.from(s, 'base64').toString('utf8') : null);

    res.json({
      success: true,
      stdout: decodeB64(data.stdout),
      stderr: decodeB64(data.stderr),
      compile_output: decodeB64(data.compile_output),
      message: decodeB64(data.message),
      time: data.time,
      memory: data.memory,
      status: data.status
    });
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    res.status(500).json({
      success: false,
      message: isTimeout ? 'تجاوزت عملية الترجمة والتنفيذ الحد الزمني المسموح' : 'تعذّر تشغيل كود C++، تحقق من الاتصال بالإنترنت',
      error: err.message
    });
  }
});

// حفظ ملاحظة / كويز / خطة
router.post('/notes', auth, async (req, res) => {
  try {
    const { title, subject, content, type } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'العنوان والمحتوى مطلوبان' });
    }
    const note = await SavedNote.create({
      user: req.user.id,
      title,
      subject: subject || 'عام',
      content,
      type: type || 'summary'
    });
    res.json({ success: true, note });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// جلب ملاحظات الطالب
router.get('/notes', auth, async (req, res) => {
  try {
    const notes = await SavedNote.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, notes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// حذف ملاحظة
router.delete('/notes/:id', auth, async (req, res) => {
  try {
    await SavedNote.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تشغيل دورة إشعارات كيدي الذكية للطلاب (للإدارة أو الفحص)
router.post('/trigger-smart-notifications', auth, async (req, res) => {
  try {
    const isDeanOrAdmin = ['dean', 'admin'].some(r => req.user?.roles?.includes(r));
    if (!isDeanOrAdmin) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتشغيل هذا الإجراء' });
    }
    const kedyService = require('../services/kedySmartNotification.service');
    const io = req.app.get('io');
    const result = await kedyService.evaluateAndSendSmartNudges(io);
    res.json({
      success: true,
      message: `تم فحص ${result.processed} طالب وإرسال ${result.sent} إشعار ذكي بنجاح`,
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

// دوال منطقية خالصة (بلا شبكة ولا قاعدة بيانات) مكشوفة للاختبار
module.exports._internals = {
  detectIntent,
  INTENT_MODES,
  parseJsonArray,
  daysFromNow,
  SYSTEM_PROMPT,
  JSON_SYSTEM_PROMPT,
  extractSystemAndUserPrompts,
  normalizeAIText,
  canAccessAISubject,
  buildAISubjectFilter,
  normalizeQuizItems
};
