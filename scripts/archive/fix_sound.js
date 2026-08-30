const fs = require('fs');
let content = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js', 'utf8');

const t = `        // ② Toast في التطبيق (دائماً   حتى لو على الهاتف)
        this.toast(n.title, n.message, isEmergency ? 'emergency' : 'info',
                   isEmergency ? 10000 : 6000);`;
const tr = t.replace(/\n/g, '\r\n');

const r = `        // ② Toast في التطبيق (دائماً   حتى لو على الهاتف)
        this.playNotificationSound(isEmergency);
        this.toast(n.title, n.message, isEmergency ? 'emergency' : 'info',
                   isEmergency ? 10000 : 6000);`;
const rr = r.replace(/\n/g, '\r\n');

if (content.includes(t)) content = content.split(t).join(r);
else if (content.includes(tr)) content = content.split(tr).join(rr);

fs.writeFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js', content, 'utf8');
console.log('Fixed');
