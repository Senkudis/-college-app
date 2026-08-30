const fs = require('fs');
const path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js';
let js = fs.readFileSync(path, 'utf8');

// The old block to replace (lines 1899-1921)
const oldUser = `          box-shadow: 0 2px 8px rgba(30,94,219,0.22);\r\n        }\r\n        .kedy-msg-bot {\r\n          align-self: flex-end;\r\n          background: var(--bg-card, #ffffff);\r\n          color: var(--text-main, #0f172a);\r\n          padding: 12px 16px;\r\n          border-radius: 16px 16px 16px 4px;\r\n          max-width: 88%; font-size: 0.88rem; line-height: 1.75;\r\n          border: 1px solid var(--border, #e2e8f0);\r\n          word-wrap: break-word; overflow-wrap: anywhere;\r\n          box-shadow: 0 1px 3px rgba(15,25,40,0.05);\r\n        }\r\n        .kedy-msg-bot strong { color: var(--primary, #1E5EDB); }\r\n        .kedy-msg-bot pre, .kedy-msg-bot table { max-width: 100%; overflow-x: auto; }`;

const newUser = `          box-shadow: 0 4px 12px rgba(79,70,229,0.28);\r\n          animation: kedyPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);\r\n        }\r\n        .kedy-msg-bot {\r\n          align-self: flex-end;\r\n          background: var(--bg-card, rgba(255,255,255,0.9));\r\n          color: var(--text-main, #0f172a);\r\n          padding: 14px 18px;\r\n          border-radius: 18px 18px 18px 4px;\r\n          max-width: 88%; font-size: 0.88rem; line-height: 1.75;\r\n          border: 1px solid var(--border, #e2e8f0);\r\n          word-wrap: break-word; overflow-wrap: anywhere;\r\n          box-shadow: 0 2px 8px rgba(15,23,42,0.06);\r\n          backdrop-filter: blur(12px);\r\n          -webkit-backdrop-filter: blur(12px);\r\n          animation: kedyPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);\r\n        }\r\n        @keyframes kedyPop {\r\n          from { opacity: 0; transform: scale(0.92) translateY(8px); }\r\n          to   { opacity: 1; transform: scale(1) translateY(0); }\r\n        }\r\n        .kedy-msg-bot strong { color: var(--primary, #4F46E5); }\r\n        .kedy-msg-bot pre, .kedy-msg-bot table { max-width: 100%; overflow-x: auto; }`;

// Also update the user msg gradient
const oldGradient = `background: linear-gradient(135deg, var(--primary, #1E5EDB), #4338ca);\r\n          color: #fff; padding: 10px 15px;\r\n          border-radius: 16px 16px 4px 16px;`;
const newGradient = `background: linear-gradient(135deg, #4F46E5, #7C3AED);\r\n          color: #fff; padding: 12px 18px;\r\n          border-radius: 18px 18px 4px 18px;`;

js = js.replace(oldGradient, newGradient);
js = js.replace(oldUser, newUser);

if (!js.includes('kedyPop')) {
  console.log('FAILED: replacement not applied');
} else {
  console.log('SUCCESS: Kedy chat bubbles updated');
}

fs.writeFileSync(path, js, 'utf8');
