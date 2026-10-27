'use strict';

const os = require('os');
const mongoose = require('mongoose');

const startedAt = Date.now();
const state = {
  requests: 0,
  errors: 0,
  byStatus: Object.create(null),
  byRoute: Object.create(null),
  lastErrorAt: null
};

const MAX_TRACKED_ROUTES = 200;

function safeRoute(req) {
  if (req?.route?.path) {
    return `${req.baseUrl || ''}${req.route.path}`.slice(0, 180);
  }
  /* بلا مسار مطابق نسجّل المسار بعد توحيد المعرّفات (ObjectId/أرقام/رموز طويلة → :id)
     فيبقى عدد المسارات محدوداً (مع سقف MAX_TRACKED_ROUTES) دون فقدان الرؤية كلياً. */
  if (!req?.path) return 'unknown';
  return String(req.path)
    .split('?')[0]
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, '/:token')
    .slice(0, 180);
}

function recordRequest(req, res, durationMs) {
  state.requests += 1;
  const status = String(res.statusCode || 0);
  state.byStatus[status] = (state.byStatus[status] || 0) + 1;
  const route = safeRoute(req);
  if (state.byRoute[route]) {
    state.byRoute[route] += 1;
  } else if (Object.keys(state.byRoute).length < MAX_TRACKED_ROUTES) {
    state.byRoute[route] = 1;
  } else {
    state.byRoute['other_untracked'] = (state.byRoute['other_untracked'] || 0) + 1;
  }
  if (Number(status) >= 500) {
    state.errors += 1;
    state.lastErrorAt = new Date().toISOString();
  }
  return { method: req.method, route, status: Number(status), durationMs: Math.round(durationMs) };
}

function safeErrorShape(err) {
  if (!err) return { name: 'UnknownError', message: 'Unknown error' };
  return {
    name: String(err.name || 'Error').slice(0, 80),
    code: err.code ? String(err.code).slice(0, 80) : undefined,
    message: String(err.message || 'Unknown error').replace(/[\r\n\t]+/g, ' ').slice(0, 500)
  };
}

function log(level, message, context = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message: String(message).slice(0, 240),
    requestId: context.requestId ? String(context.requestId).slice(0, 100) : undefined,
    method: context.method ? String(context.method).slice(0, 12) : undefined,
    route: context.route ? String(context.route).slice(0, 180) : undefined,
    status: Number.isFinite(context.status) ? context.status : undefined,
    durationMs: Number.isFinite(context.durationMs) ? Math.round(context.durationMs) : undefined,
    error: context.error ? safeErrorShape(context.error) : undefined
  };
  const clean = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
  const output = JSON.stringify(clean);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.info(output);
}

function snapshot(includeRoutes = false) {
  const data = {
    status: mongoose.connection.readyState === 1 ? 'ok' : 'degraded',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    cpuCount: os.cpus()?.length || 1,
    requests: state.requests,
    errors: state.errors,
    lastErrorAt: state.lastErrorAt,
    byStatus: { ...state.byStatus }
  };
  if (includeRoutes) {
    data.topRoutes = Object.entries(state.byRoute)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([route, count]) => ({ route, count }));
  }
  return data;
}

module.exports = { log, recordRequest, snapshot, safeRoute };
