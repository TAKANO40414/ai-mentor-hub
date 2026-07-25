require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const knowledgeRoutes = require('./routes/knowledge');
const scheduleRoutes = require('./routes/schedule');
const manualRoutes = require('./routes/manual');
const chatRoutes = require('./routes/chat');
const aiRoutes = require('./routes/ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'ai-mentor-hub-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/manual', manualRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ai', aiRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`ジェネギャすきる running at http://localhost:${PORT}`);
});
