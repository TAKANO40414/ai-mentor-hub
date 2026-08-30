async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/login.html';
    throw new Error('unauthenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました。');
  return data;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TYPE_LABELS = { boss: '上司相当', member: '部下相当' };
let roles = [];

function roleOptions(selectedRole) {
  // ユーザーの現在の役職名に一致する役職を優先し、無ければ権限タイプで代替する
  let selectedId = null;
  if (selectedRole) {
    const byName = roles.find((r) => r.name === selectedRole.roleName);
    const byType = roles.find((r) => r.type === selectedRole.role);
    selectedId = (byName || byType || {}).id;
  }
  return roles
    .map((r) => `<option value="${r.id}"${r.id === selectedId ? ' selected' : ''}>${escapeHtml(r.name)}（${TYPE_LABELS[r.type]}）</option>`)
    .join('');
}

async function loadRoles() {
  const errEl = document.getElementById('role-error');
  errEl.textContent = '';
  ({ roles } = await api('/api/roles'));
  const listEl = document.getElementById('role-list');
  listEl.innerHTML = '';
  roles.forEach((r) => {
    const chip = document.createElement('span');
    chip.className = `role-chip ${r.type}`;
    chip.innerHTML = `${escapeHtml(r.name)}<span class="type">${TYPE_LABELS[r.type]}</span><button type="button" aria-label="削除">✕</button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`役職「${r.name}」を削除しますか？`)) return;
      errEl.textContent = '';
      try {
        await api(`/api/roles/${r.id}`, { method: 'DELETE' });
        await loadRoles();
        loadUsers();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
    listEl.appendChild(chip);
  });
  document.getElementById('add-role').innerHTML = roleOptions(null);
}

async function loadUsers() {
  const listEl = document.getElementById('user-list');
  const errEl = document.getElementById('list-error');
  errEl.textContent = '';
  const { users } = await api('/api/users');
  if (!users.length) {
    listEl.innerHTML = '<p class="empty-msg">登録されているユーザーはいません。</p>';
    return;
  }
  listEl.innerHTML = '';
  users.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'user-row';
    row.innerHTML = `
      <span class="role-tag ${u.role}">${escapeHtml(u.roleName || (u.role === 'boss' ? '上司' : '部下'))}</span>
      <div class="user-row-grid">
        <label>名前<input type="text" class="f-name" value="${escapeHtml(u.name)}" /></label>
        <label>役職<select class="f-role">${roleOptions(u)}</select></label>
        <label>ID<input type="text" class="f-username" value="${escapeHtml(u.username)}" /></label>
        <label>新しいパスワード<input type="password" class="f-password" placeholder="変更する場合のみ入力" autocomplete="new-password" /></label>
      </div>
      <div class="user-row-actions">
        <button type="button" class="small-btn f-save">保存</button>
        <button type="button" class="small-btn danger-btn f-del">削除</button>
        <span class="error-text f-msg" style="align-self: center;"></span>
      </div>
    `;
    const msg = row.querySelector('.f-msg');
    row.querySelector('.f-save').addEventListener('click', async () => {
      msg.textContent = '';
      try {
        await api(`/api/users/${u.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: row.querySelector('.f-name').value.trim(),
            roleId: row.querySelector('.f-role').value,
            username: row.querySelector('.f-username').value.trim(),
            password: row.querySelector('.f-password').value || undefined
          })
        });
        loadUsers();
      } catch (err) {
        msg.textContent = err.message;
      }
    });
    row.querySelector('.f-del').addEventListener('click', async () => {
      if (!confirm(`「${u.name}」を削除しますか？この操作は取り消せません。`)) return;
      msg.textContent = '';
      try {
        await api(`/api/users/${u.id}`, { method: 'DELETE' });
        loadUsers();
      } catch (err) {
        msg.textContent = err.message;
      }
    });
    listEl.appendChild(row);
  });
}

document.getElementById('role-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('role-error');
  errEl.textContent = '';
  try {
    await api('/api/roles', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('role-add-name').value.trim(),
        type: document.getElementById('role-add-type').value
      })
    });
    e.target.reset();
    await loadRoles();
    loadUsers();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('user-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('add-error');
  errEl.textContent = '';
  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('add-name').value.trim(),
        roleId: document.getElementById('add-role').value,
        username: document.getElementById('add-username').value.trim(),
        password: document.getElementById('add-password').value
      })
    });
    e.target.reset();
    loadUsers();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

(async () => {
  try {
    const { user } = await api('/api/auth/me');
    if (user.role !== 'maintenance') {
      window.location.href = '/login.html';
      return;
    }
    await loadRoles();
    loadUsers();
  } catch (err) {
    /* api() redirects to login on 401 */
  }
})();
