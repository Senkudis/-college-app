/**
 * Login Page JavaScript
 * Modern login functionality with enhanced UX
 */

document.addEventListener('DOMContentLoaded', () => {
  initializeLogin();
});

function initializeLogin() {
  const loginForm = document.getElementById('loginForm');
  const togglePassword = document.getElementById('togglePassword');
  const passwordInput = document.getElementById('password');
  const rememberMe = document.getElementById('rememberMe');
  const emailInput = document.getElementById('email');

  // Restore saved email if available
  const savedEmail = localStorage.getItem('rememberedEmail');
  if (savedEmail) {
    emailInput.value = savedEmail;
    rememberMe.checked = true;
  }

  // Toggle password visibility
  if (togglePassword) {
    togglePassword.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      togglePassword.innerHTML = isPassword 
        ? '<i class="ri-eye-off-line"></i>' 
        : '<i class="ri-eye-line"></i>';
    });
  }

  // Handle form submission
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  // Auto-redirect if already logged in
  if (localStorage.getItem('token')) {
    window.location.href = '/dashboard.html';
  }

  // Add enter key support
  emailInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') passwordInput.focus();
  });

  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginForm.dispatchEvent(new Event('submit'));
  });
}

async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('rememberMe').checked;
  const loginBtn = document.querySelector('.login-btn');
  const errorMessage = document.getElementById('errorMessage');
  const loadingState = document.getElementById('loadingState');
  const errorText = document.getElementById('errorText');

  // Validation
  if (!email || !password) {
    showToast('يرجى ملء جميع الحقول المطلوبة', 'error');
    return;
  }

  if (!isValidEmail(email)) {
    showToast('يرجى إدخال بريد إلكتروني صحيح', 'error');
    return;
  }

  // Disable button and show loading
  loginBtn.disabled = true;
  loadingState.classList.remove('hidden');
  try {
    const isCapacitorNative = !!(window.Capacitor?.isNativePlatform?.());
    const baseUrl = (typeof API_BASE !== 'undefined' && API_BASE && API_BASE !== 'undefined') 
      ? API_BASE 
      : (isCapacitorNative ? 'https://elnasrcsit.website' : '');
    const response = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'فشل تسجيل الدخول');
    }

    // Save token
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    // Save email if remember me is checked
    if (rememberMe) {
      localStorage.setItem('rememberedEmail', email);
    } else {
      localStorage.removeItem('rememberedEmail');
    }

    // Show success message
    showToast('تم تسجيل الدخول بنجاح! جاري التحويل...', 'success');

    // Redirect based on user role
    setTimeout(() => {
      const user = data.user || {};
      const roles = user.roles || (user.role ? [user.role] : []);
      if (roles.includes('admin') || roles.includes('dean')) {
        window.location.href = '/admin_dashboard.html';
      } else {
        window.location.href = '/dashboard.html';
      }
    }, 1500);

  } catch (error) {
    console.error('Login error:', error);
    showToast(error.message || 'حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مجدداً', 'error');
  } finally {
    loginBtn.disabled = false;
    loadingState.classList.add('hidden');
  }
}

function showToast(title, type = 'info', duration = 5000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    info:      'ri-information-line',
    success:   'ri-checkbox-circle-fill',
    error:     'ri-error-warning-fill',
    warning:   'ri-alert-line',
    emergency: 'ri-alarm-warning-fill'
  };

  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.style.cursor = 'pointer';
  
  const safeTitle = (title||'').replace(/</g, "&lt;").replace(/>/g, "&gt;");
  
  t.innerHTML = `
    <i class="toast-icon ${icons[type] || icons.info}"></i>
    <div style="flex:1;min-width:0">
      <div class="toast-title">${safeTitle}</div>
    </div>
    <button onclick="event.stopPropagation();this.closest('.toast').remove()" style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.5;font-size:1rem;padding:2px 4px;line-height:1;flex-shrink:0" title="إغلاق"></button>`;

  t.onclick = () => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-30px)';
    setTimeout(() => t.remove(), 300);
  };

  container.appendChild(t);

  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));

  if (duration > 0) {
    setTimeout(() => {
      if (!t.isConnected) return;
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, duration);
  }
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Add shake animation
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
  }
`;
document.head.appendChild(style);
