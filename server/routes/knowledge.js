const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { readDB, writeDB } = require('../data');
const { requireAuth, requireBoss } = require('../middleware');

function normalize(str) {
  return String(str || '').toLowerCase();
}

function scoreEntry(entry, query) {
  const q = normalize(query);
  let score = 0;
  for (const kw of entry.keywords) {
    if (q.includes(normalize(kw))) score += 3;
  }
  if (q.includes(normalize(entry.question))) score += 5;
  const qWords = q.split(/[\s、。,.！？!?]+/).filter(Boolean);
  const questionNorm = normalize(entry.question);
  for (const w of qWords) {
    if (w.length >= 2 && questionNorm.includes(w)) score += 1;
  }
  return score;
}

router.get('/', requireAuth, (req, res) => {
  const db = readDB();
  res.json({ knowledge: db.knowledge });
});

router.post('/ask', requireAuth, (req, res) => {
  const { question } = req.body || {};
  if (!question || !question.trim()) {
    return res.status(400).json({ error: '質問を入力してください。' });
  }
  const db = readDB();
  let best = null;
  let bestScore = 0;
  for (const entry of db.knowledge) {
    const s = scoreEntry(entry, question);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }
  if (best && bestScore >= 2) {
    return res.json({
      matched: true,
      answer: best.answer,
      question: best.question,
      category: best.category
    });
  }
  res.json({
    matched: false,
    answer: '該当するルールが見つかりませんでした。上司に直接質問してみましょう。'
  });
});

router.post('/', requireBoss, (req, res) => {
  const { question, answer, keywords, category } = req.body || {};
  if (!question || !answer) {
    return res.status(400).json({ error: '質問と回答は必須です。' });
  }
  const db = readDB();
  const entry = {
    id: `k-${crypto.randomUUID()}`,
    question: question.trim(),
    answer: answer.trim(),
    keywords: Array.isArray(keywords) ? keywords.filter(Boolean) : String(keywords || '').split(',').map((s) => s.trim()).filter(Boolean),
    category: category || 'その他'
  };
  db.knowledge.push(entry);
  writeDB(db);
  res.status(201).json({ entry });
});

router.delete('/:id', requireBoss, (req, res) => {
  const db = readDB();
  const before = db.knowledge.length;
  db.knowledge = db.knowledge.filter((k) => k.id !== req.params.id);
  if (db.knowledge.length === before) {
    return res.status(404).json({ error: '見つかりません。' });
  }
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
