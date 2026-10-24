import { api, hideAlert, setLoading, showAlert } from './common.js';

const form = document.getElementById('signupForm');
const errorBox = document.getElementById('formError');
const submitBtn = form.querySelector('button[type="submit"]');
const nameInput = form.elements.name;
const emailInput = form.elements.email;
const passwordInput = form.elements.password;
const confirmInput = form.elements.confirm;

function clearInvalid() {
  for (const input of [nameInput, emailInput, passwordInput, confirmInput]) {
    input.removeAttribute('aria-invalid');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(errorBox);
  clearInvalid();

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const confirm = confirmInput.value;

  if (!name || !email || !password) {
    showAlert(errorBox, 'Fill in every field to create your account.');
    return;
  }

  if (password.length < 8) {
    passwordInput.setAttribute('aria-invalid', 'true');
    passwordInput.focus();
    showAlert(errorBox, 'Password must be at least 8 characters.');
    return;
  }

  if (password !== confirm) {
    confirmInput.setAttribute('aria-invalid', 'true');
    confirmInput.focus();
    showAlert(errorBox, 'The passwords do not match.');
    return;
  }

  setLoading(submitBtn, true, 'Creating…');
  try {
    await api('/api/signup', {
      method: 'POST',
      body: { name, email, password },
    });

    const params = new URLSearchParams({ notice: 'created', email });
    location.replace(`/login.html?${params.toString()}`);
  } catch (error) {
    if (error.fields) {
      const map = {
        name: nameInput,
        email: emailInput,
        password: passwordInput,
      };
      for (const [field, message] of Object.entries(error.fields)) {
        if (map[field]) {
          map[field].setAttribute('aria-invalid', 'true');
          if (field === 'name') nameInput.focus();
          if (field === 'email') emailInput.focus();
          if (field === 'password') passwordInput.focus();
        }
        if (message) break;
      }
    }
    showAlert(errorBox, error.message);
  } finally {
    setLoading(submitBtn, false);
  }
});

nameInput.focus();
