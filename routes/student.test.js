const test = require('node:test');
const assert = require('node:assert');

const { buildStudentStudyPlan, calculateStudentRisk, buildStudentSmartAlerts } = require('./student.routes.js')._internals;

const now = new Date('2026-08-15T10:00:00.000Z');

test('study plan sorts assignments and quizzes by nearest due date', () => {
  const plan = buildStudentStudyPlan([
    { _id: 'a2', title: 'واجب لاحق', subject: { name: 'شبكات' }, dueDate: '2026-08-25T10:00:00Z' },
    { _id: 'a1', title: 'واجب عاجل', subject: { name: 'قواعد بيانات' }, dueDate: '2026-08-16T10:00:00Z' }
  ], [
    { _id: 'q1', title: 'اختبار قريب', subject: { name: 'برمجة' }, startsAt: '2026-08-17T10:00:00Z', endsAt: '2026-08-18T10:00:00Z' }
  ], now);

  assert.strictEqual(plan.length, 3);
  assert.strictEqual(plan[0].id, 'a1');
  assert.strictEqual(plan[0].urgency, 'high');
  assert.strictEqual(plan[1].type, 'quiz');
});

test('study plan ignores past work and limits the visible priorities', () => {
  const assignments = Array.from({ length: 12 }, (_, index) => ({
    _id: `a${index}`,
    title: `واجب ${index}`,
    dueDate: new Date(now.getTime() + (index + 1) * 86400000).toISOString()
  }));
  assignments.push({ _id: 'old', title: 'واجب منتهٍ', dueDate: '2026-08-14T10:00:00Z' });
  const plan = buildStudentStudyPlan(assignments, [], now);
  assert.strictEqual(plan.length, 8);
  assert.ok(!plan.some(item => item.id === 'old'));
});

test('risk calculator marks low attendance plus backlog as high risk', () => {
  const risk = calculateStudentRisk({ attendanceRate: 60, pendingAssignments: 3, totalAssignments: 5, avgGrade: 72, avgQuizScore: 68 });
  assert.strictEqual(risk.level, 'high');
  assert.strictEqual(risk.reasons.length, 2);
});

test('risk calculator stays stable when no academic data exists', () => {
  const risk = calculateStudentRisk({ attendanceRate: null, pendingAssignments: 0, totalAssignments: 0, avgGrade: null, avgQuizScore: null });
  assert.deepStrictEqual(risk, { level: 'low', reasons: [] });
});

test('smart alerts warn about imminent work and low attendance', () => {
  const alerts = buildStudentSmartAlerts({
    assignments: [{ title: 'واجب الشبكات', dueDate: '2026-08-16T10:00:00Z' }],
    quizzes: [{ title: 'اختبار البرمجة', startsAt: '2026-08-17T10:00:00Z' }],
    attendanceRate: 68,
    now
  });
  assert.strictEqual(alerts.length, 3);
  assert.ok(alerts.some(alert => alert.type === 'assignment_due'));
  assert.ok(alerts.some(alert => alert.type === 'quiz_due'));
  assert.ok(alerts.some(alert => alert.type === 'attendance_risk'));
});
