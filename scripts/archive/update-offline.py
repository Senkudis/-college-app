import sys

file_path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

fetch_with_timeout = '''  async _fetchWithTimeout(url, options = {}) {
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
  },'''

import re

# Add _fetchWithTimeout before apiGet
content = re.sub(r'async apiGet\(url, _retry = true\) \{', fetch_with_timeout + '\n\n  async apiGet(url, _retry = true) {', content, 1)

# Replace fetch in apiGet
content = re.sub(r'res = await fetch\(API_BASE \+ url, \{ headers: CBS\._getHeaders\(\) \}\);', 
                 'res = await CBS._fetchWithTimeout(API_BASE + url, { headers: CBS._getHeaders() });', content)

# Rewrite apiPost
old_api_post = r"async apiPost\(url, body, method = 'POST', _retry = true\) \{\s*const res = await fetch\(API_BASE \+ url, \{\s*method,\s*headers: CBS\._getHeaders\(\{ 'Content-Type': 'application/json' \}\),\s*body: JSON\.stringify\(body\)\s*\}\);"
new_api_post = '''async apiPost(url, body, method = 'POST', _retry = true) {
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
    }'''
content = re.sub(old_api_post, new_api_post, content)

# Rewrite apiDelete
old_api_delete = r"async apiDelete\(url, _retry = true\) \{\s*const res = await fetch\(API_BASE \+ url, \{\s*method: 'DELETE',\s*headers: CBS\._getHeaders\(\)\s*\}\);"
new_api_delete = '''async apiDelete(url, _retry = true) {
    let res;
    try {
      res = await CBS._fetchWithTimeout(API_BASE + url, {
        method: 'DELETE',
        headers: CBS._getHeaders()
      });
    } catch (err) {
      if (err.isOffline) return { ok: false, status: 0, json: async () => ({ success: false, message: 'لا يوجد اتصال' }) };
      throw err;
    }'''
content = re.sub(old_api_delete, new_api_delete, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("app.js updated successfully")
