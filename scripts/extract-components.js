const fs = require('fs');
const html = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/dashboard.html', 'utf8');

const sidebarStart = html.indexOf('<!-- Sidebar -->');
const sidebarEnd = html.indexOf('<!-- Main Content -->');
const sidebarContent = html.substring(sidebarStart, sidebarEnd).trim();

const navbarStart = html.indexOf('<nav class="top-nav">');
const navbarEnd = html.indexOf('</nav>', navbarStart) + 6;
const navbarContent = html.substring(navbarStart, navbarEnd).trim();

if (!fs.existsSync('c:/Users/kde/Desktop/kedwebcbs-main/www/components')) {
    fs.mkdirSync('c:/Users/kde/Desktop/kedwebcbs-main/www/components');
}

fs.writeFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/components/sidebar.html', sidebarContent, 'utf8');
fs.writeFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/components/navbar.html', navbarContent, 'utf8');

console.log('Sidebar length:', sidebarContent.length);
console.log('Navbar length:', navbarContent.length);
