function showToast(title, type, duration) {
  type = type || 'info';
  duration = duration !== undefined ? duration : 5000;
  var container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  var icons = {
    info:      'ri-information-line',
    success:   'ri-checkbox-circle-fill',
    error:     'ri-error-warning-fill',
    warning:   'ri-alert-line',
    emergency: 'ri-alarm-warning-fill'
  };

  var t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'info');
  t.style.cursor = 'pointer';

  var safeTitle = (title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var iconClass = icons[type] || icons.info;

  t.innerHTML =
    '<i class="toast-icon ' + iconClass + '"></i>' +
    '<div style="flex:1;min-width:0">' +
      '<div class="toast-title">' + safeTitle + '</div>' +
    '</div>' +
    '<button onclick="event.stopPropagation();this.closest(\'.toast\').remove()" ' +
    'style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.5;font-size:1rem;padding:2px 4px;line-height:1;flex-shrink:0" ' +
    'title="\u0625\u063a\u0644\u0627\u0642">&#x2715;</button>';

  t.onclick = function() {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-30px)';
    setTimeout(function() { t.remove(); }, 300);
  };

  container.appendChild(t);

  requestAnimationFrame(function() {
    requestAnimationFrame(function() { t.classList.add('show'); });
  });

  if (duration > 0) {
    setTimeout(function() {
      if (!t.isConnected) return;
      t.classList.remove('show');
      setTimeout(function() { t.remove(); }, 400);
    }, duration);
  }
}
