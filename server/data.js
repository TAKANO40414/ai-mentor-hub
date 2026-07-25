const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./crypto-util');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return localDateStr(new Date());
}

function seedData() {
  const today = todayStr();
  return {
    users: [
      { id: 'u-boss', username: 'boss', name: '山田 上司', role: 'boss', passwordHash: hashPassword('boss123') },
      { id: 'u-staff1', username: 'staff1', name: '佐藤 部下', role: 'member', passwordHash: hashPassword('staff123') },
      { id: 'u-staff2', username: 'staff2', name: '鈴木 部下', role: 'member', passwordHash: hashPassword('staff123') }
    ],
    knowledge: [
      {
        id: 'k-1',
        question: '有給休暇の申請方法は？',
        keywords: ['有給', '休暇', '申請'],
        answer: '有給休暇は勤怠システムから3営業日前までに申請してください。承認は上司が行います。',
        category: '総務'
      },
      {
        id: 'k-2',
        question: '経費精算のやり方は？',
        keywords: ['経費', '精算', 'レシート'],
        answer: '経費精算はレシートを添付し、月末締めで経理システムから申請してください。',
        category: '総務'
      },
      {
        id: 'k-3',
        question: '本番デプロイの手順は？',
        keywords: ['デプロイ', '本番', 'リリース'],
        answer: '本番デプロイはmainブランチのCIが通過後、リリース承認フローを経てから実施してください。',
        category: '技術'
      }
    ],
    scheduleEntries: [
      { id: 's-1', date: today, startTime: '09:00', endTime: '10:30', title: '定例会議', status: 'busy' },
      { id: 's-2', date: today, startTime: '13:00', endTime: '14:00', title: '来客対応', status: 'busy' }
    ],
    appointmentRequests: [],
    techTips: [
      {
        id: 't-1',
        date: today,
        technology: 'React Hooks',
        description: '本日の開発ではuseEffectの依存配列に気を付けて実装しましょう。',
        relatedTask: 'フロントエンド改修'
      }
    ],
    messages: [
      {
        id: 'm-1',
        fromUserId: 'u-boss',
        toUserId: 'u-staff1',
        text: 'おはようございます。今日もよろしくお願いします。',
        timestamp: new Date().toISOString()
      }
    ]
  };
}

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    writeDB(seedData());
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeDB(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

module.exports = { readDB, writeDB, todayStr, localDateStr };
