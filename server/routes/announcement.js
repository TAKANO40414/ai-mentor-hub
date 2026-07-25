const express = require('express');
const router = express.Router();
const { readDB, writeDB } = require('../data');
const { requireBoss } = require('../middleware');

router.get('/', (req, res) => {
  const db = readDB();
  res.json({ announcement: db.announcement || null });
});

router.post('/', requireBoss, (req, res) => {
  const { text } = req.body || {};
  const db = readDB();
  if (!text || !text.trim()) {
    db.announcement = null;
  } else {
    db.announcement = {
      text: text.trim(),
      updatedBy: req.session.user.name,
      updatedAt: new Date().toISOString()
    };
  }
  writeDB(db);
  res.json({ announcement: db.announcement });
});

module.exports = router;
