const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { readDB, writeDB } = require('../data');
const { requireMaintenance } = require('../middleware');

const TYPES = ['boss', 'member'];

router.get('/', requireMaintenance, (req, res) => {
  const db = readDB();
  res.json({ roles: db.roles });
});

router.post('/', requireMaintenance, (req, res) => {
  const { name, type } = req.body || {};
  const trimmed = (name || '').trim();
  if (!trimmed || trimmed.length > 20) {
    return res.status(400).json({ error: '役職名は1〜20文字で入力してください。' });
  }
  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: '権限は上司相当または部下相当を選択してください。' });
  }
  const db = readDB();
  if (db.roles.some((r) => r.name === trimmed)) {
    return res.status(400).json({ error: `役職「${trimmed}」は既に存在します。` });
  }
  const role = { id: `r-${crypto.randomUUID()}`, name: trimmed, type };
  db.roles.push(role);
  writeDB(db);
  res.status(201).json({ role });
});

router.delete('/:id', requireMaintenance, (req, res) => {
  const db = readDB();
  const role = db.roles.find((r) => r.id === req.params.id);
  if (!role) return res.status(404).json({ error: '役職が見つかりません。' });
  if (db.roles.length <= 1) {
    return res.status(400).json({ error: '役職は最低1つ必要です。' });
  }
  const inUse = db.users.filter((u) => u.roleName === role.name).length;
  if (inUse > 0) {
    return res.status(400).json({ error: `役職「${role.name}」は${inUse}人のユーザーに設定されているため削除できません。先にユーザーの役職を変更してください。` });
  }
  db.roles = db.roles.filter((r) => r.id !== role.id);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
