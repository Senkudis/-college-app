const test = require('node:test');
const assert = require('node:assert');

const { buildSearchScope } = require('./search.routes.js')._internals;

test('search scope: student is limited to the active batch', () => {
  const scope = buildSearchScope({ roles: ['student'], batch: 'batch-a' }, 'student-1');
  assert.deepStrictEqual(scope.subjectFilter, { batches: { $in: ['batch-a'] } });
  assert.deepStrictEqual(scope.batchFilter, { $or: [{ batch: { $in: ['batch-a'] } }, { batches: { $in: ['batch-a'] } }] });
  assert.strictEqual(scope.global, false);
});

test('search scope: doctor is limited to owned subjects and assigned batches', () => {
  const scope = buildSearchScope({ roles: ['doctor'], batches: ['batch-a', 'batch-b'] }, 'doctor-1');
  assert.deepStrictEqual(scope.subjectFilter, { doctor: 'doctor-1', batches: { $in: ['batch-a', 'batch-b'] } });
  assert.ok(scope.batchFilter.$or);
  assert.deepStrictEqual(scope.userFilter, scope.batchFilter);
});

test('search scope: unassigned users receive no scoped records', () => {
  const scope = buildSearchScope({ roles: ['student'], batches: [] }, 'student-2');
  assert.deepStrictEqual(scope.subjectFilter, { _id: null });
  assert.deepStrictEqual(scope.batchFilter, { _id: null });
});

test('search scope: dean and admin retain global search access', () => {
  for (const role of ['dean', 'admin']) {
    const scope = buildSearchScope({ roles: [role] }, `${role}-1`);
    assert.strictEqual(scope.global, true);
    assert.deepStrictEqual(scope.subjectFilter, {});
    assert.deepStrictEqual(scope.batchFilter, {});
  }
});
