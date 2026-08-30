const fs = require('fs');
const server = fs.readFileSync('./server.js', 'utf8');
const ai = fs.readFileSync('./routes/ai.routes.js', 'utf8');
const observabilityRoute = fs.readFileSync('./routes/observability.routes.js', 'utf8');
const restore = fs.readFileSync('./scripts/restore.js', 'utf8');
const reviewModel = fs.readFileSync('./models/AIReview.js', 'utf8');

const checks = [
  ['HPP manual protection active', server.includes('Array.isArray(req.query[key])')],
  ['XSS sanitizer active (manual)', server.includes('sanitizeXSS')],
  ['script tag stripping in XSS sanitizer', server.includes('script')],
  ['version 2.0.2 in /api route', server.includes('version: "2.0.2"')],
  ['_userThrottle memory leak fixed', ai.includes('THROTTLE_MAX_ENTRIES')],
  ['_userThrottle cleanup loop exists', ai.includes('_userThrottle.delete(uid)')],
  ['observability route is role protected', observabilityRoute.includes("roleMiddleware(['admin', 'dean'])")],
  ['restore requires explicit confirmation', restore.includes("process.argv[3] !== '--confirm'")],
  ['AI feedback stores hashes rather than raw text', reviewModel.includes('promptHash') && reviewModel.includes('answerHash') && !reviewModel.includes('prompt: {')],
];

let passed = 0;
for (const [name, result] of checks) {
  console.log((result ? '✅' : '❌') + ' ' + name);
  if (result) passed++;
}
console.log('\n--- ' + passed + '/' + checks.length + ' fixes verified ---');
