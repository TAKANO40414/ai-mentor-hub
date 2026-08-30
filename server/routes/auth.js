const express = require('express');
const router = express.Router();
const { readDB } = require('../data');
const { verifyPassword } = require('../crypto-util');

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, roleName: u.roleName || null };
}

router.post('/login', (req, res) => {
  const { username, password, target } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください。' });
  }
  const db = readDB();
  const user = db.users.find((u) => u.username === username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません。' });
  }
  if (target === 'maintenance' && user.role !== 'maintenance') {
    return res.status(403).json({ error: 'このアカウントではメンテナンス画面にログインできません。' });
  }
  if (target !== 'maintenance' && user.role === 'maintenance') {
    return res.status(403).json({ error: 'メンテナンス用アカウントです。ログイン先で「メンテナンス画面」を選択してください。' });
  }
  req.session.user = publicUser(user);
  res.json({ user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '未ログイン' });
  const db = readDB();
  const members = db.users.filter((u) => u.role === 'member').map(publicUser);
  const boss = db.users.find((u) => u.role === 'boss');
  res.json({ user: req.session.user, members, boss: boss ? publicUser(boss) : null, announcement: db.announcement || null });
});

module.exports = router;
