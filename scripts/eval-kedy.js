/**
 * scripts/eval-kedy.js — تقييم كيدي على كل مزوّد ذكاء اصطناعي بنفس الرسالة الحقيقية.
 *
 *   node scripts/eval-kedy.js                 كل المزوّدين المضبوطين
 *   node scripts/eval-kedy.js groq,nvidia     مزوّدون محددون
 *   node scripts/eval-kedy.js chain           السلسلة الكاملة كما في الإنتاج (askAIWithUltimateFallback)
 *
 * يستدعي الشبكة ويستهلك من حصص المفاتيح (16 طلباً لكل مزوّد). يكتب التفاصيل في
 * eval-kedy-results.json ويطبع جدولاً: هل ردّ، الزمن، ومخالفات التعليمات.
 * الفحوص آلية (طول، رموز، جداول، تفكير مسرّب، لغة، وقائع من بيانات الطالب)؛
 * جودة الشرح نفسها تُقرأ من ملف النتائج.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const ai = require('../routes/ai.routes.js')._internals;

const today = new Date();
const inDays = d => { const x = new Date(today); x.setDate(x.getDate() + d); return x.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }); };

// بيانات طالب تجريبية بنفس شكل getLiveStudentSections
const SECTIONS = {
  date: `[التاريخ] اليوم ${today.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. احسب منه كل المدد المتبقية.`,
  student: '[الطالب] سارة أحمد عثمان — الدفعة 21 - تقنية المعلومات — ليدر/مندوب الدفعة: محمد عبدالله',
  subjects: '[المواد المسجّلة (3)]\n1. هياكل البيانات\n2. قواعد البيانات\n3. شبكات الحاسوب',
  assignments: `[الواجبات المفتوحة للتسليم]\n- «تمرين المكدس» (مادة هياكل البيانات) — التسليم ${inDays(2)} الساعة 23:59 [بعد يومين]\n- «بحث التطبيع» (مادة قواعد البيانات) — التسليم ${inDays(6)} الساعة 12:00 [بعد 6 أيام]`,
  quizzes: `[الاختبارات والكويزات القادمة]\n- «اختبار قصير: الأشجار» (مادة هياكل البيانات) — يُفتح ${inDays(3)} 10:00 ص ويُغلق ${inDays(3)} 11:00 ص، مدة الحل 15 دقيقة [بعد 3 أيام]`,
  events: '[الفعاليات والتقويم الأكاديمي]\nلا توجد فعاليات معلنة قريباً',
  finance: '[الوضع المالي]\nإجمالي الرسوم: 500000 ج.س | المسدد: 100000 ج.س | المتبقي المطلوب: 400000 ج.س',
  pods: '[مجموعات المذاكرة النشطة]\nلا توجد مجموعات مذاكرة نشطة حالياً',
  news: '[أحدث أخبار الكلية]\nلا توجد أخبار منشورة',
  notifications: '[أحدث الإشعارات]\n- «تأجيل محاضرة الغد»: تم تأجيل محاضرة قواعد البيانات إلى الأحد',
  services: '[صفحات المنصة التي يمكن إرشاد الطالب إليها]\n- مختبر الأكواد Code Lab (/code-lab.html)\n- الكويزات (/quizzes.html)'
};

const QUIZ_TURN = 'سؤال 1: أي مما يلي يضمن عدم تكرار السجلات؟\nأ) المفتاح الأساسي\nب) المفتاح الأجنبي\nج) الفهرس\nد) العرض\n\nسؤال 2: ما الصيغة التي تزيل الاعتماد الجزئي؟\nأ) الأولى\nب) الثانية\nج) الثالثة\nد) BCNF\n\nسؤال 3: أمر SQL لاسترجاع البيانات هو:\nأ) INSERT\nب) UPDATE\nج) SELECT\nد) DELETE\n\nأرسل إجاباتك (مثلاً: 1-ب، 2-أ، 3-ج) وسأصححها لك.';

/* كل حالة: السؤال، سجل اختياري، وفحوص إضافية.
   must: نصوص يجب أن يحويها الرد (أيّها يكفي) · mustNot: ممنوعة · maxWords: سقف الطول */
const CASES = [
  { id: 'greet', q: 'السلام عليكم يا كيدي', maxWords: 45 },
  { id: 'data-due', q: 'متين تسليم واجب المكدس؟', must: ['23:59', '11:59', 'يومين'], maxWords: 80 },
  { id: 'data-absent', q: 'كم درجتي في امتحان الشبكات النهائي؟', must: ['غير مسجل', 'غير مسجلة', 'لم تُسجَّل', 'لم تسجل', 'غير متوفر', 'غير متوفرة', 'لا توجد', 'لم يتم', 'ليست مسجلة', 'لم تُرصد', 'لم ترصد'], mustNot: [/\d{2}\s*(\/|من)\s*100/], maxWords: 80 },
  { id: 'data-fees', q: 'كم باقي علي من الرسوم؟', must: ['400000', '400,000', '400 000', '400 ألف', '٤٠٠'], maxWords: 70 },
  { id: 'define', q: 'ما هو المفتاح الأجنبي؟', must: ['Foreign Key', 'foreign key', 'مفتاح'], maxWords: 130 },
  { id: 'define-brief', q: 'شنو يعني recursion باختصار', maxWords: 70 },
  { id: 'explain', q: 'اشرح لي الفرق بين TCP و UDP', must: ['TCP', 'UDP'], maxWords: 420 },
  { id: 'sudanese', q: 'يا كيدي الفرق شنو بين ال stack وال queue؟', must: ['LIFO', 'FIFO'], maxWords: 420 },
  { id: 'solve', q: 'حل: كم عدد المقارنات في البحث الثنائي على مصفوفة مرتبة من 1024 عنصر في أسوأ حالة؟', must: ['10', '11', '١٠', '١١'], maxWords: 250 },
  { id: 'code', q: 'اكتب دالة بايثون تعكس قائمة مرتبطة (linked list)', must: ['```', 'def '], maxWords: 450 },
  { id: 'code-error', q: "الكود بيطلع لي error: TypeError: Cannot read properties of undefined (reading 'length')", must: ['undefined'], maxWords: 350 },
  { id: 'quiz', q: 'اختبرني في قواعد البيانات', must: ['سأصححها'], mustNot: [/الإجابة الصحيحة\s*[:：]/], maxWords: 260 },
  { id: 'quiz-grade', q: '1-أ، 2-أ، 3-ج', history: [{ role: 'user', content: 'اختبرني في قواعد البيانات' }, { role: 'assistant', content: QUIZ_TURN }], must: ['صح', 'خطأ', 'صحيح', 'خاطئ'], maxWords: 260 },
  { id: 'plan', q: 'رتب لي مذاكرة الليلة', must: ['المكدس', 'الأشجار'], maxWords: 260 },
  { id: 'support', q: 'انا تعبان ومضغوط وما فاهم حاجة في هياكل البيانات', maxWords: 200 },
  { id: 'offtopic', q: 'منو بطل كأس العالم 2022؟', maxWords: 70 },
  { id: 'followup', q: 'اديني مثال تاني', history: [{ role: 'user', content: 'ما هو المفتاح الأجنبي؟' }, { role: 'assistant', content: 'المفتاح الأجنبي (Foreign Key) عمود في جدول يشير إلى المفتاح الأساسي في جدول آخر ليربط بينهما. مثال: عمود student_id في جدول التسجيلات يشير إلى جدول الطلاب.' }], mustNot: [/student_id/], maxWords: 160 },
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
function words(t) { return String(t).replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length; }
function arabicRatio(t) {
  const prose = String(t).replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').replace(/\([^)]*\)/g, '');
  const ar = (prose.match(/[؀-ۿ]/g) || []).length, lat = (prose.match(/[A-Za-z]/g) || []).length;
  return ar + lat ? ar / (ar + lat) : 1;
}
function check(c, answer) {
  const issues = [];
  if (!answer) return ['NO_ANSWER'];
  if (/<think>|<\/think>|^\s*(thinking|reasoning)\s*:/im.test(answer)) issues.push('leaked-thinking');
  if (EMOJI.test(answer)) issues.push('emoji');
  if (/^\s*\|.*\|\s*$/m.test(answer)) issues.push('table');
  if (/^\s*([-*_])\1{2,}\s*$/m.test(answer)) issues.push('hr');
  if (arabicRatio(answer) < 0.55) issues.push('not-arabic');
  const w = words(answer);
  if (c.maxWords && w > c.maxWords) issues.push(`long(${w}>${c.maxWords})`);
  if (c.must && !c.must.some(s => answer.includes(s))) issues.push('missing-fact');
  if (c.mustNot && c.mustNot.some(re => re.test(answer))) issues.push('forbidden');
  if (/سؤال رائع|سؤال ممتاز|سؤال جميل/.test(answer)) issues.push('filler');
  return issues;
}

function promptFor(c) {
  const history = ai.chatHistoryMessages(c.history || []);
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant')?.content || '';
  const analysis = ai.analyzeQuestion(c.q, { hasStudyContext: false, hasHistory: history.length > 0, lastAssistant });
  const mode = ai.INTENT_MODES[analysis.intent] || ai.INTENT_MODES.explain;
  const lengthDirective = analysis.brief ? ai.LENGTH_DIRECTIVES.brief : analysis.detailed ? ai.LENGTH_DIRECTIVES.detailed : '';
  const liveContext = ai.renderLiveContext(SECTIONS, analysis.intent);
  const prompt = ai.buildAskPrompt({ q: c.q, liveContext, mode, lengthDirective });
  return { prompt, history, mode, intent: analysis.intent };
}

async function runOne(provider, c) {
  const { prompt, history, mode, intent } = promptFor(c);
  const parts = ai.extractSystemAndUserPrompts(prompt);
  const opts = { maxOutputTokens: mode.maxOutputTokens, temperature: mode.temperature, history };
  const t0 = Date.now();
  let answer = '', error = null;
  try {
    const raw = provider === 'chain'
      ? await ai.askAIWithUltimateFallback(prompt, opts)
      : await ai.AI_PROVIDERS[provider].call(prompt, parts, opts);
    answer = ai.sanitizeAnswer(raw);
  } catch (e) { error = String(e.message).slice(0, 160); }
  const ms = Date.now() - t0;
  return { provider, id: c.id, intent, ms, error, issues: error ? ['ERROR'] : check(c, answer), words: words(answer), answer };
}

(async () => {
  const configured = ai.configuredProviders();
  const arg = process.argv[2];
  const providers = arg === 'chain' ? ['chain'] : arg ? arg.split(',') : Object.keys(configured).filter(p => configured[p]);
  console.log('providers:', providers.join(', '));
  const all = await Promise.all(providers.map(async p => {
    const out = [];
    for (const c of CASES) { out.push(await runOne(p, c)); process.stdout.write(out.at(-1).error ? 'x' : out.at(-1).issues.length ? '!' : '.'); }
    return out;
  }));
  const rows = all.flat();
  fs.writeFileSync(path.join(__dirname, '..', 'eval-kedy-results.json'), JSON.stringify(rows, null, 2));
  console.log('\n');
  for (const p of providers) {
    const r = rows.filter(x => x.provider === p);
    const ok = r.filter(x => !x.error), clean = ok.filter(x => !x.issues.length);
    const lat = ok.map(x => x.ms).sort((a, b) => a - b);
    console.log(`${p.padEnd(8)} answered ${ok.length}/${r.length}  clean ${clean.length}/${r.length}  median ${lat.length ? (lat[Math.floor(lat.length / 2)] / 1000).toFixed(1) : '-'}s  max ${lat.length ? (lat.at(-1) / 1000).toFixed(1) : '-'}s`);
    for (const x of r) if (x.error || x.issues.length) console.log(`   ${x.id.padEnd(12)} ${x.intent.padEnd(8)} ${(x.ms / 1000).toFixed(1)}s  ${x.error || x.issues.join(', ')}`);
  }
})();
