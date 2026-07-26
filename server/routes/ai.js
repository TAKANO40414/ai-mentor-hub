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
