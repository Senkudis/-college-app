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
    showError('يرجى ملء جميع الحقول المطلوبة');
    return;
  }

  if (!isValidEmail(email)) {
    showError('يرجى إدخال بريد إلكتروني صحيح');
    return;
  }

  // Disable button and show loading
  loginBtn.disabled = true;
  loadingState.classList.remove('hidden');

  try {
    const baseUrl = (typeof API_BASE !== 'undefined' && API_BASE !== 'undefined') ? API_BASE : '';
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
    showSuccess('تم تسجيل الدخول بنجاح! جاري التحويل...');

    // Redirect based on user role
    setTimeout(() => {
      const user = data.user;
      if (user.role === 'admin') {
        window.location.href = '/admin_dashboard.html';
      } else if (user.role === 'instructor') {
        window.location.href = '/dashboard.html';
      } else {
        window.location.href = '/dashboard.html';
      }
    }, 1500);

  } catch (error) {
    console.error('Login error:', error);
    showError(error.message || 'حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مجدداً');
  } finally {
    loginBtn.disabled = false;
    loadingState.classList.add('hidden');
  }
}

function showError(message) {
  const errorMessage = document.getElementById('errorMessage');
  const errorText = document.getElementById('errorText');
  errorText.textContent = message;
  errorMessage.classList.remove('hidden');
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    errorMessage.classList.add('hidden');
  }, 5000);

  // Shake animation
  errorMessage.style.animation = 'none';
  setTimeout(() => {
    errorMessage.style.animation = 'shake 0.5s ease';
  }, 10);
}

function showSuccess(message) {
  // Create toast notification
  const toast = document.createElement('div');
  toast.className = 'toast success';
  toast.innerHTML = `
    <i class="ri-check-circle-line toast-icon"></i>
    <span class="toast-message">${message}</span>
  `;
  
  const container = document.querySelector('.toast-container') || createToastContainer();
  container.appendChild(toast);

  // Auto-remove
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
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
