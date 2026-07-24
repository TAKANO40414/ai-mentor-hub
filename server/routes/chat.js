const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { readDB, writeDB } = require('../data');
const { requireAuth } = require('../middleware');

function findBoss(db) {
  return db.users.find((u) => u.role === 'boss');
}

router.get('/thread/:partnerId', requireAuth, (req, res) => {
  const db = readDB();
  const me = req.session.user;
  const partnerId = req.params.partnerId;

  if (me.role === 'member' && partnerId !== findBoss(db).id) {
    return res.status(403).json({ error: '上司とのチャットのみ利用できます。' });
  }

  const thread = db.messages
    .filter(
      (m) =>
        (m.fromUserId === me.id && m.toUserId === partnerId) ||
        (m.fromUserId === partnerId && m.toUserId === me.id)
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  res.json({ thread });
});

router.post('/thread/:partnerId', requireAuth, (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: '本文を入力してください。' });
  }
  const db = readDB();
  const me = req.session.user;
  const partnerId = req.params.partnerId;

  if (me.role === 'member' && partnerId !== findBoss(db).id) {
    return res.status(403).json({ error: '上司とのチャットのみ利用できます。' });
  }
  if (!db.users.find((u) => u.id === partnerId)) {
    return res.status(404).json({ error: '宛先が見つかりません。' });
  }

  const message = {
    id: `m-${crypto.randomUUID()}`,
    fromUserId: me.id,
    toUserId: partnerId,
    text: text.trim(),
    timestamp: new Date().toISOString()
  };
  db.messages.push(message);
  writeDB(db);
  res.status(201).json({ message });
});

module.exports = router;
