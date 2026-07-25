const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { readDB, writeDB } = require('../data');
const { requireAuth, requireBoss } = require('../middleware');

const CATEGORIES = ['ルール', '技術要点', 'お知らせ'];
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.pdf`)
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('PDFファイルのみアップロードできます。'));
    }
    cb(null, true);
  }
});

function publicEntry(e) {
  return {
    id: e.id,
    category: e.category,
    title: e.title,
    description: e.description || '',
    hasFile: Boolean(e.storedFileName),
    fileName: e.fileName || null
  };
}

router.get('/', requireAuth, (req, res) => {
  const db = readDB();
  res.json({ entries: db.manualEntries.map(publicEntry), categories: CATEGORIES });
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
  res.status(201).json({ entry: publicEntry(entry) });
});

router.post('/upload', requireBoss, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'PDFファイルを選択してください。' });

    const { category } = req.body || {};
    if (!category || !CATEGORIES.includes(category)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: `カテゴリは${CATEGORIES.join('・')}のいずれかを指定してください。` });
    }

    const title = (req.body.title || '').trim() || req.file.originalname.replace(/\.pdf$/i, '');
    const db = readDB();
    const entry = {
      id: `mn-${crypto.randomUUID()}`,
      category,
      title,
      description: '',
      fileName: req.file.originalname,
      storedFileName: req.file.filename
    };
    db.manualEntries.push(entry);
    writeDB(db);
    res.status(201).json({ entry: publicEntry(entry) });
  });
});

router.get('/:id/file', requireAuth, (req, res) => {
  const db = readDB();
  const entry = db.manualEntries.find((e) => e.id === req.params.id);
  if (!entry || !entry.storedFileName) return res.status(404).json({ error: '見つかりません。' });
  const filePath = path.join(UPLOAD_DIR, entry.storedFileName);
  res.type('application/pdf');
  res.sendFile(filePath, { headers: { 'Content-Disposition': `inline; filename="${encodeURIComponent(entry.fileName || 'manual.pdf')}"` } });
});

router.delete('/:id', requireBoss, (req, res) => {
  const db = readDB();
  const entry = db.manualEntries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: '見つかりません。' });
  if (entry.storedFileName) {
    fs.unlink(path.join(UPLOAD_DIR, entry.storedFileName), () => {});
  }
  db.manualEntries = db.manualEntries.filter((e) => e.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
