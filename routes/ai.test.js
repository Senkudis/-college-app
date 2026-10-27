/**
 * اختبارات منطق المساعد الأكاديمي (كيدي) — دوال خالصة بلا شبكة ولا قاعدة بيانات.
 * الغرض: ضمان أن الأسئلة المباشرة لا تُوجَّه إلى الوضع المطوّل، وأن ناتج
 * النماذج غير المنضبط لا يُسقط المسار بخطأ 500.
 */
const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const _internals = require('./ai.routes.js')._internals;
const { detectIntent, INTENT_MODES, parseJsonArray, daysFromNow, SYSTEM_PROMPT, JSON_SYSTEM_PROMPT, extractSystemAndUserPrompts, normalizeAIText } = _internals;

test('extractSystemAndUserPrompts: يفصل موجه النظام عن المحتوى بدقة لجميع النماذج', () => {
  const jsonPrompt = `${JSON_SYSTEM_PROMPT}\n[المحتوى]\nاختبرني في 5 أسئلة`;
  const res1 = extractSystemAndUserPrompts(jsonPrompt);
  assert.strictEqual(res1.systemPrompt, JSON_SYSTEM_PROMPT);
  assert.strictEqual(res1.userPrompt, '[المحتوى]\nاختبرني في 5 أسئلة');

  const textPrompt = `${SYSTEM_PROMPT}\nما الفرق بين المكدس والطابور؟`;
  const res2 = extractSystemAndUserPrompts(textPrompt);
  assert.strictEqual(res2.systemPrompt, SYSTEM_PROMPT);
  assert.strictEqual(res2.userPrompt, 'ما الفرق بين المكدس والطابور؟');
});

test('daysFromNow: يصف المدد بالعربية بشكل صحيح', () => {
  const day = 86400000;
  assert.strictEqual(daysFromNow(new Date(Date.now() - 2 * day)), 'انتهى');
  assert.strictEqual(daysFromNow(new Date(Date.now() + 0.5 * day)), 'غداً');
  assert.match(daysFromNow(new Date(Date.now() + 5 * day)), /بعد \d+ يوم/);
});

test('تحديد النية: أسئلة بيانات التطبيق تحصل على ردود قصيرة', () => {
  const dataQuestions = [
    'كم مادة عندي؟',
    'متى تسليم الواجب؟',
    'ما هي آخر الأخبار؟',
    'عندي كم اختبار قادم؟',
    'منو الليدر حق دفعتي؟'
  ];
  for (const q of dataQuestions) {
    assert.strictEqual(detectIntent(q, false), 'data', `توقعت data لـ: ${q}`);
  }
});

test('تحديد النية: التحيات تحصل على رد بسطر واحد', () => {
  for (const q of ['السلام عليكم', 'شكراً', 'مرحبا', 'تمام']) {
    assert.strictEqual(detectIntent(q, false), 'chat', `توقعت chat لـ: ${q}`);
  }
});

test('تحديد النية: طلبات الشرح فقط هي التي تستحق الوضع المطوّل', () => {
  for (const q of ['اشرح لي الفرق بين stack و queue', 'وضح كيف يعمل بروتوكول TCP بالتفصيل']) {
    assert.strictEqual(detectIntent(q, false), 'explain', `توقعت explain لـ: ${q}`);
  }
});

test('تحديد النية: المسائل الحسابية تذهب لوضع الحل خطوة بخطوة', () => {
  for (const q of ['احسب تكامل x^2', 'أوجد مشتقة الدالة', 'برهن أن المجموع يساوي n']) {
    assert.strictEqual(detectIntent(q, false), 'solve', `توقعت solve لـ: ${q}`);
  }
});

test('تحديد النية: طلبات الأسئلة المتوقعة والمراجعة توجَّه لوضع exam', () => {
  const examQuestions = [
    'اديني الحاجات المتوقع تجي في الامتحان',
    'ما يجي في الامتحان',
    'عايز مراجعة شاملة',
    'اسئلة الامتحان المتوقعة',
    'توقعات الامتحان للمادة دي',
    'متوقع شنو في الاختبار',
    'ذاكر معي المادة',
  ];
  for (const q of examQuestions) {
    assert.strictEqual(detectIntent(q, false), 'exam', `توقعت exam لـ: ${q}`);
    assert.strictEqual(detectIntent(q, true), 'exam', `توقعت exam (مع سياق) لـ: ${q}`);
  }
});

test('تحديد النية: كل وضع له تعليمة وحد أقصى معرّفان', () => {
  for (const [name, mode] of Object.entries(INTENT_MODES)) {
    assert.ok(mode.directive && mode.directive.length > 10, `${name}: تعليمة مفقودة`);
    assert.ok(Number.isInteger(mode.maxOutputTokens), `${name}: حد أقصى مفقود`);
    assert.ok(typeof mode.temperature === 'number', `${name}: حرارة مفقودة`);
    // لا يجوز العودة للقيمة القديمة الموحّدة 8192 التي كانت تُنتج مقالاً لكل سؤال
    assert.ok(mode.maxOutputTokens < 8192, `${name}: الحد الأقصى مرتفع جداً`);
  }
});

test('ميزانية التوكنات تترك متسعاً لتوكنات تفكير النموذج', () => {
  // قياس فعلي على gemini-flash-latest: 480-670 توكن تفكير قبل كتابة أي حرف.
  // أي وضع بميزانية أقل من ذلك يُنتج finishReason=MAX_TOKENS ورداً مبتوراً.
  const MEASURED_THINKING_COST = 700;
  for (const [name, mode] of Object.entries(INTENT_MODES)) {
    assert.ok(mode.maxOutputTokens > MEASURED_THINKING_COST + 200,
      `${name}: الميزانية (${mode.maxOutputTokens}) لا تكفي للتفكير + إجابة كاملة`);
  }
});

test('ترتيب الميزانيات يتصاعد مع تعقيد الطلب', () => {
  const order = ['chat', 'data', 'define', 'solve', 'explain'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      INTENT_MODES[order[i]].maxOutputTokens >= INTENT_MODES[order[i - 1]].maxOutputTokens,
      `${order[i]} يجب ألا تقل ميزانيته عن ${order[i - 1]}`
    );
  }
});

test('parseJsonArray: يقبل JSON نظيفاً', () => {
  const out = parseJsonArray('[{"q":"سؤال","a":"إجابة"}]');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].q, 'سؤال');
});

test('parseJsonArray: يقبل JSON داخل أسوار أكواد', () => {
  const out = parseJsonArray('```json\n[{"q":"س","a":"ج"}]\n```');
  assert.strictEqual(out.length, 1);
});

test('parseJsonArray: يستخرج المصفوفة رغم وجود جملة تمهيدية من النموذج', () => {
  const raw = 'بالطبع! إليك البطاقات المطلوبة:\n[{"q":"س","a":"ج"},{"q":"س2","a":"ج2"}]\nأتمنى أن تفيدك.';
  const out = parseJsonArray(raw);
  assert.strictEqual(out.length, 2);
});

test('parseJsonArray: يرمي خطأً واضحاً على ناتج تالف', () => {
  assert.throws(() => parseJsonArray('اعتذر، لا أستطيع تنفيذ ذلك.'));
});

test('daysFromNow: يصف المدد بالعربية بشكل صحيح', () => {
  const day = 86400000;
  assert.strictEqual(daysFromNow(new Date(Date.now() - 2 * day)), 'انتهى');
  assert.strictEqual(daysFromNow(new Date(Date.now() + 0.5 * day)), 'غداً');
  assert.match(daysFromNow(new Date(Date.now() + 5 * day)), /بعد \d+ يوم/);
});

test('AI subject access: student and leader stay inside their batches', () => {
  const subject = { doctor: 'doctor-1', batches: ['batch-a'] };
  assert.strictEqual(_internals.canAccessAISubject({ _id: 'student-1', roles: ['student'], batch: 'batch-a' }, subject), true);
  assert.strictEqual(_internals.canAccessAISubject({ _id: 'leader-1', roles: ['leader'], batch: 'batch-b' }, subject), false);
});

test('AI subject access: doctor must own the subject and assigned batch', () => {
  const subject = { doctor: 'doctor-1', batches: ['batch-a'] };
  assert.strictEqual(_internals.canAccessAISubject({ _id: 'doctor-1', roles: ['doctor'], batches: ['batch-a'] }, subject), true);
  assert.strictEqual(_internals.canAccessAISubject({ _id: 'doctor-2', roles: ['doctor'], batches: ['batch-a'] }, subject), false);
  assert.strictEqual(_internals.canAccessAISubject({ _id: 'doctor-1', roles: ['doctor'], batches: ['batch-b'] }, subject), false);
  assert.strictEqual(_internals.canAccessAISubject({ _id: 'admin-1', roles: ['admin'] }, subject), true);
});

test('AI subject filter: users without a batch cannot receive a global fallback', () => {
  assert.deepStrictEqual(
    _internals.buildAISubjectFilter({ _id: 'student-1', roles: ['student'], batches: [] }),
    { _id: null }
  );
  assert.deepStrictEqual(
    _internals.buildAISubjectFilter({ _id: 'doctor-1', roles: ['doctor'], batches: [] }),
    { doctor: 'doctor-1' }
  );
});

test('normalizeAIText: unifies common Arabic variants for retrieval', () => {
  assert.strictEqual(normalizeAIText('إدارة قواعد البياناتِ'), 'اداره قواعد البيانات');
  assert.strictEqual(normalizeAIText('ما الفرق بين SQL و SQL؟'), 'ما الفرق بين sql و sql');
});

test('normalizeQuizItems: accepts correct schema and rejects answer-field mismatch', () => {
  const items = _internals.normalizeQuizItems([
    { question: 'سؤال صحيح', options: ['أ', 'ب', 'ج', 'د'], correct: 2 },
    { question: 'سؤال قديم', options: ['أ', 'ب', 'ج', 'د'], answer: 1 },
    { question: 'ناقص', options: ['أ', 'ب'], correct: 0 }
  ]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].correct, 2);
});

// ===== التوجيه حسب حجم الطلب =====
const ALL_ON = { radox: true, nvidia: true, zai: true, mistral: true, gemini: true, qwen: true, cohere: true, groq: true, groq2: true };

const DEFAULT_ORDER = ['groq', 'groq2', 'nvidia', 'zai', 'cohere', 'gemini', 'radox', 'mistral', 'qwen'];

test('providerOrder: الترتيب الافتراضي يبدأ بـ Groq ثم NVIDIA، ويقبل ترتيباً مخصصاً ويتجاهل الأسماء المجهولة', () => {
  assert.deepStrictEqual(_internals.providerOrder(''), DEFAULT_ORDER);
  assert.deepStrictEqual(_internals.providerOrder(' Gemini, groq ,openai,groq'), ['gemini', 'groq']);
  assert.deepStrictEqual(_internals.providerOrder('ZAI,cohere'), ['zai', 'cohere']);
  assert.deepStrictEqual(_internals.providerOrder('nothing-valid'), DEFAULT_ORDER);
});

test('planProviders: سؤال قصير يمر على كل المزوّدين المضبوطة مفاتيحهم بالترتيب', () => {
  const plan = _internals.planProviders({
    order: _internals.providerOrder(''),
    configured: { ...ALL_ON, qwen: false, mistral: false, radox: false },
    inputTokens: 1500,
    maxOutputTokens: 2000
  });
  assert.deepStrictEqual(plan.map(p => p.name), ['groq', 'groq2', 'nvidia', 'zai', 'cohere', 'gemini']);
  assert.ok(plan.every(p => p.maxOutputTokens === 2000));
});

test('planProviders: "لخّص المادة" (60 ألف حرف) لا يُرسل إلى Groq المجاني', () => {
  const inputTokens = _internals.estimateTokens('م'.repeat(60000));
  const plan = _internals.planProviders({ order: _internals.providerOrder(''), configured: ALL_ON, inputTokens, maxOutputTokens: 1400 });
  assert.ok(!plan.some(p => p.name === 'groq'), 'Groq must be skipped for a whole-subject summary');
  assert.deepStrictEqual(plan.slice(0, 2).map(p => p.name), ['nvidia', 'zai'], 'long requests go to NVIDIA, then Z.AI');
});

test('planProviders: يقلّص حد المخرجات ليتسع الطلب بدل استبعاد المزوّد', () => {
  const groqLimit = _internals.PROVIDER_MAX_REQUEST_TOKENS.groq;
  const plan = _internals.planProviders({ order: ['groq'], configured: ALL_ON, inputTokens: groqLimit - 1000, maxOutputTokens: 3000 });
  assert.deepStrictEqual(plan, [{ name: 'groq', maxOutputTokens: 1000 }]);
  // مساحة رد أصغر من أن تفيد = استبعاد
  assert.deepStrictEqual(_internals.planProviders({ order: ['groq'], configured: ALL_ON, inputTokens: groqLimit - 100, maxOutputTokens: 3000 }), []);
});

test('isKeyLevelFailure: يميّز المفتاح الموقوف أو بلا رصيد عن خطأ الطلب العادي', () => {
  assert.ok(_internals.isKeyLevelFailure(403, "Consumer 'api_key:x' has been suspended."));
  assert.ok(_internals.isKeyLevelFailure(402, 'Your prepayment credits are depleted.'));
  assert.ok(_internals.isKeyLevelFailure(400, 'API key not valid. Please pass a valid API key.'));
  assert.ok(!_internals.isKeyLevelFailure(400, 'Invalid JSON payload received.'));
  assert.ok(!_internals.isKeyLevelFailure(500, 'Internal error'));
});

// ===== تصنيف الأسئلة: حالات كانت تُصنَّف خطأً فيبدو كيدي غبياً =====
test('تصنيف: "كم" داخل كلمة (التحكم، الكمبيوتر) لا يجعل سؤال المفهوم سؤال بيانات', () => {
  for (const q of ['ما هو التحكم في التدفق في الشبكات؟', 'شنو الكمبيوتر الكمومي؟', 'ما هي أنواع الاختبارات في هندسة البرمجيات']) {
    assert.notStrictEqual(detectIntent(q, false), 'data', `لا يجب أن يكون data: ${q}`);
  }
});

test('تصنيف: "مراحل" لا تُعامل كمسألة حسابية بسبب "حل" داخلها', () => {
  assert.strictEqual(detectIntent('مراحل دورة حياة تطوير البرمجيات', false), 'explain');
});

test('تصنيف: الكود والأخطاء البرمجية لها وضع خاص', () => {
  for (const q of ['اكتب لي كود bubble sort بالبايثون', "TypeError: Cannot read properties of undefined (reading 'map')", 'صحح لي الكود ده']) {
    assert.strictEqual(detectIntent(q, false), 'code', q);
  }
});

test('تصنيف: الاختبار التفاعلي، خطة المذاكرة، والدعم النفسي', () => {
  assert.strictEqual(detectIntent('اختبرني في قواعد البيانات', false), 'quiz');
  assert.strictEqual(detectIntent('شنو أذاكر الليلة؟', false), 'plan');
  assert.strictEqual(detectIntent('انا تعبان من المذاكرة وما فاهم حاجة', false), 'support');
  assert.strictEqual(detectIntent('هلا كيف حالك', false), 'chat');
});

test('تصنيف: طلب الاختصار أو التفصيل يُلتقط', () => {
  assert.strictEqual(_internals.analyzeQuestion('ما الفرق بين TCP و UDP؟ في جملتين بس').brief, true);
  assert.strictEqual(_internals.analyzeQuestion('اشرح الـ normalization بالتفصيل').detailed, true);
});

test('تصنيف: المتابعة القصيرة وتصحيح الكويز تعودان لآخر موضوع', () => {
  const opts = { hasHistory: true };
  assert.strictEqual(detectIntent('اديني مثال تاني', false, opts), 'followup');
  assert.strictEqual(detectIntent('ليه؟', false, opts), 'followup');
  assert.strictEqual(detectIntent('1-ب 2-أ 3-ج', false, { hasHistory: true, lastAssistant: 'أرسل إجاباتك (مثلاً: 1-ب، 2-أ، 3-ج) وسأصححها لك.' }), 'followup');
  // بلا محادثة سابقة "مثال" ليست متابعة
  assert.notStrictEqual(detectIntent('اديني مثال تاني', false), 'followup');
});

test('سياق المنصة: سؤال المفهوم لا يحمل الرسوم والإشعارات، وسؤال البيانات يحملها', () => {
  const sections = { date: '[التاريخ] اليوم', student: '[الطالب] س', subjects: '[المواد]', assignments: '[الواجبات]', finance: '[الوضع المالي]', notifications: '[الإشعارات]' };
  const concept = _internals.renderLiveContext(sections, 'define');
  assert.ok(concept.includes('[المواد]') && !concept.includes('[الوضع المالي]') && !concept.includes('[الإشعارات]'));
  const data = _internals.renderLiveContext(sections, 'data');
  assert.ok(data.includes('[الوضع المالي]') && data.includes('[الإشعارات]'));
});

test('سجل المحادثة: أدوار حقيقية، آخر 10 رسائل، ولا يبدأ برد المساعد', () => {
  const history = [{ role: 'assistant', content: 'أهلاً' }];
  for (let i = 0; i < 14; i++) history.push({ role: i % 2 ? 'assistant' : 'user', content: `رسالة ${i}` });
  const msgs = _internals.chatHistoryMessages(history);
  assert.ok(msgs.length <= 10);
  assert.strictEqual(msgs[0].role, 'user');
  assert.ok(msgs.every(m => m.role === 'user' || m.role === 'assistant'));
});

test('موجّه النظام: بلا رموز تعبيرية ويمنع الإحالة لليدر في الأسئلة العلمية', () => {
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(SYSTEM_PROMPT));
  assert.match(SYSTEM_PROMPT, /لا تحيل الطالب لليدر في سؤال علمي/);
});

test('sanitizeAnswer: يحوّل علامتي الصح/الخطأ لكلمات ويحذف الرموز والخطوط الفاصلة دون لمس الأكواد', () => {
  const out = _internals.sanitizeAnswer('النتيجة: ❌ خطأ\n---\nممتاز ✅ 🎉\n```js\nconst s = "---"; // ✅\n```');
  assert.ok(!/[\u{1F300}-\u{1FAFF}❌✅]/u.test(out.replace(/```[\s\S]*```/, '')), out);
  assert.ok(!/^---$/m.test(out.replace(/```[\s\S]*```/, '')));
  assert.match(out, /ممتاز صح/);
  assert.match(out, /const s = "---"; \/\/ ✅/, 'الكود يبقى كما هو');
});
test('sanitizeAnswer: Markdown tables become bullet lists, code blocks stay intact', () => {
  const out = _internals.sanitizeAnswer('| سؤال | النتيجة |\n|---|---|\n| 1 | ✅ صحيح |\n| 2 | ❌ خطأ |\n\n```js\n| a | b |\n|---|---|\n```');
  assert.ok(!/^\s*\|.*\|\s*$/m.test(out.split('```')[0]), 'no table rows outside code');
  assert.match(out, /- سؤال: 1 — النتيجة: صحيح/);
  assert.match(out, /- سؤال: 2 — النتيجة: خطأ/);
  assert.ok(out.includes('```js\n| a | b |\n|---|---|\n```'), 'tables inside code fences are left alone');
});
