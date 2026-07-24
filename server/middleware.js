function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'ログインが必要です。' });
  }
  next();
}

function requireBoss(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'boss') {
    return res.status(403).json({ error: '上司権限が必要です。' });
  }
  next();
}

module.exports = { requireAuth, requireBoss };
