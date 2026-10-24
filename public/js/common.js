export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data && data.error ? data.error : `Request failed (${response.status}).`,
    );
    error.status = response.status;
    error.fields = (data && data.fields) || null;
    throw error;
  }

  return data;
}

export function showAlert(element, message, kind = 'error') {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('alert-error', 'alert-ok');
  element.classList.add(kind === 'ok' ? 'alert-ok' : 'alert-error');
  element.hidden = false;
}

export function hideAlert(element) {
  if (!element) return;
  element.hidden = true;
  element.textContent = '';
}

export function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function setLoading(button, loading, label = 'Please wait…') {
  if (!button) return;
  const text = button.querySelector('.btn-label');
  const spinner = button.querySelector('.spinner');
  button.disabled = loading;
  if (spinner) spinner.hidden = !loading;
  if (text) {
    if (loading) {
      text.dataset.original = text.textContent;
      text.textContent = label;
    } else if (text.dataset.original) {
      text.textContent = text.dataset.original;
      delete text.dataset.original;
    }
  }
}
