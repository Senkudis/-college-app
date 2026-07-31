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

// =========================================================
// ===== إعداد مجمع مفاتيح Gemini =====
// =========================================================
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
  console.warn(`[AI] 🔒 مفتاح Gemini ...${keyObj.key.slice(-6)} محظور ${Math.round(ms/1000)}ث`);
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
            const err = new Error(json.error.message || 'Gemini API error');
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
        console.log(`[AI] 🔄 تحويل لمفتاح Gemini آخر... (${attempt + 2}/${maxTries})`);
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

function cohereRequest(systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const cohereKey = process.env.COHERE_API_KEY;
    if (!cohereKey) return reject(new Error('NO_COHERE_KEY'));

    console.log(`[AI] 🚀 تفعيل الخطة الاحتياطية (Cohere ${COHERE_MODEL})...`);
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
            return reject(new Error(json.message || json.error || `Cohere API error ${res.statusCode}`));
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
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function groqRequest(systemPrompt, userPrompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return reject(new Error('NO_GROQ_KEY'));

    console.log(`[AI] 🚀 تفعيل الخطة الاحتياطية الأخيرة (Groq - ${GROQ_MODEL})...`);
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
            return reject(new Error(json.error?.message || 'Groq API error'));
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

/**
 * النظام الذكي المدمج (Gemini بكل مفاتيحه ← Cohere ← Groq)
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

    // 2. الخطة الاحتياطية الأولى: Cohere
    if (shouldFallback && process.env.COHERE_API_KEY) {
      console.warn(`[AI] تحويل إلى Cohere بعد فشل Gemini: ${err.message}`);
      try {
        return await cohereRequest(sysMarker, userPart, opts);
      } catch (cohereErr) {
        console.error('[AI/Cohere Fallback Error]', cohereErr.message);
        // استمر إلى الخطة البديلة التالية (Groq)
      }
    }

    // 3. الخطة الاحتياطية الأخيرة: Groq
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

[الاختبارات القادمة]
${quizzesList}

[أحدث أخبار الكلية]
${newsList}

[أحدث الإشعارات]
${notifsList}

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
  return raw.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
}

/* النماذج تسبق الـ JSON أحياناً بجملة تمهيدية رغم التعليمات، فيفشل JSON.parse
   ويتحول الأمر إلى خطأ 500 أمام الطالب. نستخرج أول مصفوفة صالحة بدل الفشل. */
function parseJsonArray(raw) {
  const cleaned = cleanJson(raw);
  try {
    const direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) return direct;
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
const JSON_SYSTEM_PROMPT = `أنت "كيدي"، مساعد أكاديمي لطلاب كلية تقنية المعلومات — جامعة النصر التقنية.
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
    fallbackAvailable: !!(process.env.COHERE_API_KEY || process.env.GROQ_API_KEY),
    fallbackChain: [
      { provider: 'cohere', model: COHERE_MODEL, configured: !!process.env.COHERE_API_KEY },
      { provider: 'groq',   model: GROQ_MODEL,   configured: !!process.env.GROQ_API_KEY }
    ],
    primary: { provider: 'gemini', model: GEMINI_MODEL, keysConfigured: _geminiKeyPool.length }
  });
});

const SYSTEM_PROMPT = `أنت "كيدي" (Kedy)، المساعد الأكاديمي لطلاب كلية تقنية المعلومات — جامعة النصر التقنية.
طوّرك المهندس ضياء الدين (0112046348 | diaakardmash@gmail.com). لا تذكر هذه البيانات إلا إذا سُئلت عنها صراحة.

════ القاعدة الأولى: طول الرد يتبع حجم السؤال ════
هذه أهم قاعدة لديك. الإطالة بلا داعٍ عيب وليست ميزة.
• سؤال عن بيانات التطبيق (كم مادة؟ متى التسليم؟ ما آخر خبر؟) → جملة أو جملتان مباشرة. لا مقدمات، لا عناوين، لا تشبيهات، لا نصائح امتحان.
• سؤال تعريفي قصير (ما معنى X؟) → 2-4 أسطر.
• طلب شرح مفهوم أو "اشرح لي" → استخدم الهيكل الأكاديمي أدناه.
• طلب حل مسألة → الخطوات فقط ثم الناتج النهائي.
• محادثة عابرة (سلام، شكراً) → رد قصير ودود بسطر واحد.
لا تكرر ما قاله الطالب، ولا تشرح ما ستفعله قبل فعله، ولا تختم بعروض مساعدة إضافية إلا عند الحاجة الحقيقية.

════ الهيكل الأكاديمي (لطلبات الشرح فقط) ════
اكتب العناوين بنص عربي عادي وبخط عريض، بدون أي رموز تعبيرية (emoji):
**الفكرة الجوهرية:** المفهوم في سطرين بلغة عربية سلسة.
**تشبيه من الواقع:** مثال يومي يقرّب الفكرة.
**التفاصيل:** النقاط الأساسية مرقّمة.
**ملاحظة للامتحان:** أهم 2-3 أفكار متكررة.
احذف أي قسم لا يضيف شيئاً حقيقياً لهذا السؤال تحديداً.

════ الصدق والدقة ════
• "سياق التطبيق الحي" هو مصدرك لمعلومات النظام كالواجبات والاختبارات والأخبار.
• إذا وُجد قسم "[محتوى المادة/المحاضرة المرفق]" في التعليمات، فهو النص المستخرج من ملف الـ PDF الخاص بالمحاضرة. اعتمد عليه كمصدرك الأول والتزم بمحتواه حصرياً. أجب على أي سؤال من محتواه مباشرة وبدقة دون اختراع شيء ليس فيه.
• يُمنع منعاً باتاً تأليف أي معلومات خارج ما جاءك في نص السؤال أو في المحتوى المرفق.
• إذا لم تجد المعلومة في السياق، قل ذلك صراحة في سطر واحد ووجّه الطالب إلى ليدر الدفعة أو إدارة الكلية. لا تعوّض بكلام عام.
• استثناء: إذا طلب الطالب ملخصاً لمادة أو أسئلة متوقعة ولم يزودك بنص علمي، فأخبره بأدب أنك لا تستطيع قراءة ملفات الـ PDF أو الفيديوهات المرفوعة في النظام، واطلب منه نسخ ولصق النص أو الجزئية التي يريد تلخيصها أو وضع أسئلة عليها.
• التاريخ المذكور في السياق هو تاريخ اليوم الفعلي — احسب المدد المتبقية منه، ولا تعتمد على معرفتك الداخلية بالتاريخ.
• عند حل مسألة، استخدم القوانين الواردة في سياق المحاضرة المرفق إن وُجدت، وأشر إلى موضعها. إن لم توجد فاستخدم القانون القياسي واذكر أنه ليس من المنهج المرفوع.

════ التنسيق ════
• اللغة عربية فصيحة مبسطة. المصطلحات التقنية تُكتب بالإنجليزية بين قوسين عند أول ذكر.
• ممنوع استخدام الرموز التعبيرية (emoji) نهائياً — لا في العناوين ولا في النص.
• المعادلات بنص واضح بلا LaTeX: x²، dy/dx، ∫f(x)dx، a/b، √(x).
• الأكواد داخل \`\`\` مع اسم اللغة.
• أنت تُقرأ على شاشة هاتف: فقرات قصيرة وأسطر لا تتجاوز سطرين.`;

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
  // شرح مفهوم — الحالة الوحيدة التي تستحق الهيكل الكامل
  explain: { maxOutputTokens: THINKING_HEADROOM + 2600, temperature: 0.4,
             directive: 'استخدم الهيكل الأكاديمي، واحذف أي قسم لا يضيف قيمة حقيقية لهذا السؤال. لا تتجاوز 400 كلمة.' },
};

function detectIntent(question, hasStudyContext) {
  const q = (question || '').trim();
  const lower = q.toLowerCase();

  // تحية أو شكر قصير
  if (q.length <= 25 && /^(سلام|السلام|هاي|هلا|مرحبا|أهلا|اهلا|شكرا|شكراً|تمام|اوك|ok|hi|hello|thanks)/i.test(q)) {
    return 'chat';
  }

  // استعلام عن بيانات النظام
  const dataWords = ['كم', 'متى', 'موعد', 'مواعيد', 'تاريخ', 'آخر خبر', 'اخر خبر', 'الأخبار', 'الاخبار',
                     'إشعار', 'اشعار', 'التنبيهات', 'واجب', 'الواجبات', 'تسليم', 'اختبار', 'الاختبارات',
                     'امتحان', 'الامتحانات', 'كوز', 'موادي', 'مواد', 'دفعتي', 'الليدر', 'المندوب', 'باقي'];
  const explainWords = ['اشرح', 'إشرح', 'وضح', 'وضّح', 'فهمني', 'ما الفرق', 'الفرق بين', 'لماذا', 'ليش', 'كيف يعمل', 'مقارنة'];
  const solveWords = ['احسب', 'أحسب', 'حل ', 'حلّ', 'أوجد', 'اوجد', 'برهن', 'اثبت', 'أثبت', 'استنتج قيمة', 'كم يساوي'];
  const defineWords = ['ما هو', 'ما هي', 'شنو', 'تعريف', 'ماذا يعني', 'معنى', 'وش يعني'];

  const has = (arr) => arr.some(w => lower.includes(w.toLowerCase()));

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
      .populate('subject', 'name batches')
      .lean();

    if (!lecture) return res.status(404).json({ success: false, message: 'المحاضرة غير موجودة' });

    // تحقق من صلاحية الوصول: طالب يجب أن يكون في دفعة المادة
    const User = require('../models/User');
    const user = await User.findById(req.user.id).select('roles batch batches').lean();
    const isStaff = ['dean','doctor','leader','admin'].some(r => user.roles?.includes(r));

    if (!isStaff) {
      const userBatch = user.batch || (user.batches && user.batches[0]);
      const subjectBatches = lecture.subject?.batches || [];
      const hasAccess = subjectBatches.some(b => b?.toString() === userBatch?.toString());
      if (!hasAccess) return res.status(403).json({ success: false, message: 'لا تملك صلاحية الوصول لهذه المحاضرة' });
    }

    // إذا لا يوجد نص مستخرج ولكن يوجد ملف PDF، حاول الاستخراج الآن (للمحاضرات القديمة)
    let extractedText = lecture.extractedText || '';
    if (!extractedText && lecture.file) {
      try {
        const fs = require('fs');
        const filePath = require('path').join(__dirname, '../uploads', lecture.file);
        if (fs.existsSync(filePath) && lecture.file.toLowerCase().endsWith('.pdf')) {
          const pdfParse = require('pdf-parse');
          const buffer = fs.readFileSync(filePath);
          const parsed = await pdfParse(buffer);
          extractedText = (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 25000);
          // حفظ النص لتسريع الطلبات القادمة
          if (extractedText) {
            await Lecture.findByIdAndUpdate(req.params.id, { extractedText });
            console.log(`[AI/lecture-context] استخرجت ${extractedText.length} حرف من PDF قديم: ${lecture.title}`);
          }
        }
      } catch (e) {
        console.warn('[AI/lecture-context] فشل استخراج PDF:', e.message);
      }
    }

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

    // 1. إذا طلب الطالب اختيار مادة أو طلب ملخص للمادة بوجه عام دون تحديد مادة
    if ((q.includes('ملخص شامل للمادة') || q.includes('اشرح لي مادة') || q.includes('اختر مادة')) && !subjectTitle && !selectedSubjectId) {
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
          answer: '📚 **أهلاً بك! هذه قائمة المواد المتاحة لك هذا الفصل:**\nيرجى اختيار المادة التي تود دراستها أو شرح جزئية منها:',
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
      const subj = await Subject.findById(selectedSubjectId).select('name').lean();
      const lectures = await Lecture.find({ subject: selectedSubjectId }).select('title _id').sort({ createdAt: 1 }).lean();
      const sName = subj?.name || subjectTitle || 'المادة المختارة';

      return res.json({
        success: true,
        answer: `📖 **ممتاز! اخترت مادة (${sName}).**\nكيف تود أن أساعدك فيها اليوم؟`,
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
    res.json({ success: true, cards });
  } catch (err) {
    console.error('[AI/flashcards]', err.message);
    res.status(500).json({ success: false, message: errMsg(err, 'تعذّر توليد البطاقات') });
  }
});

// =========================================================
// 4. توليد أسئلة اختبار — POST /api/ai/quiz-gen
// =========================================================
router.post('/quiz-gen', aiGuard, async (req, res) => {
  try {
    const { text, count = 5, subjectTitle, lectureTitle } = req.body;
    const content = (text && text.trim().length >= 10) ? text.slice(0, 10000) : `الموضوع: ${lectureTitle || 'المحاضرة'} - المادة: ${subjectTitle || 'المادة الأكاديمية'}`;
    const n = Math.min(Math.max(parseInt(count) || 5, 3), 10);

    const prompt = `${JSON_SYSTEM_PROMPT}

[المطلوب]
أنشئ ${n} أسئلة اختيار من متعدد (MCQ) تختبر الفهم الحقيقي للمحتوى التالي.
- أربعة خيارات لكل سؤال، متقاربة في الطول والمعقولية — لا تجعل الإجابة الصحيحة أطول أو أوضح من غيرها.
- الخيارات الخاطئة تمثل أخطاء شائعة يقع فيها الطالب فعلاً، لا خيارات عبثية.
- وزّع موضع الإجابة الصحيحة عشوائياً بين 0 و3، ولا تجعلها دائماً في نفس الموضع.
- اختبر الفهم والتطبيق لا الحفظ الحرفي، واستخرج الأسئلة من المحتوى المرفق فقط.
- correct هو رقم موضع الإجابة الصحيحة (0-3).

[الصيغة — أعد هذا الشكل حرفياً ولا شيء غيره]
[{"question":"نص السؤال","options":["الأول","الثاني","الثالث","الرابع"],"correct":0}]

[المحتوى]
${content}`;
    let questions = parseJsonArray(await askAIWithUltimateFallback(prompt, { maxOutputTokens: 2400, temperature: 0.5 }));

    // تحقق من سلامة كل سؤال قبل إرساله للواجهة — سؤال ناقص الخيارات
    // أو بمؤشر إجابة خارج المدى كان يكسر واجهة الاختبار عند العرض.
    questions = questions.filter(item =>
      item && typeof item.question === 'string' && item.question.trim() &&
      Array.isArray(item.options) && item.options.length === 4 &&
      item.options.every(o => typeof o === 'string' && o.trim()) &&
      Number.isInteger(item.correct) && item.correct >= 0 && item.correct <= 3
    );
    if (!questions.length) throw new Error('Invalid format');

    res.json({ success: true, questions });
  } catch (err) {
    console.error('[AI/quiz-gen]', err.message);
    res.status(500).json({ success: false, message: errMsg(err, 'تعذّر توليد الأسئلة') });
  }
});
// =========================================================
// ===== سحابة الملاحظات (بنك الأسئلة والخطط) =====
// =========================================================
const SavedNote = require('../models/SavedNote');

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

module.exports = router;

// دوال منطقية خالصة (بلا شبكة ولا قاعدة بيانات) مكشوفة للاختبار
module.exports._internals = { detectIntent, INTENT_MODES, parseJsonArray, daysFromNow, SYSTEM_PROMPT, JSON_SYSTEM_PROMPT };
