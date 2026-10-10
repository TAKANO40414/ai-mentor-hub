/* Claude API（ブラウザから直接）。キーは端末の localStorage にのみ保存。 */
const AI = (() => {
  const MODEL = 'claude-opus-5-5';
  const URL = 'https://api.anthropic.com/v1/messages';
  const key = () => localStorage.getItem('sphere.apiKey') || '';
  // ジェネギャすきる（ai-mentor-hub）に組み込まれている場合はサーバー経由で呼ぶ
  const HUB_ENDPOINT = location.pathname.includes('/sphere/') ? '/api/ai/sphere' : '';

  async function callViaHub({ system, messages, maxTokens, effort }) {
    const res = await fetch(HUB_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system, messages, maxTokens, effort }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return (data.text || '').trim();
  }

  async function call({ system, messages, maxTokens = 4096, effort = 'low' }) {
    const k = key();
    if (HUB_ENDPOINT) {
      try { return await callViaHub({ system, messages, maxTokens, effort }); }
      catch (e) { if (!k) throw e; /* サーバーにキーが無ければ端末のキーで直接呼ぶ */ }
    }
    if (!k) throw new Error('NO_KEY');
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': k,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages,
        output_config: { effort },
        fallbacks: 'default',
      }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('AIがこの依頼に回答できませんでした。' + (data.stop_details?.explanation ? ' ' + data.stop_details.explanation : ''));
    }
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }

  return { call, hasKey: () => !!HUB_ENDPOINT || !!key(), MODEL, viaHub: !!HUB_ENDPOINT };
})();
