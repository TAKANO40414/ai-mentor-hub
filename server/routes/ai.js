const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth, requireBoss } = require('../middleware');

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

async function callClaude(messages, systemPrompt, maxTokens = 4096) {
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
      model: MODEL,
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

router.post('/chat', requireAuth, async (req, res) => {
  const { messages } = req.body || {};
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
    const reply = await callClaude(sanitized, CHAT_SYSTEM_PROMPT, 1024);
    res.json({ reply });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
