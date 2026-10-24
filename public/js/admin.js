import { api, formatDate, showAlert } from './common.js';

const state = {
  me: null,
  users: [],
  query: '',
  pendingDelete: null,
};

const tbody = document.getElementById('usersBody');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const tableError = document.getElementById('tableError');
const searchInput = document.getElementById('searchInput');
const toast = document.getElementById('toast');
const deleteDialog = document.getElementById('deleteDialog');
const deleteText = document.getElementById('deleteText');
const confirmDelete = document.getElementById('confirmDelete');

let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function textCell(text, className) {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function render() {
  tbody.replaceChildren();

  const query = state.query.trim().toLowerCase();
  const visible = state.users.filter((user) => {
    if (!query) return true;
    return (
      user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query)
    );
  });

  for (const user of visible) {
    const row = document.createElement('tr');

    row.append(textCell(String(user.id), 'cell-id'));
    row.append(textCell(user.name, 'cell-name'));
    row.append(textCell(user.email, 'cell-email'));

    const roleCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = user.role === 'admin' ? 'badge badge-admin' : 'badge';
    badge.textContent = user.role;
    roleCell.append(badge);
    row.append(roleCell);

    row.append(textCell(formatDate(user.created_at), 'cell-date'));
    row.append(textCell(formatDate(user.last_login_at), 'cell-date'));

    const actionCell = document.createElement('td');
    actionCell.className = 'ta-right';
    const button = document.createElement('button');
    button.className = 'btn btn-danger btn-sm';
    button.type = 'button';
    button.textContent = 'Delete';

    if (user.id === state.me.id) {
      button.disabled = true;
      button.title = 'You cannot delete your own account.';
    } else {
      button.addEventListener('click', () => openDeleteDialog(user));
    }

    actionCell.append(button);
    row.append(actionCell);
    tbody.append(row);
  }

  const hasUsers = state.users.length > 0;
  emptyState.hidden = visible.length > 0;
  emptyState.textContent = hasUsers
    ? 'No users match your search.'
    : 'No accounts yet. As soon as someone signs up, they appear here.';

  updateStats();
}

function updateStats() {
  const today = new Date().toDateString();
  const admins = state.users.filter((user) => user.role === 'admin').length;
  const newToday = state.users.filter(
    (user) => new Date(user.created_at).toDateString() === today,
  ).length;

  document.getElementById('statTotal').textContent = String(state.users.length);
  document.getElementById('statAdmins').textContent = String(admins);
  document.getElementById('statToday').textContent = String(newToday);
}

async function loadUsers() {
  loadingState.hidden = false;
  emptyState.hidden = true;
  tableError.hidden = true;
  tbody.replaceChildren();

  try {
    const { users } = await api('/api/admin/users');
    state.users = users;
    render();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      location.replace('/login.html');
      return;
    }
    showAlert(tableError, error.message);
    emptyState.hidden = true;
  } finally {
    loadingState.hidden = true;
  }
}

function openDeleteDialog(user) {
  state.pendingDelete = user;
  deleteText.textContent = `This permanently removes ${user.name} (${user.email}) and signs them out everywhere.`;
  confirmDelete.disabled = false;
  deleteDialog.showModal();
}

confirmDelete.addEventListener('click', async () => {
  const user = state.pendingDelete;
  if (!user) return;

  confirmDelete.disabled = true;
  try {
    await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    state.pendingDelete = null;
    deleteDialog.close();
    state.users = state.users.filter((entry) => entry.id !== user.id);
    render();
    showToast(`Deleted ${user.email}.`);
  } catch (error) {
    deleteDialog.close();
    showAlert(tableError, error.message);
    showToast(error.message);
  } finally {
    confirmDelete.disabled = false;
  }
});

document.getElementById('cancelDelete').addEventListener('click', () => {
  state.pendingDelete = null;
  deleteDialog.close();
});

deleteDialog.addEventListener('click', (event) => {
  if (event.target !== deleteDialog) return;
  const rect = deleteDialog.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  if (!inside) deleteDialog.close();
});

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  render();
});

document.getElementById('refreshBtn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  await loadUsers();
  button.disabled = false;
});

document.getElementById('logoutBtn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* ignore — redirect anyway */
  } finally {
    location.replace('/login.html');
  }
});

async function init() {
  try {
    const { user } = await api('/api/me');
    if (!user || user.role !== 'admin') {
      location.replace('/login.html');
      return;
    }
    state.me = user;
    document.getElementById('adminEmail').textContent = user.email;
  } catch {
    location.replace('/login.html');
    return;
  }

  await loadUsers();
}

init();
