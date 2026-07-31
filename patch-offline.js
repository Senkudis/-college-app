const fs = require('fs');
const file = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js';
let content = fs.readFileSync(file, 'utf8');

const fetchWithTimeout =   async _fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (document.getElementById('cbs-offline-banner')) {
         window.dispatchEvent(new Event('online'));
      }
      return res;
    } catch (err) {
      clearTimeout(id);
      if (err.name === 'AbortError' || err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Load failed')) {
        window.dispatchEvent(new Event('offline'));
        const error = new Error('OFFLINE');
        error.isOffline = true;
        throw error;
      }
      throw err;
    }
  },;

content = content.replace(/async apiGet\(url, _retry = true\) \{/, fetchWithTimeout + '\n\n  async apiGet(url, _retry = true) {');

content = content.replace(/res = await fetch\(API_BASE \+ url, \{ headers: CBS\._getHeaders\(\) \}\);/g, 
  'res = await CBS._fetchWithTimeout(API_BASE + url, { headers: CBS._getHeaders() });');

content = content.replace(/async apiPost\(url, body, method = 'POST', _retry = true\) \{\s*const res = await fetch\(API_BASE \+ url, \{\s*method,\s*headers: CBS\._getHeaders\(\{ 'Content-Type': 'application\/json' \}\),\s*body: JSON\.stringify\(body\)\s*\}\);/g, 
  \sync apiPost(url, body, method = 'POST', _retry = true) {
    let res;
    try {
      res = await CBS._fetchWithTimeout(API_BASE + url, {
        method,
        headers: CBS._getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });
    } catch (err) {
      if (err.isOffline) return { ok: false, status: 0, json: async () => ({ success: false, message: 'لا يوجد اتصال' }) };
      throw err;
    }\);

content = content.replace(/async apiDelete\(url, _retry = true\) \{\s*const res = await fetch\(API_BASE \+ url, \{\s*method: 'DELETE',\s*headers: CBS\._getHeaders\(\)\s*\}\);/g, 
  \sync apiDelete(url, _retry = true) {
    let res;
    try {
      res = await CBS._fetchWithTimeout(API_BASE + url, {
        method: 'DELETE',
        headers: CBS._getHeaders()
      });
    } catch (err) {
      if (err.isOffline) return { ok: false, status: 0, json: async () => ({ success: false, message: 'لا يوجد اتصال' }) };
      throw err;
    }\);

fs.writeFileSync(file, content, 'utf8');
console.log('App.js patched for offline fetch timeouts!');
