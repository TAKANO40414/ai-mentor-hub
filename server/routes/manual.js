const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { readDB, writeDB } = require('../data');
const { requireAuth, requireBoss } = require('../middleware');

const CATEGORIES = ['ルール', '技術要点', 'お知らせ'];

router.get('/', requireAuth, (req, res) => {
  const db = readDB();
  res.json({ entries: db.manualEntries, categories: CATEGORIES });
});

router.post('/', requireBoss, (req, res) => {
  const { category, title, description } = req.body || {};
  if (!category || !title) {
    return res.status(400).json({ error: 'カテゴリとタイトルは必須です。' });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `カテゴリは${CATEGORIES.join('・')}のいずれかを指定してください。` });
  }
  const db = readDB();
  const entry = {
    id: `mn-${crypto.randomUUID()}`,
    category,
    title: title.trim(),
    description: (description || '').trim()
  };
  db.manualEntries.push(entry);
  writeDB(db);
  res.status(201).json({ entry });
});

router.delete('/:id', requireBoss, (req, res) => {
  const db = readDB();
  const before = db.manualEntries.length;
  db.manualEntries = db.manualEntries.filter((e) => e.id !== req.params.id);
  if (db.manualEntries.length === before) return res.status(404).json({ error: '見つかりません。' });
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
