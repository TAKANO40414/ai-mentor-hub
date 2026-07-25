const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { readDB, writeDB, todayStr, localDateStr } = require('../data');
const { requireAuth, requireBoss } = require('../middleware');

const WORK_START = '09:00';
const WORK_END = '18:00';

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function computeFreeSlots(entries, date) {
  const busy = entries
    .filter((e) => e.date === date && e.status === 'busy')
    .map((e) => [timeToMinutes(e.startTime), timeToMinutes(e.endTime)])
    .sort((a, b) => a[0] - b[0]);

  const slots = [];
  let cursor = timeToMinutes(WORK_START);
  const end = timeToMinutes(WORK_END);
  for (const [bStart, bEnd] of busy) {
    if (bStart > cursor) slots.push([cursor, Math.min(bStart, end)]);
    cursor = Math.max(cursor, bEnd);
  }
  if (cursor < end) slots.push([cursor, end]);

  const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return slots.filter(([s, e]) => e > s).map(([s, e]) => ({ start: toTime(s), end: toTime(e) }));
}

function currentStatus(entries) {
  const today = todayStr();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const busyNow = entries.some(
    (e) =>
      e.date === today &&
      e.status === 'busy' &&
      nowMinutes >= timeToMinutes(e.startTime) &&
      nowMinutes < timeToMinutes(e.endTime)
  );
  const withinWork = nowMinutes >= timeToMinutes(WORK_START) && nowMinutes < timeToMinutes(WORK_END);
  return withinWork && !busyNow;
}

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return localDateStr(d);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

router.get('/week', requireAuth, (req, res) => {
  const db = readDB();
  const base = req.query.date || todayStr();
  const start = mondayOf(base);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const viewerId = req.session.user.id;
  const boss = db.users.find((u) => u.role === 'boss');
  const bossId = boss ? boss.id : null;

  const entries = db.scheduleEntries
    .filter((e) => days.includes(e.date))
    .map((e) => {
      if (e.ownerId === viewerId) {
        return { id: e.id, date: e.date, startTime: e.startTime, endTime: e.endTime, title: e.title, status: e.status, source: 'mine' };
      }
      if (e.ownerId === bossId) {
        return { date: e.date, startTime: e.startTime, endTime: e.endTime, status: e.status, source: 'boss' };
      }
      return null;
    })
    .filter(Boolean);

  const isBoss = req.session.user.role === 'boss';
  const appointments = db.appointmentRequests
    .filter((a) => days.includes(a.date) && a.status === 'pending' && (isBoss || a.fromUserId === viewerId))
    .map((a) => ({
      id: a.id,
      date: a.date,
      startTime: a.startTime,
      endTime: a.endTime,
      reason: a.reason,
      fromUserName: a.fromUserName,
      mine: a.fromUserId === viewerId
    }));

  res.json({ start, days, entries, appointments });
});

router.get('/today', requireAuth, (req, res) => {
  const db = readDB();
  const boss = db.users.find((u) => u.role === 'boss');
  const bossEntries = db.scheduleEntries.filter((e) => e.ownerId === (boss && boss.id));
  const today = todayStr();
  const freeSlots = computeFreeSlots(bossEntries, today);
  res.json({
    date: today,
    canAskNow: currentStatus(bossEntries),
    busyBlocks: bossEntries.filter((e) => e.date === today && e.status === 'busy'),
    freeSlots
  });
});

router.post('/entries', requireAuth, (req, res) => {
  const { date, startTime, endTime, title } = req.body || {};
  if (!date || !startTime || !endTime || !title) {
    return res.status(400).json({ error: '日付・時間・タイトルは必須です。' });
  }
  const db = readDB();
  const entry = { id: `s-${crypto.randomUUID()}`, ownerId: req.session.user.id, date, startTime, endTime, title, status: 'busy' };
  db.scheduleEntries.push(entry);
  writeDB(db);
  res.status(201).json({ entry });
});

router.delete('/entries/:id', requireAuth, (req, res) => {
  const db = readDB();
  const entry = db.scheduleEntries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: '見つかりません。' });
  if (entry.ownerId !== req.session.user.id) {
    return res.status(403).json({ error: '自分の予定のみ削除できます。' });
  }
  db.scheduleEntries = db.scheduleEntries.filter((e) => e.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

router.get('/appointments', requireAuth, (req, res) => {
  const db = readDB();
  const isBoss = req.session.user.role === 'boss';
  const list = isBoss
    ? db.appointmentRequests
    : db.appointmentRequests.filter((a) => a.fromUserId === req.session.user.id);
  res.json({ appointments: list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
});

router.post('/appointments', requireAuth, (req, res) => {
  const { date, startTime, endTime, reason } = req.body || {};
  if (!date || !startTime || !endTime) {
    return res.status(400).json({ error: '日付と時間を指定してください。' });
  }
  const db = readDB();
  const request = {
    id: `a-${crypto.randomUUID()}`,
    fromUserId: req.session.user.id,
    fromUserName: req.session.user.name,
    date,
    startTime,
    endTime,
    reason: reason || '',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.appointmentRequests.push(request);
  writeDB(db);
  res.status(201).json({ request });
});

router.post('/appointments/:id/decide', requireBoss, (req, res) => {
  const { decision } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decisionはapprovedまたはrejectedを指定してください。' });
  }
  const db = readDB();
  const request = db.appointmentRequests.find((a) => a.id === req.params.id);
  if (!request) return res.status(404).json({ error: '見つかりません。' });
  request.status = decision;

  if (decision === 'approved') {
    db.scheduleEntries.push({
      id: `s-${crypto.randomUUID()}`,
      ownerId: req.session.user.id,
      date: request.date,
      startTime: request.startTime,
      endTime: request.endTime,
      title: `${request.fromUserName}との面談`,
      status: 'busy'
    });
    db.scheduleEntries.push({
      id: `s-${crypto.randomUUID()}`,
      ownerId: request.fromUserId,
      date: request.date,
      startTime: request.startTime,
      endTime: request.endTime,
      title: `${req.session.user.name}との面談`,
      status: 'busy'
    });
  }

  db.messages.push({
    id: `m-${crypto.randomUUID()}`,
    fromUserId: req.session.user.id,
    toUserId: request.fromUserId,
    text:
      decision === 'approved'
        ? `アポイントを承認しました：${request.date} ${request.startTime}-${request.endTime}`
        : `アポイントをお断りしました：${request.date} ${request.startTime}-${request.endTime}`,
    timestamp: new Date().toISOString()
  });

  writeDB(db);
  res.json({ request });
});

module.exports = router;
