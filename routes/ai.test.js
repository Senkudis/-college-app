/**
 * اختبارات منطق المساعد الأكاديمي (كيدي) — دوال خالصة بلا شبكة ولا قاعدة بيانات.
 * الغرض: ضمان أن الأسئلة المباشرة لا تُوجَّه إلى الوضع المطوّل، وأن ناتج
 * النماذج غير المنضبط لا يُسقط المسار بخطأ 500.
 */
const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { detectIntent, INTENT_MODES, parseJsonArray, daysFromNow } = require('./ai.routes.js')._internals;

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
