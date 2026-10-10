const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth, requireBoss } = require('../middleware');
const fs = require('fs');
const path = require('path');
const { readDB } = require('../data');
const MANUAL_UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('PDFファイルのみアップロードできます。'));
    }
    cb(null, true);
  }
});

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TEXT_LENGTH = 150000;

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_PREFIX = 'ollama:';

const CHAT_MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5（バランス型・おすすめ）', provider: 'anthropic' },
  { id: 'claude-opus-5', label: 'Claude Opus 5（高性能・じっくり回答）', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5（高速・軽量）', provider: 'anthropic' },
  { id: 'claude-fable-5', label: 'Claude Fable 5', provider: 'anthropic' }
];
const CHAT_MODEL_IDS = CHAT_MODELS.map((m) => m.id);

async function listOllamaModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return (data.models || []).map((m) => ({
      id: `${OLLAMA_PREFIX}${m.name}`,
      label: `${m.name}（ローカルOllama）`,
      provider: 'ollama'
    }));
  } catch {
    return [];
  }
}

async function callOllama(messages, systemPrompt, model, maxTokens = 1024) {
  let res;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        options: { num_predict: maxTokens }
      })
    });
  } catch {
    const err = new Error(
      `Ollamaサーバーに接続できません（${OLLAMA_BASE_URL}）。ローカルでOllamaが起動しているか確認してください。`
    );
    err.status = 502;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Ollamaの呼び出しに失敗しました。');
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  return data.message?.content || '';
}

const SUMMARIZE_SYSTEM_PROMPT = `あなたは社内文書を分かりやすく要約するアシスタントです。
入力された文書の内容を、日本語で以下の形式のMarkdownとして出力してください。

1. 見出し（# タイトル）
2. 3〜6個の箇条書きによる要点まとめ
3. 内容の構造・流れ・関係性を表す図解を、必ず1つ以上、\`\`\`mermaid コードブロックとして含めてください（flowchart、graph、sequenceDiagramなど内容に適した種類を選んでください）
4. 図解の後に、簡単な補足説明

Markdown以外の説明文は出力しないでください。`;

const CHAT_SYSTEM_PROMPT =
  'あなたは社内向けのAIアシスタントです。上司・部下どちらからの質問にも、日本語で分かりやすく簡潔に回答してください。分からないことは正直に分からないと答えてください。';

const MAX_CHAT_TURNS = 20;
const MAX_CHAT_MESSAGE_LENGTH = 4000;

async function callClaude(messages, systemPrompt, maxTokens = 4096, modelOverride) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEYが設定されていません。サーバー管理者に設定を依頼してください。');
    err.status = 500;
    throw err;
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: modelOverride || MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || 'Claude APIの呼び出しに失敗しました。');
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  return (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

router.post('/summarize-text', requireBoss, async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: '文書の内容を入力してください。' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `文書が長すぎます（${MAX_TEXT_LENGTH}文字以内にしてください）。` });
  }
  try {
    const markdown = await callClaude(
      [{ role: 'user', content: [{ type: 'text', text: `以下の文書を要約し、図解付きドキュメントに変換してください。\n\n---\n${text.trim()}` }] }],
      SUMMARIZE_SYSTEM_PROMPT
    );
    res.json({ markdown });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/summarize-pdf', requireBoss, (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    if (!req.file) return res.status(400).json({ error: 'PDFファイルを選択してください。' });

    try {
      const base64 = req.file.buffer.toString('base64');
      const markdown = await callClaude(
        [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
              { type: 'text', text: '上記のPDF文書を要約し、図解付きドキュメントに変換してください。' }
            ]
          }
        ],
        SUMMARIZE_SYSTEM_PROMPT
      );
      res.json({ markdown });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });
});

// 音声（文字起こし）からマニュアルを作成
const VOICE_MANUAL_SYSTEM_PROMPT = `あなたは製造現場の技術伝承を手伝う編集者です。入力（ベテランが口頭で語った文字起こし、または書かれたマニュアル文書・PDF）を、若手がそのまま現場で使える「手順ごとのマニュアル」に整理します。

必ず次のJSONだけを出力してください（コードフェンスや説明文は不要）:
{
  "title": "マニュアルの題名（作業名が分かるように、30文字以内）",
  "process": "この作業が属する工程名（10文字以内。例：段取り、刷り出し、検査）",
  "summary": "この作業の目的と全体像を2〜3文で",
  "steps": [
    {
      "title": "手順の名前（コツが分かる短い一文、25文字以内）",
      "body": "具体的なやり方。何を・どこを・どう見るか／触るか／聞くか。判断の基準や理由も。語りにある言葉をなるべく残す。",
      "tag": "手元 | 目線 | 機械 のいずれか（手で行う作業＝手元、目で確認する＝目線、機械の操作や設定＝機械）",
      "caution": "注意点・失敗例があれば（無ければ空文字）"
    }
  ],
  "tips": ["手順に収まらないコツ・勘所・判断の分かれ目（0〜5個）"],
  "questions": ["文字起こしだけでは分からず、ベテランに確認すべき点（0〜3個）"]
}

ルール:
- 手順は実際の作業順に並べる。文字起こしに無いことは作らない。曖昧な点は questions に回す。
- 話し言葉を書き言葉に直すが、現場の固有の言い回し（「ペタペタ」など）はそのまま残す。
- 数値・時間・位置など具体的な表現を優先する。`;

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AIの出力を読み取れませんでした。もう一度お試しください。');
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeManual(manual, fallbackTitle) {
  if (!Array.isArray(manual.steps) || !manual.steps.length) {
    const err = new Error('手順を抽出できませんでした。内容を確認してください。');
    err.status = 502;
    throw err;
  }
  manual.steps = manual.steps.map((st) => ({
    title: String(st.title || '').trim() || '（無題）',
    body: String(st.body || '').trim(),
    tag: ['手元', '目線', '機械'].includes(st.tag) ? st.tag : '手元',
    caution: String(st.caution || '').trim()
  }));
  manual.tips = Array.isArray(manual.tips) ? manual.tips.map(String) : [];
  manual.questions = Array.isArray(manual.questions) ? manual.questions.map(String) : [];
  manual.title = String(manual.title || fallbackTitle || '音声マニュアル').trim();
  manual.process = String(manual.process || '').trim();
  manual.summary = String(manual.summary || '').trim();
  return manual;
}

// 登録済みマニュアル（テキスト／PDF）を技術伝承の点（コツ）に分ける
router.post('/manual-to-sphere/:id', requireAuth, async (req, res) => {
  const db = readDB();
  const entry = db.manualEntries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'マニュアルが見つかりません。' });
  const hintText = `マニュアルの題名：${entry.title}（カテゴリ：${entry.category}）`;
  let content;
  if (entry.storedFileName) {
    const filePath = path.join(MANUAL_UPLOAD_DIR, entry.storedFileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'PDFファイルが見つかりません。' });
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(filePath).toString('base64') } },
      { type: 'text', text: `${hintText}\n\n上記のPDFマニュアルを、指定のJSON形式で手順ごとに整理してください。` }
    ];
  } else if ((entry.description || '').trim()) {
    content = `${hintText}\n\n=== マニュアル本文 ===\n${entry.description.slice(0, MAX_TEXT_LENGTH)}`;
  } else {
    return res.status(400).json({ error: 'このマニュアルには本文もPDFもありません。' });
  }
  try {
    const raw = await callClaude([{ role: 'user', content }], VOICE_MANUAL_SYSTEM_PROMPT, 8192);
    const manual = normalizeManual(extractJson(raw), entry.title);
    manual.title = entry.title;
    res.json({ manual, model: MODEL });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/manual-from-voice', requireAuth, async (req, res) => {
  const { transcript, hint } = req.body || {};
  const text = String(transcript || '').trim();
  if (!text) return res.status(400).json({ error: '文字起こしの内容が空です。' });
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `文字起こしが長すぎます（${MAX_TEXT_LENGTH}文字以内にしてください）。` });
  }
  const userContent =
    (hint ? `作業名・技術名のヒント：${String(hint).slice(0, 200)}\n\n` : '') + `=== 文字起こし ===\n${text}`;
  try {
    const raw = await callClaude([{ role: 'user', content: userContent }], VOICE_MANUAL_SYSTEM_PROMPT, 8192);
    const manual = normalizeManual(extractJson(raw), hint);
    res.json({ manual, model: MODEL });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// 技術伝承「球体を回す」タブ（public/sphere/）からのAI呼び出し
router.post('/sphere', requireAuth, async (req, res) => {
  const { system, messages, maxTokens } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'メッセージが空です。' });
  }
  const safeMessages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_TEXT_LENGTH) }));
  if (!safeMessages.length || safeMessages[0].role !== 'user') {
    return res.status(400).json({ error: 'メッセージの形式が不正です。' });
  }
  const tokens = Math.min(Math.max(parseInt(maxTokens, 10) || 2048, 256), 8192);
  try {
    const text = await callClaude(safeMessages, String(system || '').slice(0, MAX_TEXT_LENGTH), tokens);
    res.json({ text, model: MODEL });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/chat-models', requireAuth, async (req, res) => {
  const ollamaModels = await listOllamaModels();
  res.json({ models: [...CHAT_MODELS, ...ollamaModels], default: MODEL });
});

router.post('/chat', requireAuth, async (req, res) => {
  const { messages, model } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'メッセージを入力してください。' });
  }

  const sanitized = messages.slice(-MAX_CHAT_TURNS).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, MAX_CHAT_MESSAGE_LENGTH)
  }));

  if (!sanitized.some((m) => m.content.trim())) {
    return res.status(400).json({ error: 'メッセージを入力してください。' });
  }

  try {
    if (typeof model === 'string' && model.startsWith(OLLAMA_PREFIX)) {
      const ollamaModel = model.slice(OLLAMA_PREFIX.length);
      const reply = await callOllama(sanitized, CHAT_SYSTEM_PROMPT, ollamaModel, 1024);
      return res.json({ reply, model });
    }

    const selectedModel = CHAT_MODEL_IDS.includes(model) ? model : MODEL;
    const reply = await callClaude(sanitized, CHAT_SYSTEM_PROMPT, 1024, selectedModel);
    res.json({ reply, model: selectedModel });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
