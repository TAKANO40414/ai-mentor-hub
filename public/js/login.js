document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'ログインに失敗しました。';
      return;
    }
    window.location.href = '/index.html';
  } catch (err) {
    errorEl.textContent = '通信エラーが発生しました。';
  }
});

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatAnnounceDate(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

(async () => {
  try {
    const res = await fetch('/api/announcement');
    const data = await res.json();
    if (!data.announcement || !data.announcement.text) return;
    document.getElementById('announce-date').textContent = formatAnnounceDate(data.announcement.updatedAt);
    document.getElementById('announce-body').innerHTML = escapeHtml(data.announcement.text).replace(/\n/g, '<br>');
    document.getElementById('announce-modal').classList.remove('hidden');
  } catch (err) {
    /* ignore — announcement popup is non-critical */
  }
})();

document.getElementById('announce-close').addEventListener('click', () => {
  document.getElementById('announce-modal').classList.add('hidden');
});
