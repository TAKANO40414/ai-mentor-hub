const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { readDB, writeDB, todayStr } = require('../data');
const { requireAuth, requireBoss } = require('../middleware');

router.get('/today', requireAuth, (req, res) => {
  const db = readDB();
  const today = todayStr();
  const tips = db.techTips.filter((t) => t.date === today);
  res.json({ date: today, tips });
});

router.get('/', requireBoss, (req, res) => {
  const db = readDB();
  res.json({ tips: db.techTips.sort((a, b) => b.date.localeCompare(a.date)) });
});

router.post('/', requireBoss, (req, res) => {
  const { date, technology, description, relatedTask } = req.body || {};
  if (!date || !technology) {
    return res.status(400).json({ error: '日付と技術名は必須です。' });
  }
  const db = readDB();
  const tip = {
    id: `t-${crypto.randomUUID()}`,
    date,
    technology,
    description: description || '',
    relatedTask: relatedTask || ''
  };
  db.techTips.push(tip);
  writeDB(db);
  res.status(201).json({ tip });
});

router.delete('/:id', requireBoss, (req, res) => {
  const db = readDB();
  const before = db.techTips.length;
  db.techTips = db.techTips.filter((t) => t.id !== req.params.id);
  if (db.techTips.length === before) return res.status(404).json({ error: '見つかりません。' });
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
