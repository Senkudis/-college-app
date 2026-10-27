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

/* سجل المحادثة كأدوار حقيقية (user/assistant) لا كنص ملصوق داخل رسالة واحدة:
   النماذج تتابع الحوار بالأدوار أفضل بكثير — كان "اديني مثال تاني" يُعيد
   التعريف نفسه لأن السجل كان مجرد "سياق" نصي. نحتفظ بآخر 10 رسائل، ونترك
   لرد كيدي مساحة أكبر (1500 حرف) كي تبقى أسئلة الكويز كاملة لتصحيحها. */
const HISTORY_MAX_MESSAGES = 10;

function chatHistoryMessages(history) {
  if (!Array.isArray(history)) return [];
  const msgs = history
    .filter(m => m && typeof m.content === 'string' && m.content.trim())
    .slice(-HISTORY_MAX_MESSAGES)
    .map(m => {
      const role = m.role === 'user' ? 'user' : 'assistant';
      const limit = role === 'assistant' ? 1500 : 600;
      return { role, content: m.content.replace(/\s+\n/g, '\n').trim().slice(0, limit) };
    });
  // بعض المزوّدين يرفضون محادثة تبدأ برد المساعد
  while (msgs.length && msgs[0].role === 'assistant') msgs.shift();
  return msgs;
}

/* عطل يخص المفتاح نفسه لا الطلب: مفتاح موقوف (403 "has been suspended")، غير
   صالح (401/400 "API key not valid")، أو بلا رصيد (402 "prepayment credits are
   depleted"). لن يعود بعد دقيقة كتجاوز الحصة، فنُنحّيه ساعات ونجرّب غيره.
   كان 403 يُعامَل كعطل نهائي فيصل الطالب "خطأ 500" مع وجود مفاتيح سليمة. */
const RATE_LIMIT_BLOCK_MS = 60 * 60 * 1000;
const KEY_PROBLEM_BLOCK_MS = 6 * 60 * 60 * 1000;
function isKeyLevelFailure(status, message) {
  return [401, 402, 403].includes(Number(status))
    || /api key not valid|invalid api key|suspended|prepayment|billing|permission denied|unauthori[sz]ed/i.test(message || '');
}

/* يكرر طلب مزوّد على مفاتيحه واحداً بعد آخر: كل طلب يختار أول مفتاح غير
   محظور، وعند عطل يخص المفتاح يحظره الطلب نفسه فيأخذ التالي الدور. كان كل
   مزوّد يُجرَّب بمفتاح واحد فقط، فيسقط المزوّد كله بسقوط مفتاحه الأول. */
async function tryEachKey(requestFn, keyCount, ...args) {
  let lastErr;
  for (let i = 0; i < Math.max(1, keyCount); i++) {
    try {
      return await requestFn(...args);
    } catch (err) {
      lastErr = err;
      if (!(err.isRateLimit || err.isKeyProblem)) throw err;
    }
  }
  throw lastErr;
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
      contents: [
        ...chatHistoryMessages(opts.history).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        { role: 'user', parts: [{ text: prompt }] }
      ],
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
      timeout: Math.min(45000, opts.timeoutMs || Infinity),
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
            err.isKeyProblem = isKeyLevelFailure(json.error.code, json.error.message)
              || ['PERMISSION_DENIED', 'UNAUTHENTICATED'].includes(json.error.status);
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
    req.on('timeout', () => { req.destroy(new Error('Gemini request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function geminiWithFallback(prompt, opts = {}) {
  /* كل مفتاح غير محظور يُجرَّب مرة واحدة بالتناوب. حين تكون كلها محظورة لا
     ننتظر أقربها انتهاءً (كان يعيد محاولة مفتاح موقوف في كل طلب) — نرمي
     RATE_LIMIT_ALL_KEYS فوراً لينتقل الطلب إلى المزوّد الاحتياطي. */
  const now = Date.now();
  const usable = _geminiKeyPool.filter(k => k.blockedUntil <= now);
  if (!usable.length) throw new Error('RATE_LIMIT_ALL_KEYS');

  const start = _rrIdx++ % usable.length;
  const order = usable.slice(start).concat(usable.slice(0, start));

  for (const keyObj of order) {
    try {
      keyObj.requestCount++;
      return await geminiRequest(keyObj.key, prompt, opts);
    } catch (err) {
      if (!(err.isRateLimit || err.isKeyProblem)) throw err;
      blockGeminiKey(keyObj, err.isKeyProblem ? KEY_PROBLEM_BLOCK_MS : (err.retryAfterMs || 65_000));
      console.log(`[AI]  تحويل لمفتاح Gemini آخر بعد: ${err.message.slice(0, 80)}`);
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
        ...chatHistoryMessages(opts.history),
        { role: 'user',   content: userPrompt }
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxOutputTokens ?? 2048
    });

    const reqOpts = {
      hostname: 'api.cohere.com',
      path: '/v2/chat',
      method: 'POST',
      timeout: Math.min(45000, opts.timeoutMs || Infinity),
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
          /* في v2 كل رد ناجح يحمل الحقل message (= رسالة المساعد {role, content})،
             فالشرط القديم "json.message" كان يرفض كل إجابة صحيحة كخطأ ويطبع
             الإجابة نفسها في السجل — أي أن Cohere الاحتياطي لم يعمل قط. رسالة
             الخطأ في Cohere نصٌّ مع حالة ≥400، لا كائن. */
          const isErrorBody = json.error || (typeof json.message === 'string' && !json.message?.content);
          if (res.statusCode >= 400 || isErrorBody) {
            const reason = describeApiError(json, `Cohere API error ${res.statusCode}`);
            const err = new Error(reason);
            err.status = res.statusCode;
            err.isRateLimit = res.statusCode === 429;
            err.isKeyProblem = isKeyLevelFailure(res.statusCode, reason);
            // نُنحّي المفتاح المعطّل ليأخذ التالي الدور بدل تكرار الفشل عليه
            if (err.isKeyProblem) keyEntry.blockedUntil = Date.now() + KEY_PROBLEM_BLOCK_MS;
            else if (err.isRateLimit) keyEntry.blockedUntil = Date.now() + RATE_LIMIT_BLOCK_MS;
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
    req.on('timeout', () => { req.destroy(new Error('Cohere request timed out')); });
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

/* حدّ Groq المجاني بالدقيقة (8 آلاف توكن لكل نموذج) ورسالته تقول متى يعود:
   "Please try again in 7.5s". كان المفتاح يُنحّى ساعة كاملة بعد أول تجاوز،
   فيخرج أسرع مزوّد من الخدمة طوال الساعة بسبب ثلاثة أسئلة متتالية. */
function groqRetryAfterMs(reason) {
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(reason || '');
  return m ? Math.ceil(((Number(m[1]) || 0) * 60 + Number(m[2])) * 1000) + 500 : 60_000;
}

const GROQ_PROVIDER = {
  label: 'Groq',
  hostname: 'api.groq.com',
  path: '/openai/v1/chat/completions',
  model: GROQ_MODEL,
  timeout: 30000,
  pickKey: getAvailableGroqKey,
  // gpt-oss نموذج تفكير: الجهد المنخفض يكفي لأسئلة الطلاب ويوفّر الوقت وحصة الدقيقة
  extraBody: /^openai\/gpt-oss/.test(GROQ_MODEL) ? { reasoning_effort: 'low' } : {},
  rateLimitBlockMs: groqRetryAfterMs
};

function groqRequest(systemPrompt, userPrompt, opts = {}) {
  return openAICompatibleRequest(GROQ_PROVIDER, systemPrompt, userPrompt, opts);
}

/* نموذج Groq الثاني: الحصة في Groq لكل نموذج، فحين يبلغ gpt-oss حدّ الدقيقة
   يبقى هذا متاحاً بالمفاتيح نفسها. لكل نموذج حالة حظر مستقلة للمفاتيح.
   qwen3.8-27b أجاب بعربية سليمة في ~1 ث (2026-10-22). */
const GROQ_MODEL_2 = process.env.GROQ_MODEL_2 || 'qwen/qwen3.8-27b';
const _groq2Keys = _groqKeys.map(k => ({ key: k.key, blockedUntil: 0 }));
let _groq2Idx = 0;
function getAvailableGroq2Key() {
  const now = Date.now();
  const free = _groq2Keys.filter(k => k.blockedUntil <= now);
  const pool = free.length ? free : _groq2Keys;
  if (!pool.length) return null;
  _groq2Idx = (_groq2Idx + 1) % pool.length;
  return pool[_groq2Idx];
}
const GROQ2_PROVIDER = {
  label: 'Groq-2',
  hostname: 'api.groq.com',
  path: '/openai/v1/chat/completions',
  model: GROQ_MODEL_2,
  timeout: 30000,
  pickKey: getAvailableGroq2Key,
  extraBody: /qwen3/i.test(GROQ_MODEL_2) ? { reasoning_effort: 'none' } : {},
  rateLimitBlockMs: groqRetryAfterMs
};
function groq2Request(systemPrompt, userPrompt, opts = {}) {
  return openAICompatibleRequest(GROQ2_PROVIDER, systemPrompt, userPrompt, opts);
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

const QWEN_PROVIDER = {
  label: 'Qwen',
  hostname: QWEN_HOST,
  path: QWEN_PATH,
  model: QWEN_MODEL,
  timeout: 60000,
  pickKey: getAvailableQwenKey
};

function qwenRequest(systemPrompt, userPrompt, opts = {}) {
  return openAICompatibleRequest(QWEN_PROVIDER, systemPrompt, userPrompt, opts);
}

// =========================================================
// ===== مزوّد Mistral (خطة Experiment المجانية) =====
// =========================================================
/* المزوّد الأساسي بعد نفاد رصيد Gemini المدفوع: الخطة المجانية تعطي قرابة
   مليار توكن شهرياً ونافذة سياق 128 ألف توكن — تكفي "لخّص المادة" كاملة،
   وهو ما لا يستطيعه Groq المجاني (8 آلاف توكن في الدقيقة للطلب كله).
   عيبها حدّ طلب واحد تقريباً في الثانية، فنعيد المحاولة مرة بعد لحظة قبل
   التحويل لغيره. تنبيه: طلبات الخطة المجانية قد تستخدمها Mistral في التدريب. */
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

const _mistralKeys = [
  process.env.MISTRAL_API_KEY,
  process.env.MISTRAL_API_KEY_2,
  process.env.MISTRAL_API_KEY_3,
].filter(Boolean).map(key => ({ key, blockedUntil: 0 }));

let _mistralIdx = 0;

function getAvailableMistralKey() {
  const now = Date.now();
  const free = _mistralKeys.filter(k => k.blockedUntil <= now);
  const pool = free.length ? free : _mistralKeys;
  if (!pool.length) return null;
  _mistralIdx = (_mistralIdx + 1) % pool.length;
  return pool[_mistralIdx];
}

// 429 بسبب نفاد الحصة الشهرية يدوم؛ أما حدّ الطلبات في الثانية فعابر
const MISTRAL_QUOTA_RE = /month|quota|exhaust/i;
const MISTRAL_RETRY_DELAY_MS = 1200;

const MISTRAL_PROVIDER = {
  label: 'Mistral',
  hostname: 'api.mistral.ai',
  path: '/v1/chat/completions',
  model: MISTRAL_MODEL,
  timeout: 60000,
  pickKey: getAvailableMistralKey,
  // لا نحظر المفتاح على حدّ الثانية — كان سيُحرم منه الجميع ساعة بسبب طالبين متزامنين
  rateLimitBlockMs: reason => (MISTRAL_QUOTA_RE.test(reason) ? RATE_LIMIT_BLOCK_MS : 0)
};

async function mistralRequest(systemPrompt, userPrompt, opts = {}) {
  try {
    return await openAICompatibleRequest(MISTRAL_PROVIDER, systemPrompt, userPrompt, opts);
  } catch (err) {
    if (!err.isRateLimit || MISTRAL_QUOTA_RE.test(err.message)) throw err;
    await new Promise(resolve => setTimeout(resolve, MISTRAL_RETRY_DELAY_MS));
    return openAICompatibleRequest(MISTRAL_PROVIDER, systemPrompt, userPrompt, opts);
  }
}

// =========================================================
// ===== مزوّد Z.AI (GLM — نماذج Flash المجانية) =====
// =========================================================
/* شركة صينية، فلا تخضع للقيود الأمريكية التي حجبت تسجيل NVIDIA من السودان.
   glm-4.5-flash مجاني بسياق 128 ألف توكن: لخّص 12 ألف حرف في ~8 ثوانٍ في
   الاختبار، فهو المزوّد الأنسب للطلبات الطويلة التي يتخطاها Groq.
   - التفكير مُعطّل: نماذج GLM تفكّر قبل الرد، وglm-4.7-flash استهلك كامل حد
     المخرجات في التفكير فعاد بنص فارغ (نفس فخ Gemini).
   - حدّه طلب واحد متزامن؛ 429 بالرمز 1305 ("overloaded") عابر، فلا نحظر
     المفتاح ويحوَّل الطلب للمزوّد التالي.
   - glm-5.3-flash/flashx مدفوعان (1113 Insufficient balance) — لا تستخدمهما. */
const ZAI_MODEL = process.env.ZAI_MODEL || 'glm-4.5-flash';

const _zaiKeys = [
  process.env.ZAI_API_KEY,
  process.env.ZAI_API_KEY_2,
  process.env.ZAI_API_KEY_3,
].filter(Boolean).map(key => ({ key, blockedUntil: 0 }));

let _zaiIdx = 0;

function getAvailableZaiKey() {
  const now = Date.now();
  const free = _zaiKeys.filter(k => k.blockedUntil <= now);
  const pool = free.length ? free : _zaiKeys;
  if (!pool.length) return null;
  _zaiIdx = (_zaiIdx + 1) % pool.length;
  return pool[_zaiIdx];
}

const ZAI_PROVIDER = {
  label: 'Z.AI',
  hostname: process.env.ZAI_API_HOST || 'api.z.ai',
  path: '/api/paas/v4/chat/completions',
  model: ZAI_MODEL,
  timeout: 60000,
  pickKey: getAvailableZaiKey,
  extraBody: { thinking: { type: 'disabled' } },
  rateLimitBlockMs: () => 0
};

function zaiRequest(systemPrompt, userPrompt, opts = {}) {
  return openAICompatibleRequest(ZAI_PROVIDER, systemPrompt, userPrompt, opts);
}

// =========================================================
// ===== مزوّد NVIDIA NIM (build.nvidia.com — تجريبي مجاني) =====
// =========================================================
/* الأسرع في الاختبار (2026-10-14): nemotron-3-super-120b أجاب سؤالاً قصيراً
   في ~2 ث ولخّص 12 ألف حرف في ~3.5 ث بعربية سليمة. الحد ~40 طلباً في الدقيقة
   لكل نموذج بلا حد يومي صارم، والسياق واسع — فهو الخيار الأول للطلبات الطويلة.
   تنبيه: NVIDIA تصف الخدمة بأنها للتجربة والتطوير، ومفتاحها "for API testing". */
/* 2026-10-22: nemotron-3-super-120b صار يرد 404 على كل طلب (ما زال في قائمة
   /v1/models لكنه سُحب من الاستدعاء)، فكان المزوّد الثاني في السلسلة ميتاً.
   nemotron-3.5-lightning مع إيقاف التفكير أجاب بعربية سليمة في ~1.5 ث. */
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';

const _nvidiaKeys = [
  process.env.NVIDIA_API_KEY,
  process.env.NVIDIA_API_KEY_2,
  process.env.NVIDIA_API_KEY_3,
].filter(Boolean).map(key => ({ key, blockedUntil: 0 }));

let _nvidiaIdx = 0;

function getAvailableNvidiaKey() {
  const now = Date.now();
  const free = _nvidiaKeys.filter(k => k.blockedUntil <= now);
  const pool = free.length ? free : _nvidiaKeys;
  if (!pool.length) return null;
  _nvidiaIdx = (_nvidiaIdx + 1) % pool.length;
  return pool[_nvidiaIdx];
}

const NVIDIA_PROVIDER = {
  label: 'NVIDIA',
  hostname: 'integrate.api.nvidia.com',
  path: '/v1/chat/completions',
  model: NVIDIA_MODEL,
  timeout: 45000,
  pickKey: getAvailableNvidiaKey,
  // نماذج Nemotron 3.x تفكّر افتراضياً (6.7 ث بدل 1.5 ث للسؤال القصير)
  extraBody: /nemotron-3/i.test(NVIDIA_MODEL) ? { chat_template_kwargs: { enable_thinking: false } } : {},
  // حدّه بالدقيقة: نُنحّي المفتاح دقيقة واحدة فقط لا ساعة
  rateLimitBlockMs: () => 60_000
};

function nvidiaRequest(systemPrompt, userPrompt, opts = {}) {
  return openAICompatibleRequest(NVIDIA_PROVIDER, systemPrompt, userPrompt, opts);
}

// =========================================================
// ===== مزوّد Radox AI (وسيط — احتياطي أخير فقط) =====
// =========================================================
/* وسيط يمرّر الطلبات لمزوّدين آخرين (شروطه: "لا نستضيف النماذج"، وأسماء
   النماذج قد تختلف عن الأصل)، ويضيف ~280 توكن تعليمات مخفية لكل طلب، ولا
   يذكر جهته ولا سياسة الاحتفاظ بالبيانات. لذلك يأتي بعد كل المزوّدين
   المعروفين: سياق الطالب لا يصله إلا إذا فشلوا جميعاً.
   الخطة المجانية 10 ملايين توكن شهرياً، وتوكنات التفكير تُحتسب منها؛ عند
   نفادها يرد 402 فيُنحّى المفتاح تلقائياً (isKeyLevelFailure).
   deepseek-v4-pro-max أجاب بعربية سليمة في ~4 ث؛ نماذج gpt/claude/gemini عنده
   تستهلك الحد كله في التفكير إن كان صغيراً فتعود بنص فارغ. */
const RADOX_MODEL = process.env.RADOX_MODEL || 'deepseek-v4-pro-max';

const _radoxKeys = [
  process.env.RADOX_API_KEY,
  process.env.RADOX_API_KEY_2,
].filter(Boolean).map(key => ({ key, blockedUntil: 0 }));

let _radoxIdx = 0;

function getAvailableRadoxKey() {
  const now = Date.now();
  const free = _radoxKeys.filter(k => k.blockedUntil <= now);
  const pool = free.length ? free : _radoxKeys;
  if (!pool.length) return null;
  _radoxIdx = (_radoxIdx + 1) % pool.length;
  return pool[_radoxIdx];
}

const RADOX_PROVIDER = {
  label: 'Radox',
  hostname: 'radoxai.com',
  path: '/v1/chat/completions',
  model: RADOX_MODEL,
  timeout: 60000,
  pickKey: getAvailableRadoxKey,
  // التلخيص بحد 1400 عاد فارغاً: التفكير وحده استهلك الحد كله
  minMaxTokens: 4000,
  rateLimitBlockMs: () => 60_000
};

function radoxRequest(systemPrompt, userPrompt, opts = {}) {
  return openAICompatibleRequest(RADOX_PROVIDER, systemPrompt, userPrompt, opts);
}

// =========================================================
// ===== طلب موحّد للمزوّدين المتوافقين مع OpenAI =====
// =========================================================
/* Groq وQwen وMistral يتبعون صيغة OpenAI نفسها. كانت لكل منها دالة منسوخة
   شبه حرفياً، فيُصلَح عطل في إحداها ويبقى في الأخريات. */
function openAICompatibleRequest(provider, systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const keyEntry = provider.pickKey();
    if (!keyEntry) return reject(new Error(`NO_${provider.label.toUpperCase()}_KEY`));

    console.log(`[AI]  استدعاء ${provider.label} (${provider.model})...`);
    const body = JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...chatHistoryMessages(opts.history),
        { role: 'user',   content: userPrompt }
      ],
      temperature: opts.temperature ?? 0.4,
      // نماذج التفكير تخصم تفكيرها من الحد نفسه؛ minMaxTokens يضمن متسعاً للإجابة
      max_tokens: Math.max(opts.maxOutputTokens ?? 2048, provider.minMaxTokens || 0),
      // حقول خاصة بمزوّد بعينه (مثل إيقاف التفكير في GLM)
      ...(provider.extraBody || {})
    });

    const req = https.request({
      hostname: provider.hostname,
      path: provider.path,
      method: 'POST',
      // مهلة الطلب = الأقل بين مهلة المزوّد وما تبقّى من ميزانية السؤال كله
      timeout: Math.min(provider.timeout || 45000, opts.timeoutMs || Infinity),
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
        let json;
        try {
          json = JSON.parse(data);
        } catch (e) {
          const err = new Error(`تعذّر تحليل رد ${provider.label} (${res.statusCode})`);
          err.status = res.statusCode;
          return reject(err);
        }

        if (res.statusCode >= 400 || json.error) {
          const reason = describeApiError(json, `${provider.label} API error ${res.statusCode}`);
          const err = new Error(reason);
          err.status = res.statusCode;
          err.isRateLimit = res.statusCode === 429;
          // 404 = النموذج سُحب: لن يعود بعد دقيقة، فنعامله كعطل دائم في المفتاح
          err.isKeyProblem = isKeyLevelFailure(res.statusCode, reason) || res.statusCode === 404;
          // نُنحّي المفتاح المعطّل أو المستنفد ليأخذ غيره الدور
          if (err.isKeyProblem) {
            keyEntry.blockedUntil = Date.now() + KEY_PROBLEM_BLOCK_MS;
          } else if (err.isRateLimit) {
            keyEntry.blockedUntil = Date.now() + (provider.rateLimitBlockMs ? provider.rateLimitBlockMs(reason) : RATE_LIMIT_BLOCK_MS);
          }
          return reject(err);
        }

        const choice = json.choices?.[0];
        const content = choice?.message?.content;
        // بعض النماذج تُرجع المحتوى أجزاءً (نص + تفكير) لا نصاً واحداً
        let text = (Array.isArray(content)
          ? content.map(part => (!part?.type || part.type === 'text') ? (part?.text || '') : '').join('')
          : (content || '')).trim();
        if (!text) return reject(new Error(`لم يتم إرجاع أي رد من نموذج ${provider.label}`));

        if (choice?.finish_reason === 'length') {
          console.warn(`[AI/${provider.label}] رد مبتور (MAX_TOKENS)`);
          text += '\n\n(اختصرتُ الإجابة لبلوغ الحد الأقصى — اسألني عن أي جزء تريد تفصيله.)';
        }
        resolve(text.replace(/[�￾￿]/g, ''));
      });
    });

    req.on('timeout', () => { req.destroy(new Error(`انتهت مهلة ${provider.label}`)); });
    req.on('error', reject);
    // إلغاء الطلب حين يفوز مزوّد آخر بالسباق — لا نستهلك حصته بلا فائدة
    if (opts.signal) {
      if (opts.signal.aborted) req.destroy(new Error('CANCELLED'));
      else opts.signal.addEventListener('abort', () => req.destroy(new Error('CANCELLED')), { once: true });
    }
    req.write(body);
    req.end();
  });
}

// =========================================================
// ===== التوجيه حسب حجم الطلب =====
// =========================================================
/* أقصى حجم طلب (مدخلات + مخرجات، بالتوكن) يقبله كل مزوّد في خطته المجانية.
   Groq المجاني يحسب الطلب كله ضمن 8 آلاف توكن في الدقيقة، فطلب "لخّص المادة"
   (حتى 60 ألف حرف) يُرفض عنده حتماً — كنا نرسله ونُبقي الطالب ينتظر فشلاً
   مضموناً. الآن يُستبعد المزوّد الذي لا يتسع للطلب قبل إرساله. */
const PROVIDER_MAX_REQUEST_TOKENS = {
  radox: 120_000,
  nvidia: 120_000,
  zai: 120_000,
  mistral: 120_000,
  gemini: 900_000,
  qwen: 120_000,
  cohere: 240_000,
  groq: Number(process.env.GROQ_MAX_REQUEST_TOKENS) || 8_000,
  groq2: Number(process.env.GROQ_MAX_REQUEST_TOKENS) || 8_000
};

// أقل مساحة رد تستحق تقليص حد المخرجات بدل استبعاد المزوّد
const MIN_USEFUL_OUTPUT_TOKENS = 600;

/* يُغيَّر من البيئة دون تعديل الكود: AI_PROVIDER_ORDER=groq,nvidia,zai,cohere
   الافتراضي (المُختبَر 2026-10-14): Groq للأسئلة القصيرة ويُتخطّى تلقائياً في
   الطويلة ← NVIDIA (الأسرع للطويلة) ← Z.AI (طلب واحد متزامن) ← Cohere (حصته
   التجريبية صغيرة) ← Gemini (مفاتيحه الحالية معطّلة أو مضغوطة) ← Radox (وسيط
   مجهول الجهة: احتياطي أخير) ← غير المضبوطة. */
// قياس 2026-10-22: Groq الأسرع (~1 ث) ثم نموذجه الثاني بحصة منفصلة، NVIDIA (~1.5 ث)، Z.AI الأثبت (17/17)
const DEFAULT_PROVIDER_ORDER = ['groq', 'groq2', 'nvidia', 'zai', 'cohere', 'gemini', 'radox', 'mistral', 'qwen'];

/* تقدير محافظ: المُرمِّزات تقسم العربية إلى توكن لكل حرفين تقريباً
   (الإنجليزية ~4). المبالغة في التقدير أسلم من إرسال طلب سيُرفض. */
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 2);
}

function providerOrder(raw = process.env.AI_PROVIDER_ORDER) {
  const names = String(raw || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(name => name in PROVIDER_MAX_REQUEST_TOKENS);
  return names.length ? [...new Set(names)] : DEFAULT_PROVIDER_ORDER;
}

/** دالة خالصة: المزوّدون الذين سيُجرَّبون بالترتيب، وحد المخرجات لكل منهم. */
function planProviders({ order, configured, inputTokens, maxOutputTokens }) {
  const wanted = maxOutputTokens ?? 2048;
  const plan = [];
  for (const name of order) {
    if (!configured[name]) continue;
    const room = PROVIDER_MAX_REQUEST_TOKENS[name] - inputTokens;
    if (room < MIN_USEFUL_OUTPUT_TOKENS) continue;
    plan.push({ name, maxOutputTokens: Math.min(wanted, room) });
  }
  return plan;
}

const _hasFreeKey = keys => keys.some(k => k.blockedUntil <= Date.now());

const AI_PROVIDERS = {
  radox: {
    keyCount: () => _radoxKeys.length,
    available: () => _hasFreeKey(_radoxKeys),
    call: (prompt, parts, o) => tryEachKey(radoxRequest, _radoxKeys.length, parts.systemPrompt, parts.userPrompt, o)
  },
  nvidia: {
    keyCount: () => _nvidiaKeys.length,
    available: () => _hasFreeKey(_nvidiaKeys),
    call: (prompt, parts, o) => tryEachKey(nvidiaRequest, _nvidiaKeys.length, parts.systemPrompt, parts.userPrompt, o)
  },
  zai: {
    keyCount: () => _zaiKeys.length,
    available: () => _hasFreeKey(_zaiKeys),
    call: (prompt, parts, o) => tryEachKey(zaiRequest, _zaiKeys.length, parts.systemPrompt, parts.userPrompt, o)
  },
  mistral: {
    keyCount: () => _mistralKeys.length,
    available: () => _hasFreeKey(_mistralKeys),
    call: (prompt, parts, o) => tryEachKey(mistralRequest, _mistralKeys.length, parts.systemPrompt, parts.userPrompt, o)
  },
  gemini: {
    keyCount: () => _geminiKeyPool.length,
    available: () => _hasFreeKey(_geminiKeyPool),
    call: (prompt, parts, o) => geminiWithFallback(prompt, o)
  },
  qwen: {
    keyCount: () => _qwenKeys.length,
    available: () => _hasFreeKey(_qwenKeys),
    call: (prompt, parts, o) => tryEachKey(qwenRequest, _qwenKeys.length, parts.systemPrompt, parts.userPrompt, o)
  },
  cohere: {
    keyCount: () => _cohereKeys.length,
    available: () => _hasFreeKey(_cohereKeys),
    call: (prompt, parts, o) => tryEachKey(cohereRequest, _cohereKeys.length, parts.systemPrompt, parts.userPrompt, o)
  },
  groq2: {
    keyCount: () => _groq2Keys.length,
    available: () => _hasFreeKey(_groq2Keys),
    call: (prompt, parts, o) => tryEachKey(groq2Request, _groq2Keys.length, parts.systemPrompt, parts.userPrompt, o)
  },
  groq: {
    keyCount: () => _groqKeys.length,
    available: () => _hasFreeKey(_groqKeys),
    call: (prompt, parts, o) => tryEachKey(groqRequest, _groqKeys.length, parts.systemPrompt, parts.userPrompt, o)
  }
};

function configuredProviders() {
  return Object.fromEntries(Object.entries(AI_PROVIDERS).map(([name, p]) => [name, p.keyCount() > 0]));
}

/**
 * النظام الذكي المدمج: يجرّب المزوّدين بالترتيب (AI_PROVIDER_ORDER، افتراضياً
 * Groq ← NVIDIA ← Z.AI ← Cohere ← Gemini ← Radox ← Mistral ← Qwen) متخطياً من لا مفاتيح له ومن لا يتسع للطلب.
 *
 * أي عطل في مزوّد يحوّل للتالي. كانت قائمة بيضاء من الأعطال (حصة، 5xx، شبكة)
 * فيمرّ عطل مثل 403 "مفتاح موقوف" إلى الطالب كـ"خطأ 500" مع أن غيره سليم.
 * الاستثناء الوحيد حجب المحتوى لأسباب أمان — إعادة المحاولة عند غيره لن تفيد.
 */
async function askAIWithUltimateFallback(prompt, opts = {}) {
  /* نفصل الـ SYSTEM_PROMPT أو JSON_SYSTEM_PROMPT عن سؤال المستخدم لنمرره كـ system role
     مستقل للمزوّدين بصيغة OpenAI — فتُطبَّق شخصية كيدي وقواعده وصيغة JSON بنفس الطريقة
     أياً كان المزوّد. Gemini وحده يأخذ النص الكامل. */
  const parts = extractSystemAndUserPrompts(prompt);
  const configured = configuredProviders();
  const plan = planProviders({
    order: providerOrder(),
    configured,
    inputTokens: estimateTokens(prompt) + estimateTokens(chatHistoryMessages(opts.history).map(m => m.content).join('\n')),
    maxOutputTokens: opts.maxOutputTokens
  });

  if (!plan.length) {
    // مزوّدون مضبوطون لكن الطلب أكبر منهم جميعاً (مثلاً Groq وحده مع "لخّص المادة")
    throw new Error(Object.values(configured).some(Boolean) ? 'PROMPT_TOO_LARGE' : 'ALL_AI_SYSTEMS_DOWN');
  }

  // من حُظرت كل مفاتيحه (حصة/نموذج مسحوب) يُؤخَّر لآخر السلسلة بدل أن يُجرَّب أولاً
  plan.sort((a, b) => Number(!AI_PROVIDERS[a.name].available()) - Number(!AI_PROVIDERS[b.name].available()));
  const inputTokens = estimateTokens(prompt);
  return raceProviders(plan, step => AI_PROVIDERS[step.name].call(prompt, parts, step.opts), {
    budgetMs: opts.budgetMs || AI_TOTAL_BUDGET_MS,
    // الطلبات الطويلة (تلخيص مادة) مكلفة: لا نكررها عند مزوّد ثانٍ إلا بعد انتظار أطول
    hedgeAfterMs: opts.hedgeAfterMs ?? (inputTokens > 6000 ? 25_000 : AI_HEDGE_AFTER_MS),
    baseOpts: opts
  });
}

/* السؤال كله له ميزانية زمنية واحدة، والمزوّدون يتسابقون عليها:
   - كانت السلسلة تجرّب مزوّداً بعد آخر، ولكل منها مهلة 45-60 ث، والواجهة تقطع
     الانتظار قبل ذلك. مزوّد واحد معلّق (Cohere علّق 46 ث على تحية في قياس
     2026-10-22) كان يعني "كيدي ما ردّ" رغم أن التالي سليم وسريع.
   - الآن: فشل مزوّد ← التالي فوراً. وتأخّره عن hedgeAfterMs ← يبدأ التالي
     بالتوازي (اثنان على الأكثر)، وأول رد صحيح يفوز ويُلغى الآخر.
   - مهلة كل طلب = ما تبقّى من الميزانية، فلا يتجاوز السؤال الميزانية أبداً. */
const AI_TOTAL_BUDGET_MS = Number(process.env.AI_TOTAL_BUDGET_MS) || 50_000;
const AI_HEDGE_AFTER_MS = Number(process.env.AI_HEDGE_AFTER_MS) || 9_000;

function raceProviders(plan, callStep, { budgetMs, hedgeAfterMs, baseOpts = {} }) {
  const deadline = Date.now() + budgetMs;
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, done = false, lastErr = null, hedgeTimer = null;
    const controllers = new Set();
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer); clearTimeout(budgetTimer);
      controllers.forEach(c => c.abort());
      fn(value);
    };
    const exhausted = () => {
      console.error(`[AI] فشلت كل المزوّدات: ${plan.map(s => s.name).join(' ← ')}`);
      finish(reject, new Error('ALL_AI_SYSTEMS_DOWN'));
    };
    const budgetTimer = setTimeout(() => {
      console.error(`[AI] انقضت ميزانية السؤال (${budgetMs / 1000} ث) دون رد`);
      finish(reject, new Error('AI_TIMEOUT'));
    }, budgetMs);

    const launch = () => {
      if (done) return;
      if (next >= plan.length) { if (running === 0) exhausted(); return; }
      const remaining = deadline - Date.now();
      if (remaining < 1500) { if (running === 0) finish(reject, new Error('AI_TIMEOUT')); return; }
      const step = plan[next++];
      const ctrl = new AbortController();
      controllers.add(ctrl);
      running++;
      callStep({ ...step, opts: { ...baseOpts, maxOutputTokens: step.maxOutputTokens, timeoutMs: remaining, signal: ctrl.signal } })
        .then(text => finish(resolve, text))
        .catch(err => {
          running--;
          controllers.delete(ctrl);
          if (done) return;
          if (err.message === 'MODEL_SAFETY_BLOCK') return finish(reject, err);
          lastErr = err;
          console.warn(`[AI] فشل ${step.name} (${err.status || err.code || '-'}): ${String(err.message).slice(0, 160)} — تحويل للتالي`);
          launch();
        });
      clearTimeout(hedgeTimer);
      hedgeTimer = setTimeout(() => { if (!done && running < 2) launch(); }, hedgeAfterMs);
    };
    launch();
  });
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
  if (_userThrottle.size > 2000) {
    for (const [uid, r] of _userThrottle.entries()) {
      if (now > r.reset) _userThrottle.delete(uid);
    }
  }
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

/* المواعيد بتوقيت الطلاب لا بتوقيت الخادم: الخادم قد يعمل بـ UTC فتتأخر
   الساعات ساعتين وينقلب تاريخ ما بعد منتصف الليل. */
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Khartoum';

function fmtDateAr(d) {
  if (!d) return 'غير محدد';
  try {
    return new Date(d).toLocaleDateString('ar-EG-u-nu-latn', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: APP_TIMEZONE
    });
  } catch { return 'غير محدد'; }
}

// تاريخ + ساعة: بدون الساعة كان النموذج يستعير موعد الواجب (23:59) للكويز
function fmtDateTimeAr(d) {
  if (!d) return 'غير محدد';
  try {
    const time = new Date(d).toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: APP_TIMEZONE });
    return `${fmtDateAr(d)} الساعة ${time}`;
  } catch { return fmtDateAr(d); }
}

function daysFromNow(d) {
  const diff = new Date(d).getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (days < 0) return 'انتهى';
  if (days === 0) return 'اليوم';
  if (days === 1) return 'غداً';
  return `بعد ${days} يوم`;
}

/* أقسام سياق التطبيق التي يحتاجها كل نوع سؤال. كان السياق كله (مواد، واجبات،
   رسوم، أخبار، إشعارات، دليل الخدمات…) يُرسل مع كل سؤال، حتى "ما هو الـ TCP؟"،
   فينشغل النموذج بالبيانات ويجيب "المعلومة غير موجودة في سياق التطبيق، راجع
   الليدر" عن مفهوم علمي بسيط — وهو أكثر ما جعل كيدي يبدو غبياً. */
const CONTEXT_SECTIONS_BY_INTENT = {
  data:     ['student', 'subjects', 'assignments', 'quizzes', 'events', 'finance', 'pods', 'news', 'notifications', 'services'],
  plan:     ['student', 'subjects', 'assignments', 'quizzes', 'events'],
  support:  ['student', 'assignments', 'quizzes', 'services'],
  chat:     ['student'],
  summary:  ['student'],
  default:  ['student', 'subjects']
};

function renderLiveContext(sections, intent) {
  if (!sections) return '';
  const wanted = CONTEXT_SECTIONS_BY_INTENT[intent] || CONTEXT_SECTIONS_BY_INTENT.default;
  const body = wanted.map(name => sections[name]).filter(Boolean).join('\n\n');
  return `\n[بيانات الطالب من منصة الكلية — المصدر الوحيد لأي معلومة عن مواده ومواعيده ورسومه]\n` +
    `${sections.date}\n\n${body}\n`;
}

async function getLiveStudentContext(userId, activeBatch, intent = 'data') {
  const sections = await getLiveStudentSections(userId, activeBatch);
  return renderLiveContext(sections, intent);
}

async function getLiveStudentSections(userId, activeBatch) {
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
    if (!user) return null;

    const batchId = activeBatch || user.batch?._id || user.batch || (user.batches && user.batches[0]);

    let subjects = [];
    if (batchId) {
      subjects = await Subject.find({ $or: [{ batch: batchId }, { batches: batchId }] }).select('name level _id').lean();
    }
    /* كان هنا رجوع إلى أي 15 مادة في الكلية حين تخلو دفعة الطالب من المواد،
       فيعرض كيدي مواد دفعات أخرى على أنها "موادك". الفراغ يُقال كما هو. */

    const subjectList = subjects.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    let openAssignments = [];
    let upcomingQuizzes = [];
    let leaders = [];

    if (batchId) {
      // التفاصيل الفعلية للواجبات وليس عددها فقط — بدونها كان المساعد
      // عاجزاً عن الإجابة على «متى تسليم الواجب؟» رغم امتلاك النظام للبيانات.
      /* dueDate تاريخ بلا ساعة (منتصف الليل UTC) والموعد الفعلي في dueTime.
         مقارنته بـ"الآن" كانت تُسقط واجب الليلة من بيانات كيدي بعد الثانية
         فجراً — أي يوم التسليم نفسه حين يسأل الطالب عنه أكثر. */
      const { resolveDueDateTime } = require('../utils/dueDate');
      const nowTs = Date.now();
      openAssignments = (await Assignment.find({
        batches: batchId,
        dueDate: { $gte: new Date(nowTs - 36 * 3600 * 1000) }
      }).select('title dueDate dueTime subject').populate('subject', 'name')
        .sort({ dueDate: 1 }).limit(12).lean())
        .filter(a => (resolveDueDateTime(a)?.getTime() ?? 0) > nowTs)
        .slice(0, 8);

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
          `- «${qz.title}» (مادة ${qz.subject?.name || 'غير محددة'}) — يُفتح ${fmtDateTimeAr(qz.startsAt)} ويُغلق ${fmtDateTimeAr(qz.endsAt)}، مدة الحل ${qz.durationMinutes} دقيقة [${daysFromNow(qz.startsAt)}]`
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
        startsAt: { $gte: new Date() }
      }).sort({ startsAt: 1 }).limit(4).lean();
      if (upcomingEvents.length > 0) {
        eventsList = upcomingEvents.map(ev => `- «${ev.title}» (${fmtDateTimeAr(ev.startsAt)}${ev.location ? ` — ${ev.location}` : ''}): ${ev.description || 'فعالية أكاديمية'}`).join('\n');
      }
    } catch (eve) {}

    // جلب الملخص المالي للطالب
    let financeSummary = 'لا توجد مستحقات مالية مسجلة';
    try {
      /* كان الاستعلام يجمع رسوم الدفعة كلها ({batch}) لا رسوم الطالب، ويتجاهل
         الخصم، ويفلتر المدفوعات بحقل status غير موجود في نموذج الدفع فيكون
         المسدد صفراً دائماً — فيخبر كيدي الطالب بمبلغ مضاعف لا يطابق صفحة
         الرسوم. نستخدم نفس دالة صفحة الرسوم ليتطابق الرقمان. */
      const { getStudentBalanceSummary } = require('../utils/feeAllocation');
      const s = await getStudentBalanceSummary(userId);
      if (s.fees.length > 0) {
        const fmt = n => Number(n || 0).toLocaleString('en-US');
        financeSummary = `إجمالي الرسوم: ${fmt(s.totalFees)} ج.س | المسدد: ${fmt(s.totalPaid)} ج.س | المتبقي المطلوب: ${s.balance > 0 ? fmt(s.balance) + ' ج.س' : 'خالص السداد بالكامل'}`;
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

    /* أقسام مستقلة تُختار حسب نوع السؤال (renderLiveContext). أُزيلت الرموز
       التعبيرية من دليل الخدمات (تفضيل المستخدم: لا emoji) وبيانات المطوّر
       (موجودة في موجّه النظام لمن يسأل عنها فقط). */
    const sections = {
      date: `[التاريخ] اليوم ${fmtDateAr(new Date())}. احسب منه كل المدد المتبقية.`,
      student: `[الطالب] ${user.name || 'طالب'} — ${user.batch?.name || 'الدفعة غير محددة'} — ليدر/مندوب الدفعة: ${leadersNames}`,
      subjects: `[المواد المسجّلة (${subjects.length})]\n${subjectList || 'لا توجد مواد مرفوعة'}`,
      assignments: `[الواجبات المفتوحة للتسليم]\n${assignmentsList}`,
      quizzes: `[الاختبارات والكويزات القادمة]\n${quizzesList}`,
      events: `[الفعاليات والتقويم الأكاديمي]\n${eventsList}`,
      finance: `[الوضع المالي]\n${financeSummary}`,
      pods: `[مجموعات المذاكرة النشطة]\n${studyPodsList}`,
      news: `[أحدث أخبار الكلية]\n${newsList}`,
      notifications: `[أحدث الإشعارات]\n${notifsList}`,
      services: `[صفحات المنصة التي يمكن إرشاد الطالب إليها]
- مختبر الأكواد Code Lab (/code-lab.html): كتابة وتشغيل وتصحيح الأكواد
- بطاقات الاستذكار Flashcards (/flashcards.html)
- بنك الامتحانات السابقة (/past-exams.html)
- غرف المذاكرة Study Pods (/study-pods.html)
- الكويزات (/quizzes.html) · لوحة المتصدرين (/leaderboard.html)
- مكتبة الفيديو (/video-library.html) · التقويم والجدول (/calendar.html)
- الرسوم والمدفوعات (/financials.html) · تقييم المقررات (/course-surveys.html)`
    };
    _ctxCacheSet(cacheKey, sections);
    return sections;
  } catch (e) {
    console.warn('[AI/context]', e.message);
    return null;
  }
}

/* تنظيف نهائي لرد كيدي: النماذج لا تلتزم دائماً بـ "لا رموز تعبيرية ولا خطوط
   فاصلة" (ظهر ❌ و --- في تصحيح الكويز رغم التعليمة). علامتا الصح والخطأ تصيران
   كلمتين، وبقية الرموز تُحذف، وأسطر --- / *** تُزال لأنها تظهر كما هي على الشاشة.
   الأكواد داخل ``` لا تُمس. */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

/* بعض النماذج تكتب جدول Markdown رغم التعليمة (ظهر في تصحيح الكويز عند Groq
   2026-10-24)، والجدول لا يُعرض في فقاعة المحادثة فيظهر خطوطاً و|. نحوّله
   قائمة نقاط: لكل صف سطر "العمود: القيمة — العمود: القيمة". */
function tablesToLists(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const isRow = l => /^\s*\|.*\|\s*$/.test(l || '');
    const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');
    if (isRow(lines[i]) && isSep(lines[i + 1])) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(lines[i]);
      i += 2;
      while (i < lines.length && isRow(lines[i])) {
        const row = cells(lines[i]);
        out.push('- ' + row.map((v, k) => (head[k] ? `${head[k]}: ${v}` : v)).filter(Boolean).join(' — '));
        i++;
      }
      i--;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

function sanitizeAnswer(text) {
  if (!text) return text;
  return String(text)
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part; // كتلة كود
      return tablesToLists(part)
        .replace(/[✅✔☑]️?/g, 'صح')
        .replace(/[❌✖✗✘]️?/g, 'خطأ')
        // الرمز كان بجوار الكلمة نفسها: "✅ صحيح" ← "صح صحيح"
        .replace(/صح\s+(صحيح|صحيحة|صح)(?=[\s.,،:]|$)/g, '$1')
        .replace(/خطأ\s+(خطأ|خاطئ|خاطئة)(?=[\s.,،:]|$)/g, '$1')
        .replace(EMOJI_RE, '')
        .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, '')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n');
    })
    .join('')
    .trim();
}

function errMsg(err, fallback) {
  if (err?.message === 'RATE_LIMIT_ALL_KEYS' || err?.message === 'ALL_AI_SYSTEMS_DOWN') {
    return 'السيرفر يواجه ضغطاً كبيراً، يرجى المحاولة بعد دقيقة';
  }
  if (err?.message === 'AI_TIMEOUT') {
    return 'كيدي اتأخر في الرد هذه المرة، أعد إرسال سؤالك';
  }
  if (err?.message === 'PROMPT_TOO_LARGE') {
    return 'المحتوى أطول مما يستطيع المساعد معالجته حالياً، جرّب محاضرة واحدة بدل المادة كاملة';
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
    // ترتيب التجربة الفعلي (AI_PROVIDER_ORDER) وحالة كل مزوّد فيه
    providerOrder: providerOrder(),
    fallbackAvailable: Object.values(configuredProviders()).filter(Boolean).length > 1,
    providers: providerOrder().map(name => ({
      provider: name,
      model: { radox: RADOX_MODEL, nvidia: NVIDIA_MODEL, zai: ZAI_MODEL, mistral: MISTRAL_MODEL, gemini: GEMINI_MODEL, qwen: QWEN_MODEL, cohere: COHERE_MODEL, groq: GROQ_MODEL, groq2: GROQ_MODEL_2 }[name],
      configured: AI_PROVIDERS[name].keyCount() > 0,
      keysConfigured: AI_PROVIDERS[name].keyCount(),
      maxRequestTokens: PROVIDER_MAX_REQUEST_TOKENS[name]
    }))
  });
});

const SYSTEM_PROMPT = `أنت "كيدي" (Kedy)، المستشار والمساعد الأكاديمي والتقني الذكي لطلاب كلية النصر التقنية — جامعة النصر التقنية.
طوّرك المهندس ضياء الدين (0112046348 | diaakardmash@gmail.com). لا تذكر بيانات المطور إلا إذا سُئلت عنها صراحة.

مهمتك: أن يفهم الطالب ويتقدّم في دراسته — لا أن تبهره. طلاب الكلية يدرسون علوم الحاسوب وتقنية المعلومات (برمجة، هياكل بيانات وخوارزميات، قواعد بيانات، شبكات وأمن معلومات، نظم تشغيل، هندسة برمجيات، ذكاء اصطناعي، ويب وتطبيقات هاتف) في السودان.

## اللغة والأسلوب
- اكتب بعربية واضحة بسيطة. إن كتب الطالب بالعامية السودانية فرد بعربية سهلة قريبة منه، ولا بأس بلمسة سودانية خفيفة ودودة. لا تكتب بالإنجليزية إلا إن طلبها.
- المصطلح التقني بالإنجليزية بين قوسين أول مرة فقط، مثل: المفتاح الأساسي (Primary Key).
- لا رموز تعبيرية (emoji) إطلاقاً. لا تكرر سؤال الطالب، ولا تبدأ بـ "سؤال رائع"، ولا تختم بفقرة عروض مساعدة.
- الرد يُقرأ على شاشة هاتف: فقرات قصيرة، نقاط عند التعداد، عناوين فقط في الشروح الطويلة، والأكواد داخل \`\`\` مع اسم اللغة.
- لا جداول Markdown ولا خطوط فاصلة (---): لا تظهر على شاشة المحادثة. للمقارنة أو التصحيح استخدم قائمة نقاط.

## الطول
- طلب الطالب الصريح للطول ("باختصار"، "في جملتين"، "بالتفصيل") يتقدّم على أي تعليمة أخرى.
- وإلا فطول الرد بقدر السؤال: سؤال بسيط = إجابة قصيرة. القالب الأكاديمي الطويل للشرح المطلوب فقط.

## الصدق ومصادر المعلومات
- المفاهيم العلمية والبرمجية: أجب من معرفتك مباشرة. لا تقل أبداً إن مفهوماً علمياً "غير موجود في البيانات" ولا تحيل الطالب لليدر في سؤال علمي.
- بيانات الطالب (مواده، واجباته، كويزاته، رسومه، الإشعارات): من قسم "بيانات الطالب من منصة الكلية" وحده. لا تخترع موعداً أو رقماً أو درجة. إن لم تكن المعلومة هناك فقل إنها غير مسجلة على المنصة بعد، واقترح الليدر/المندوب للأمور الإدارية فقط.
- لا تذكر للطالب كلمات مثل "السياق" أو "التعليمات" أو "قاعدة البيانات الداخلية" — تحدث كمساعد يعرف بياناته.
- إن لم تكن متأكداً من معلومة علمية فقل ذلك بوضوح بدل التخمين.
- محتوى المحاضرة المرفق إن وُجد هو المرجع الأول، واذكر أنه "حسب محاضرتكم" حين تستند إليه.

## التعلّم قبل الإجابات الجاهزة
- في المسائل والتمارين: اشرح طريقة التفكير والخطوات، لا الناتج وحده.
- إن طلب الطالب حل واجب مُقيَّم بعينه من واجباته المفتوحة ليسلّمه كما هو، فساعده بالفهم والخطة والهيكل وأمثلة مشابهة، لا بعمل جاهز للتسليم — بلطف ودون وعظ.

## المحادثة
- استخدم سجل المحادثة: "مثال تاني"، "وضح أكتر"، "ليه؟" تعود إلى آخر موضوع. لا تُعد ما قلته؛ أضف الجديد.
- إن كان الطالب متضايقاً أو قلقاً: اعترف بشعوره في جملة صادقة، ثم أعطه خطوة عملية صغيرة يبدأ بها الآن.
- الأسئلة البعيدة عن الدراسة: سطر ودود قصير ثم أعد الحديث بلطف إلى ما يفيده دراسياً.`;

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
  // تحية أو دردشة قصيرة
  chat:    { maxOutputTokens: THINKING_HEADROOM + 200,  temperature: 0.6,
             directive: 'رد بسطر أو سطرين ودودين باسم الطالب، ويمكنك أن تسأله بماذا يذاكر اليوم.' },
  // استعلام عن بياناته على المنصة: مواعيد، أعداد، رسوم، إشعارات
  data:    { maxOutputTokens: THINKING_HEADROOM + 400,  temperature: 0.2,
             directive: 'أجب مباشرة من بيانات الطالب في جملة إلى ثلاث جمل: الإجابة أولاً ثم التفصيل المفيد (الموعد، كم يوماً تبقّى). لا تعريفات عامة ولا عناوين. إن لم تكن المعلومة مسجلة فقل ذلك بوضوح.' },
  // تعريف مصطلح أو سؤال مفهوم قصير
  define:  { maxOutputTokens: THINKING_HEADROOM + 800,  temperature: 0.3,
             directive: 'عرّف المفهوم من معرفتك في 2-4 أسطر واضحة، ثم مثال واحد قصير من عالم الحاسوب. بلا عناوين. (إن كان السؤال بعيداً عن الدراسة كالرياضة أو الفن: أجب بسطر ودود قصير فقط ثم اقترح بلطف شيئاً دراسياً، وتجاهل هذا الشكل.)' },
  // حل مسألة
  solve:   { maxOutputTokens: THINKING_HEADROOM + 1800, temperature: 0.2,
             directive: 'اشرح فكرة الحل في سطر، ثم الخطوات مرقّمة بإيجاز، ثم الناتج النهائي في سطر مستقل بخط عريض.' },
  // كتابة كود أو تصحيح خطأ برمجي
  code:    { maxOutputTokens: THINKING_HEADROOM + 2400, temperature: 0.2,
             directive: 'إن طُلب كود: سطر عن الفكرة، ثم الكود كاملاً قابلاً للتشغيل بتعليقات عربية قصيرة، ثم التعقيد الزمني والمكاني في سطر. إن كان خطأً برمجياً: السبب الأرجح أولاً بلغة بسيطة، ثم كيف يتأكد منه، ثم الإصلاح بكود قصير، ثم سبب ثانٍ محتمل إن وُجد. إن كان الكود الضروري للتشخيص غير مرفق فاطلبه في سطر بعد ذكر الأسباب الشائعة. بلا تشبيهات.' },
  // أسئلة الامتحانات المتوقعة والمراجعة
  exam:    { maxOutputTokens: THINKING_HEADROOM + 2400, temperature: 0.4,
             directive: 'رتّب أهم المواضيع المتوقعة في الامتحان، ولكل موضوع سؤال نموذجي مع إجابة مختصرة، ثم "فخاخ شائعة" في نقطتين أو ثلاث.' },
  // اختبار الطالب تفاعلياً
  quiz:    { maxOutputTokens: THINKING_HEADROOM + 1400, temperature: 0.5,
             directive: 'اختبر الطالب: اكتب 3 أسئلة اختيار من متعدد مرقّمة (أ، ب، ج، د) متدرجة من السهل للأصعب في الموضوع المطلوب. لا تكشف الإجابات. اختم بسطر: "أرسل إجاباتك (مثلاً: 1-ب، 2-أ، 3-ج) وسأصححها لك."' },
  // خطة مذاكرة من مواعيده الحقيقية
  plan:    { maxOutputTokens: THINKING_HEADROOM + 1000, temperature: 0.4,
             directive: 'ابنِ خطة قصيرة من مواعيده الحقيقية: رتّب حسب الأقرب موعداً، 3-5 خطوات بوقت تقريبي لكل خطوة، وابدأ بالأهم الآن. إن لم تكن لديه مواعيد قريبة فاقترح مراجعة متوازنة لمواده.' },
  // ضيق أو قلق أو إرهاق
  support: { maxOutputTokens: THINKING_HEADROOM + 700,  temperature: 0.6,
             directive: 'ابدأ بجملة صادقة تعترف بشعوره دون مبالغة، ثم خطة صغيرة من 2-3 خطوات عملية يبدأ بها الليلة مبنية على أقرب مواعيده، ثم جملة تشجيع قصيرة. لا تحيله لأحد.' },
  // متابعة لما قبلها في المحادثة
  followup:{ maxOutputTokens: THINKING_HEADROOM + 1600, temperature: 0.4,
             directive: 'هذه متابعة لآخر رد لك في المحادثة. نفّذ المطلوب تحديداً: مثال جديد مختلف، أو تبسيط، أو تفصيل، أو تصحيح إجابات الكويز (لكل سؤال: صح/خطأ مع سطر تصحيح، ثم النتيجة من 3، ثم اعرض جولة أصعب). لا تُعد التعريف السابق.' },
  // شرح مفهوم — القالب المنظم للطلب الصريح فقط
  explain: { maxOutputTokens: THINKING_HEADROOM + 2600, temperature: 0.4,
             directive: 'اشرح بوضوح متدرج: الفكرة الأساسية في سطرين، ثم النقاط المهمة مرقّمة، ثم مثال واحد ملموس، ثم "للامتحان:" في نقطة أو نقطتين. احذف أي جزء لا يضيف قيمة. لا تتجاوز 350 كلمة.' },
};

const LENGTH_DIRECTIVES = {
  brief: 'الطالب طلب الاختصار: التزم بذلك حرفياً (جملة إلى ثلاث جمل)، بلا عناوين ولا أمثلة إضافية.',
  detailed: 'الطالب طلب التفصيل: توسّع حتى 600 كلمة مع عناوين قصيرة وأمثلة.'
};

/* رسالة /ask كاملة — دالة واحدة يستخدمها المسار وسكربت تقييم النماذج،
   فما يُقاس في التقييم هو حرفياً ما يصل للنموذج في الإنتاج. */
function buildAskPrompt({ q, liveContext = '', studyBlock = '', mode, lengthDirective = '' }) {
  return `${SYSTEM_PROMPT}\n${liveContext}${studyBlock}\n` +
    `[رسالة الطالب]\n${q}\n\n` +
    `[طريقة هذا الرد]\n${mode.directive}${lengthDirective ? `\n${lengthDirective}` : ''}`;
}

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

/* ═══ تصنيف السؤال ═══
   كان التصنيف يبحث عن أجزاء كلمات: "كم" تطابق "التحكم" و"الكمبيوتر"، و"حل "
   تطابق "مراحل " — فيُصنَّف "ما هو التحكم في التدفق؟" سؤالاً عن بيانات الطالب
   ويرد كيدي "المعلومة غير موجودة، راجع الليدر". الآن نطابق كلمات كاملة بعد
   تطبيع العربية ونزع السوابق (و، ف، ب، ل، ال…). العلامة * في آخر المؤشر تعني
   "تبدأ الكلمة بهذا"، والمؤشر متعدد الكلمات يُطابق كعبارة. */
const AR_PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ل'];

function normForIntent(s) {
  return normalizeAIText(s)
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[«»"'()\[\]{}،؛]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function intentMatcher(question) {
  const text = ` ${normForIntent(question)} `;
  const tokens = text.trim().split(' ').filter(Boolean);
  const variants = tokens.map(tok => {
    const v = new Set([tok]);
    for (const p of AR_PREFIXES) if (tok.startsWith(p) && tok.length - p.length >= 2) v.add(tok.slice(p.length));
    return [...v];
  });
  const matchOne = raw => {
    const prefix = raw.endsWith('*');
    const cue = normForIntent(prefix ? raw.slice(0, -1) : raw);
    if (!cue) return false;
    if (cue.includes(' ')) return text.includes(` ${cue}`);
    return variants.some(vs => vs.some(v => (prefix ? v.startsWith(cue) : v === cue)));
  };
  return { has: cues => cues.some(matchOne), tokens, text };
}

const INTENT_CUES = {
  greet:   ['سلام', 'هاي', 'هلا', 'هلو', 'مرحبا', 'اهلا', 'صباح', 'مساء', 'شكرا', 'تسلم', 'تمام', 'اوك', 'ok', 'hi', 'hello', 'hey', 'thanks', 'كيفك', 'كيف حالك', 'ازيك', 'عامل كيف', 'الحمدلله'],
  support: ['تعبان', 'تعبت', 'زهجان', 'زهجت', 'زهقت', 'مضغوط', 'ضغط نفسي', 'خايف', 'خائف', 'قلقان', 'محبط', 'احباط', 'يائس', 'فاشل', 'ما فاهم حاجه', 'مافاهم حاجه', 'ما فاهم شي', 'ما قادر', 'مكتئب', 'ضايق', 'متوتر'],
  exam:    ['متوقع*', 'توقعات', 'مراجعه', 'راجع معي', 'ذاكر معي', 'حاجات الامتحان', 'يجي في الامتحان', 'تجي في الامتحان', 'للامتحان', 'اهم مواضيع', 'اهم المواضيع', 'اهم النقاط', 'اسئله الامتحان', 'اسئله امتحان'],
  quiz:    ['اختبرني', 'امتحني', 'سالني', 'اسالني', 'اختبر معلوماتي', 'قيم مستواي', 'quiz me', 'test me', 'اعمل لي اسئله', 'اديني اسئله', 'اعطني اسئله', 'جيب لي اسئله'],
  codeErr: ['error', 'exception', 'traceback', 'bug', 'typeerror', 'syntaxerror', 'referenceerror', 'nullpointerexception', 'segmentation', 'undefined', 'خطا في الكود', 'الكود ما', 'مشكله في الكود', 'صحح الكود', 'صحح لي الكود'],
  codeObj: ['كود', 'code', 'برنامج', 'دالة', 'داله', 'function', 'script', 'سكربت'],
  codeAct: ['اكتب*', 'اعمل', 'سوي', 'برمج*', 'نفذ', 'implement', 'write', 'صحح*'],
  plan:    ['اذاكر', 'نذاكر', 'ابدا ب*', 'خطه مذاكره', 'خطه للمذاكره', 'جدول مذاكره', 'رتب لي', 'نظم لي', 'اولويات', 'اعمل شنو', 'شنو اسوي'],
  dataDirect: ['موادي', 'واجباتي', 'رسومي', 'دفعتي', 'اشعاراتي', 'الليدر', 'ليدر', 'المندوب', 'مندوب', 'اخر الاخبار', 'اخر خبر', 'جدولي', 'حضوري', 'غيابي', 'درجاتي', 'نتيجتي'],
  dataNoun: ['واجب*', 'تسليم', 'كويز*', 'اختبار*', 'امتحان*', 'ماده', 'مواد', 'رسوم', 'قسط', 'اقساط', 'متبقي', 'مستحقات', 'اشعار*', 'تنبيه*', 'خبر', 'اخبار', 'محاضره*', 'جدول', 'فعاليه*', 'حضور', 'غياب'],
  dataAsk: ['كم', 'متى', 'متين', 'امتى', 'وين', 'منو', 'قريب', 'قادم', 'الجاي', 'بكره', 'اليوم', 'الاسبوع', 'باقي', 'عندي'],
  solve:   ['احسب', 'اوجد', 'برهن', 'اثبت', 'كم يساوي', 'ناتج', 'حل المساله', 'حل السؤال', 'حل التمرين', 'حل المعادله', 'حل لي', 'استنتج قيمه'],
  explain: ['اشرح*', 'شرح', 'وضح*', 'فهمني', 'فسر*', 'الفرق بين', 'ما الفرق', 'ليش', 'ليه', 'لماذا', 'كيف يعمل', 'كيف تعمل', 'كيف اعمل', 'كيف اكتب', 'قارن', 'مقارنه', 'مراحل', 'خطوات', 'انواع', 'مميزات', 'عيوب'],
  define:  ['ما هو', 'ما هي', 'ماهو', 'ماهي', 'شنو', 'ايش', 'وش', 'تعريف', 'عرف', 'ماذا يعني', 'معنى', 'يعني شنو', 'يعني ايه'],
  followup:['مثال', 'تاني', 'ثاني', 'اخر', 'كمان', 'زياده', 'اكتر', 'اكثر', 'بسط', 'ابسط', 'ما فهمت', 'مافهمت', 'ليه', 'ليش', 'طيب', 'كمل', 'واصل', 'وبعدين', 'يعني', 'صح', 'غلط'],
  brief:   ['باختصار', 'مختصر', 'مختصره', 'بسرعه', 'في جمله', 'في جملتين', 'جمله واحده', 'جمله وحده', 'في سطر', 'في سطرين', 'سطر واحد', 'بايجاز', 'briefly'],
  detailed:['بالتفصيل', 'مفصل', 'مفصله', 'تفصيلي', 'شرح كامل', 'شرح وافي', 'بعمق']
};

const CODE_SYNTAX_RE = /```|\b(def|class|function|const|let|var|import|printf|cout|cin|public static|SELECT|INSERT)\b|=>|\);|\{\s*$/m;

/**
 * يصنّف سؤال الطالب: { intent, brief, detailed }.
 * hasHistory: توجد محادثة سابقة. lastAssistant: نص آخر رد لكيدي (لتصحيح الكويز).
 */
function analyzeQuestion(question, { hasStudyContext = false, hasHistory = false, lastAssistant = '' } = {}) {
  const q = (question || '').trim();
  const m = intentMatcher(q);
  const brief = m.has(INTENT_CUES.brief);
  const detailed = !brief && m.has(INTENT_CUES.detailed);
  const result = intent => ({ intent, brief, detailed });

  // رد على كويز سابق → تصحيح
  if (hasHistory && /سأصححها لك|وسأصححها/.test(lastAssistant) && q.length <= 200) return result('followup');

  if (q.length <= 35 && m.has(INTENT_CUES.greet) && !m.has(INTENT_CUES.explain) && !m.has(INTENT_CUES.define)) return result('chat');
  if (m.has(INTENT_CUES.support)) return result('support');
  if (m.has(INTENT_CUES.exam)) return result('exam');
  if (m.has(INTENT_CUES.quiz)) return result('quiz');
  if (m.has(INTENT_CUES.codeErr) || CODE_SYNTAX_RE.test(q) || (m.has(INTENT_CUES.codeObj) && m.has(INTENT_CUES.codeAct))) return result('code');
  if (m.has(INTENT_CUES.plan)) return result('plan');
  if (m.has(INTENT_CUES.dataDirect) || (m.has(INTENT_CUES.dataNoun) && m.has(INTENT_CUES.dataAsk) && !hasStudyContext)) return result('data');
  if (m.has(INTENT_CUES.solve) || m.tokens[0] === 'حل') return result('solve');

  // متابعة قصيرة لموضوع سابق: "مثال تاني"، "ليه؟"، "وضح أكتر"
  if (hasHistory && q.length <= 40 && m.has(INTENT_CUES.followup)) return result('followup');

  if (m.has(INTENT_CUES.explain)) return result(brief ? 'define' : 'explain');
  if (m.has(INTENT_CUES.define)) return result(detailed ? 'explain' : 'define');
  if (m.has(INTENT_CUES.dataNoun) && !hasStudyContext && q.length < 40) return result('data');
  if (hasHistory && q.length <= 25) return result('followup');

  // سؤال قصير بلا مؤشرات → لا تُطل
  if (q.length < 40) return result(detailed ? 'explain' : 'define');
  return result(brief ? 'define' : 'explain');
}

// واجهة قديمة تُرجع اسم النية فقط (تستخدمها الاختبارات)
function detectIntent(question, hasStudyContext, opts = {}) {
  return analyzeQuestion(question, { hasStudyContext, ...opts }).intent;
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
    const liveContext = await getLiveStudentContext(req.user.id, req.activeBatch, 'summary');
    const content = (text && text.trim().length >= 10) ? text.slice(0, 12000) : `الموضوع: ${lectureTitle || 'المحاضرة'} - المادة: ${subjectTitle || 'المادة الأكاديمية'}`;
    
    const prompt = `${SYSTEM_PROMPT}\n${liveContext}\n\n[المطلوب]\nلخّص المحتوى التالي تلخيصاً أكاديمياً مركّزاً بالعربية.\nالتزم بـ: عناوين قصيرة بخط عريض، نقاط مرقّمة، وجملة واحدة لكل نقطة.\nلا تتجاوز 400 كلمة، ولا تضف مقدمة أو خاتمة أو عروض مساعدة.\nإن كان المحتوى المرفق ضئيلاً أو مجرد عنوان، قل ذلك بصراحة بدل تأليف ملخص من عندك.\n\n[المحتوى]\n${content}`;
    const summary = sanitizeAnswer(await askAIWithUltimateFallback(prompt, { maxOutputTokens: 1400, temperature: 0.3 }));
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
      // لا رجوع إلى مواد الكلية كلها: الطالب يختار من مواد دفعته فقط

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

    // سجل المحادثة يُرسل كأدوار حقيقية للمزوّد (chatHistoryMessages)، لا كنص ملصوق
    const historyMessages = chatHistoryMessages(history);
    const lastAssistant = [...historyMessages].reverse().find(m => m.role === 'assistant')?.content || '';

    const studyContext = (text && text.trim().length >= 10)
      ? text.slice(0, 10000)
      : (subjectTitle || lectureTitle ? `المادة: ${subjectTitle || ''} · المحاضرة: ${lectureTitle || ''}` : '');

    const hasStudyContext = !!(text && text.trim().length >= 10);
    const analysis = analyzeQuestion(q, { hasStudyContext, hasHistory: historyMessages.length > 0, lastAssistant });
    const mode = INTENT_MODES[analysis.intent] || INTENT_MODES.explain;
    const lengthDirective = analysis.brief ? LENGTH_DIRECTIVES.brief : analysis.detailed ? LENGTH_DIRECTIVES.detailed : '';

    // سياق المنصة بقدر ما يحتاجه نوع السؤال فقط (CONTEXT_SECTIONS_BY_INTENT)
    const liveContext = await getLiveStudentContext(req.user.id, req.activeBatch, analysis.intent);

    const studyBlock = studyContext
      ? `\n[محتوى المادة/المحاضرة المرفق — المرجع الأول للإجابة]\n${studyContext}\n`
      : '';

    const prompt = buildAskPrompt({ q, liveContext, studyBlock, mode, lengthDirective });

    let answer = sanitizeAnswer(await askAIWithUltimateFallback(prompt, {
      maxOutputTokens: mode.maxOutputTokens,
      temperature: mode.temperature,
      history: historyMessages
    }));
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

    /* صلاحية النشر تُفحص قبل التوليد: لا نستهلك حصة الذكاء الاصطناعي على طلب
       سيُرفض، والرفض حتمي لا يتوقف على نجاح المزوّد. */
    let targetBatch = null;
    if (saveDirectly) {
      const mongoose = require('mongoose');
      const User = require('../models/User');
      const Subject = require('../models/Subject');
      const user = await User.findById(req.user.id).select('roles batches').lean();
      // الليدر مستبعد كما في POST /api/quizzes: يؤدّي الاختبارات بنفسه
      const isDeanLevel = ['dean', 'admin'].some(r => user?.roles?.includes(r));
      const isDoctor = user?.roles?.includes('doctor');
      if (!isDeanLevel && !isDoctor) {
        return res.status(403).json({ success: false, message: 'نشر الاختبارات متاح لأساتذة المقررات والعمادة فقط' });
      }
      if (!subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
        return res.status(400).json({ success: false, message: 'اختر المادة لنشر الاختبار' });
      }
      const subject = await Subject.findById(subjectId).select('doctor batches').lean();
      if (!subject) return res.status(404).json({ success: false, message: 'المادة غير موجودة' });
      if (!isDeanLevel && String(subject.doctor) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'غير مصرح لك بنشر اختبار لمادة لا تدرّسها' });
      }
      /* الدفعة إلزامية في نموذج الاختبار، والواجهة لا ترسلها في الجسم — فكان
         الحفظ يفشل دائماً بخطأ تحقق. نأخذها من الجسم أو ترويسة الدفعة النشطة،
         ونتحقق أنها من دفعات المادة (ومن دفعات الدكتور). */
      const subjectBatches = (subject.batches || []).map(String);
      targetBatch = batchId || req.headers['x-batch-id'] || null;
      if (!targetBatch && subjectBatches.length === 1) targetBatch = subjectBatches[0];
      if (!targetBatch || !mongoose.Types.ObjectId.isValid(targetBatch) || !subjectBatches.includes(String(targetBatch))) {
        return res.status(400).json({ success: false, message: 'حدد دفعة تابعة لهذه المادة لنشر الاختبار' });
      }
      if (!isDeanLevel && !(user.batches || []).map(String).includes(String(targetBatch))) {
        return res.status(403).json({ success: false, message: 'هذه الدفعة غير مخصصة لك' });
      }
    }

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
    let usedFallback = false;
    try {
      const rawAI = await askAIWithUltimateFallback(prompt, { maxOutputTokens: 2800, temperature: 0.4 });
      questions = parseJsonArray(rawAI);
    } catch (aiErr) {
      usedFallback = true;
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
      /* أسئلة الطوارئ عامة (TCP مثلاً) ولا علاقة لها بالمحتوى — كانت تُنشر
         للطلاب كاختبار حقيقي عند تعطل مزوّد الذكاء الاصطناعي. لا ننشرها. */
      if (usedFallback) {
        return res.status(503).json({ success: false, message: 'تعذّر الاتصال بالمساعد الذكي الآن — لم يُنشر أي اختبار. حاول بعد قليل.' });
      }
      const Quiz = require('../models/Quiz');
      const formattedQuestions = questions.map(q => ({
        text: q.question,
        options: q.options,
        correctOption: q.correct,
        points: 1
      }));
      const duration = Math.min(600, Math.max(1, parseInt(durationMinutes, 10) || 15));

      const now = new Date();
      savedQuiz = await Quiz.create({
        title: String(quizTitle || `اختبار ذكي - ${subjectTitle || 'المادة'}`).slice(0, 160),
        subject: subjectId,
        batch: targetBatch,
        startsAt: now,
        endsAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        durationMinutes: duration,
        questions: formattedQuestions,
        published: true,
        createdBy: req.user.id
      });
    }

    res.json({
      success: true,
      questions,
      savedQuiz,
      usedFallback,
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
router.post('/run-cpp', auth, aiLimiter, async (req, res) => {
  try {
    const { code = '', stdin = '' } = req.body;
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ success: false, message: 'الكود البرمجي مطلوب للتنفيذ' });
    }
    if (code.length > 50000 || (stdin && stdin.length > 10000)) {
      return res.status(400).json({ success: false, message: 'تجاوز الكود أو المدخلات الحد الأقصى المسموح به' });
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
  normalizeQuizItems,
  analyzeQuestion,
  sanitizeAnswer,
  chatHistoryMessages,
  renderLiveContext,
  estimateTokens,
  providerOrder,
  planProviders,
  isKeyLevelFailure,
  PROVIDER_MAX_REQUEST_TOKENS,
  // لتقييم النماذج (scripts/eval-kedy.js) — تستدعي الشبكة
  buildAskPrompt,
  LENGTH_DIRECTIVES,
  AI_PROVIDERS,
  configuredProviders,
  askAIWithUltimateFallback,
  getLiveStudentSections,
  raceProviders
};
