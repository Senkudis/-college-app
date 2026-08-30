const test = require('node:test');
const assert = require('node:assert/strict');
const { recordRequest, snapshot, safeRoute } = require('../utils/observability');

test('observability records status and route aggregates without request bodies', () => {
  const before = snapshot(true).requests;
  const meta = recordRequest({ method: 'GET', path: '/api/health', id: 'test-request' }, { statusCode: 200 }, 12.7);
  assert.equal(meta.route, '/api/health');
  assert.equal(meta.status, 200);
  assert.equal(snapshot(true).requests, before + 1);
  assert.ok(snapshot(true).topRoutes.some(item => item.route === '/api/health'));
});

test('safeRoute uses route path and has a bounded fallback', () => {
  assert.equal(safeRoute({ route: { path: '/api/users/:id' }, path: '/api/users/1' }), '/api/users/:id');
  assert.equal(safeRoute({}), 'unknown');
});
