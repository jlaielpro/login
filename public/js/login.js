import {
  api,
  hideAlert,
  initials,
  setLoading,
  showAlert,
} from './common.js';

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('formError');
const noticeBox = document.getElementById('formNotice');
const sessionBox = document.getElementById('session');
const sessionEmail = document.getElementById('sessionEmail');
const sessionNote = document.getElementById('sessionNote');
const avatar = document.getElementById('avatar');
const adminLink = document.getElementById('adminLink');
const switchLine = document.getElementById('switchLine');
const signOutBtn = document.getElementById('signOutBtn');
const submitBtn = form.querySelector('button[type="submit"]');
const emailInput = form.elements.email;
const passwordInput = form.elements.password;

function showSession(user) {
  form.hidden = true;
  switchLine.hidden = true;
  hideAlert(errorBox);
  hideAlert(noticeBox);
  hideAlert(sessionNote);
  sessionBox.hidden = false;
  sessionEmail.textContent = user.email;
  avatar.textContent = initials(user.name);
  adminLink.hidden = user.role !== 'admin';
}

function showLoginForm() {
  form.hidden = false;
  switchLine.hidden = false;
  sessionBox.hidden = true;
}

async function init() {
  const params = new URLSearchParams(location.search);
  const wantsAdmin = params.get('next') === 'admin';

  if (params.get('notice') === 'created') {
    showAlert(noticeBox, 'Account created. Sign in to continue.', 'ok');
  }
  const email = params.get('email');
  if (email) emailInput.value = email;

  try {
    const { user } = await api('/api/me');
    if (user) {
      showSession(user);
      if (wantsAdmin && user.role !== 'admin') {
        showAlert(
          sessionNote,
          'This account does not have admin access. Sign in with an admin account to open the admin panel.',
        );
      }
    } else {
      showLoginForm();
      if (wantsAdmin) {
        showAlert(errorBox, 'Sign in with an admin account to open the admin panel.');
      }
    }
  } catch {
    showLoginForm();
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(errorBox);
  hideAlert(noticeBox);

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showAlert(errorBox, 'Enter your email and password.');
    return;
  }

  setLoading(submitBtn, true, 'Signing in…');
  try {
    const { user } = await api('/api/login', {
      method: 'POST',
      body: { email, password },
    });

    form.reset();

    if (user.role === 'admin') {
      location.replace('/admin.html');
      return;
    }

    showSession(user);
  } catch (error) {
    showAlert(errorBox, error.message);
    passwordInput.value = '';
    passwordInput.focus();
  } finally {
    setLoading(submitBtn, false);
  }
});

signOutBtn.addEventListener('click', async () => {
  signOutBtn.disabled = true;
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* Nothing to do — reload will reflect the real state. */
  } finally {
    location.replace('/login.html');
  }
});

init();
