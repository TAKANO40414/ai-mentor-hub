const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { readDB, writeDB } = require('../data');
const { hashPassword } = require('../crypto-util');
const { requireMaintenance } = require('../middleware');

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, roleName: u.roleName || null };
}

function validate(db, { username, name, roleId, password }, { requirePassword, excludeId }) {
  if (!name || !name.trim()) return { error: '名前を入力してください。' };
  const role = db.roles.find((r) => r.id === roleId);
  if (!role) return { error: '役職を選択してください。' };
  if (!username || !/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
    return { error: 'IDは半角英数字（3〜20文字、-_可）で入力してください。' };
  }
  if (db.users.some((u) => u.username === username && u.id !== excludeId)) {
    return { error: `ID「${username}」は既に使われています。` };
  }
  if (requirePassword && (!password || password.length < 6)) {
    return { error: 'パスワードは6文字以上で入力してください。' };
  }
  if (password && password.length < 6) return { error: 'パスワードは6文字以上で入力してください。' };
  return { role };
}

router.get('/', requireMaintenance, (req, res) => {
  const db = readDB();
  res.json({ users: db.users.filter((u) => u.role !== 'maintenance').map(publicUser) });
});

router.post('/', requireMaintenance, (req, res) => {
  const { username, name, roleId, password } = req.body || {};
  const db = readDB();
  const { error, role } = validate(db, { username, name, roleId, password }, { requirePassword: true });
  if (error) return res.status(400).json({ error });

  const user = {
    id: `u-${crypto.randomUUID()}`,
    username: username.trim(),
    name: name.trim(),
    role: role.type,
    roleName: role.name,
    passwordHash: hashPassword(password)
  };
  db.users.push(user);
  writeDB(db);
  res.status(201).json({ user: publicUser(user) });
});

router.put('/:id', requireMaintenance, (req, res) => {
  const db = readDB();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user || user.role === 'maintenance') {
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  const { username, name, roleId, password } = req.body || {};
  const { error, role } = validate(db, { username, name, roleId, password }, { requirePassword: false, excludeId: user.id });
  if (error) return res.status(400).json({ error });

  user.username = username.trim();
  user.name = name.trim();
  user.role = role.type;
  user.roleName = role.name;
  if (password) user.passwordHash = hashPassword(password);
  writeDB(db);
  res.json({ user: publicUser(user) });
});

router.delete('/:id', requireMaintenance, (req, res) => {
  const db = readDB();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user || user.role === 'maintenance') {
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }
  db.users = db.users.filter((u) => u.id !== user.id);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
