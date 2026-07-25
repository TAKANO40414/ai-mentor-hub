document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const announcement = document.getElementById('announcement').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, announcement })
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
