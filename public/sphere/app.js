/* 球体を回す ― アプリ本体 */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- 設定 ---------- */
  const settings = {
    get tech() { return localStorage.getItem('sphere.tech') || ''; },
    set tech(v) { localStorage.setItem('sphere.tech', v); },
    get role() { return localStorage.getItem('sphere.role') || 'young'; },
    set role(v) { localStorage.setItem('sphere.role', v); },
    get key() { return localStorage.getItem('sphere.apiKey') || ''; },
    set key(v) { v ? localStorage.setItem('sphere.apiKey', v) : localStorage.removeItem('sphere.apiKey'); },
  };

  /* ---------- データ ---------- */
  let points = [], circles = [], links = [];
  const CIRCLE_COLORS = ['#2d3a4f', '#c44a2f', '#3b7a57', '#7a5c3b', '#5b4b8a', '#2a7b9b', '#9b6a2a'];
  async function load() {
    [points, circles, links] = await Promise.all([DB.all('points'), DB.all('circles'), DB.all('links')]);
    points.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    circles.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  const circleName = id => circles.find(c => c.id === id)?.name || '未分類';
  const pointById = id => points.find(p => p.id === id);

  /* ---------- 視点カード ---------- */
  const CARDS = [
    { id: '材料から', q: '材料（紙・インキ・版・部品）が変わったとき、最初にどこを見ますか？', hint: 'ロットの違い、季節の違い、仕入れ先の違いで変える判断はありますか。' },
    { id: '不良品から', q: '不良品を手に取ったとき、何を見て原因の見当をつけますか？', hint: '「この出方はあそこが原因」という決まりがあれば教えてください。' },
    { id: '音から', q: '機械の音や作業中の音で「おかしい」と気づくことはありますか？', hint: 'どんな音のとき、どこを確かめますか。' },
    { id: '手の感触から', q: '手で触って確かめているものは何ですか？', hint: '硬さ・温度・ざらつき・重さなど、数字にしていない感覚。' },
    { id: '時間・タイミングから', q: '「このタイミングで必ず見る」という瞬間はいつですか？', hint: '立ち上げ直後、休憩明け、終業前など。' },
    { id: '段取りから', q: '作業を始める前に、どんな順番で何を準備していますか？', hint: '省くと後で困る準備、逆に省いてよい準備。' },
    { id: '失敗から', q: 'いちばん痛い失敗は何でしたか？ そのあと何を変えましたか？', hint: '失敗の前兆として見ているものがあれば。' },
    { id: '季節・環境から', q: '季節・気温・湿度で変える判断はありますか？', hint: '梅雨、真夏、冬の朝一番など。' },
    { id: '道具・機械から', q: '機械のクセ、道具の当たり外れをどう見分けていますか？', hint: '号機ごとの違い、消耗品の交換どき。' },
    { id: '判断の分かれ目から', q: '「続けるか、止めるか」を決める基準は何ですか？', hint: '迷ったときに最後に見る場所。' },
    { id: '数字から', q: '数字や計器で見ているものと、数字では分からないものは？', hint: '数字が正常でも「おかしい」と感じるとき。' },
    { id: '若手に教えるとしたら', q: '若手に最初に見てほしい場所を1つ挙げるなら、どこですか？', hint: 'なぜそこなのか、理由も。' },
  ];

  /* ---------- 画面切替 ---------- */
  function show(name) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.screen === name));
    window.scrollTo(0, 0);
    if (name === 'sphere') { sphere.resize(); }
    if (name === 'record') { renderCircleSelect(); renderRecent(); }
    if (name === 'draw') { renderCard(); renderCoverage(); }
    if (name === 'organize') { renderOrganize(); }
    if (name === 'search') { renderChatMode(); renderSuggest(); }
  }
  $$('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.screen)));

  /* ---------- ヘッダー ---------- */
  function renderHeader() {
    $('#techName').textContent = settings.tech ? settings.tech : '［技術名］';
    $$('#roleSwitch button').forEach(b => b.classList.toggle('active', b.dataset.role === settings.role));
  }
  $('#techName').addEventListener('click', openSettings);
  $('#roleSwitch').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    settings.role = b.dataset.role; renderHeader();
    toast(b.dataset.role === 'veteran' ? 'ベテラン：語る側です。「引き出す」から始めましょう' : '若手：記録し、整理する側です');
  });

  /* ---------- 球体 ---------- */
  const sphere = new SphereView($('#sphere'), { onSelect: p => { if (p) openPoint(p.id); } });
  function refreshSphere() {
    sphere.setData({ circles, points, links });
    $('#sphereEmpty').hidden = points.length > 0;
    const seen = points.filter(p => p.state === 'seen').length;
    const told = points.filter(p => p.state === 'told').length;
    const hidden = points.filter(p => p.state === 'hidden').length;
    $('#sphereStats').textContent = points.length ? `点 ${points.length} ／ 円 ${circles.length} ／ 関係 ${links.length}` : '';
    const stages = [
      ['点', 'コツを知っている', points.length],
      ['線', '手順が言える', points.filter(p => p.circleId).length],
      ['円', '工程を通せる', circles.filter(c => points.some(p => p.circleId === c.id)).length],
      ['球', '条件が違っても判断できる', links.length],
    ];
    $('#stageRow').innerHTML = stages.map(([b, s, n]) => `<div class="stage"><b>${b}</b><span>${s}</span><em>${n}</em></div>`).join('');
    void seen; void told; void hidden;
  }

  /* ---------- 記録する ---------- */
  const rec = { tag: '手元', state: 'seen', perspective: '', video: null, videoType: '', audio: null, editing: null };
  $('#tagChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; rec.tag = b.dataset.tag; $$('#tagChips .chip').forEach(c => c.classList.toggle('active', c === b)); });
  $('#stateChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; rec.state = b.dataset.state; $$('#stateChips .chip').forEach(c => c.classList.toggle('active', c === b)); });

  function renderCircleSelect(sel = $('#recCircle'), value) {
    sel.innerHTML = '<option value="">（未分類）</option>' + circles.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '<option value="__new">＋ 新しい工程を作る…</option>';
    if (value !== undefined) sel.value = value;
  }
  $('#recCircle').addEventListener('change', async e => {
    if (e.target.value !== '__new') return;
    const name = prompt('工程（円）の名前'); 
    if (!name) { e.target.value = ''; return; }
    const c = await addCircle(name);
    renderCircleSelect($('#recCircle'), c.id);
  });

  // 動画・写真
  $('#recVideo').addEventListener('change', e => setMedia(e.target.files[0]));
  $('#recPhoto').addEventListener('change', e => setMedia(e.target.files[0]));
  function setMedia(file) {
    if (!file) return;
    rec.video = file; rec.videoType = file.type.startsWith('image') ? 'image' : 'video';
    showMedia($('#recMediaPreview'), file, rec.videoType);
  }
  function showMedia(el, blob, type) {
    el.innerHTML = '';
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    if (type === 'image') { const img = new Image(); img.src = url; el.appendChild(img); }
    else if (type === 'audio') { const a = document.createElement('audio'); a.controls = true; a.src = url; el.appendChild(a); }
    else { const v = document.createElement('video'); v.controls = true; v.playsInline = true; v.src = url; el.appendChild(v); }
  }

  // 音声メモ（MediaRecorder）
  let mediaRec = null, recChunks = [], recTimer = null, recStart = 0;
  $('#recAudioBtn').addEventListener('click', async () => {
    if (mediaRec && mediaRec.state === 'recording') { mediaRec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunks = [];
      mediaRec.ondataavailable = e => e.data.size && recChunks.push(e.data);
      mediaRec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        rec.audio = new Blob(recChunks, { type: mediaRec.mimeType || 'audio/webm' });
        showMedia($('#recAudioPreview'), rec.audio, 'audio');
        $('#recAudioBtn').textContent = '🎙 録音開始'; $('#recAudioBtn').classList.remove('recording');
        clearInterval(recTimer); $('#recTimer').textContent = '';
      };
      mediaRec.start();
      recStart = Date.now();
      recTimer = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); $('#recTimer').textContent = `● ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 500);
      $('#recAudioBtn').textContent = '■ 録音停止'; $('#recAudioBtn').classList.add('recording');
    } catch (err) { toast('マイクを使えません：' + err.message); }
  });

  // 文字起こし（Web Speech API）
  let speech = null;
  $('#recSpeechBtn').addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('この端末のブラウザは文字起こしに対応していません'); return; }
    if (speech) { speech.stop(); return; }
    speech = new SR(); speech.lang = 'ja-JP'; speech.continuous = true; speech.interimResults = true;
    const ta = $('#recBody'); const base = ta.value ? ta.value.replace(/\s+$/, '') + '\n' : '';
    let finals = '';
    speech.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript + '。'; else interim += r[0].transcript;
      }
      ta.value = base + finals + interim;
    };
    speech.onend = () => { speech = null; $('#recSpeechBtn').textContent = '📝 文字起こし'; $('#recSpeechBtn').classList.remove('listening'); };
    speech.onerror = e => { toast('文字起こしエラー：' + e.error); };
    speech.start();
    $('#recSpeechBtn').textContent = '■ 文字起こし停止'; $('#recSpeechBtn').classList.add('listening');
  });

  $('#recordForm').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('#recTitle').value.trim(); if (!title) return;
    const id = rec.editing || uid();
    const prev = rec.editing ? pointById(rec.editing) : null;
    const p = {
      id, title, body: $('#recBody').value.trim(), tag: rec.tag, state: rec.state,
      perspective: rec.perspective || prev?.perspective || '',
      circleId: $('#recCircle').value === '__new' ? '' : $('#recCircle').value,
      order: prev?.order ?? (Math.max(-1, ...points.filter(q => q.circleId === $('#recCircle').value).map(q => q.order ?? 0)) + 1),
      speaker: settings.role, createdAt: prev?.createdAt || Date.now(), updatedAt: Date.now(),
      mediaId: prev?.mediaId || null, mediaType: prev?.mediaType || '', audioId: prev?.audioId || null,
    };
    if (rec.video) { p.mediaId = uid(); p.mediaType = rec.videoType; await DB.put('media', { id: p.mediaId, blob: rec.video, type: rec.video.type }); }
    if (rec.audio) { p.audioId = uid(); await DB.put('media', { id: p.audioId, blob: rec.audio, type: rec.audio.type }); }
    await DB.put('points', p);
    await load(); refreshSphere(); renderRecent();
    clearForm();
    toast(prev ? '点を更新しました' : '点として残しました');
  });
  function clearForm() {
    $('#recordForm').reset();
    rec.video = rec.audio = null; rec.editing = null; rec.perspective = '';
    $('#recMediaPreview').innerHTML = ''; $('#recAudioPreview').innerHTML = '';
    $('#recPerspective').textContent = 'なし';
    setChip('#tagChips', 'tag', rec.tag = '手元'); setChip('#stateChips', 'state', rec.state = 'seen');
    $('#recordForm button[type=submit]').textContent = '点として残す';
  }
  function setChip(sel, key, val) { $$(sel + ' .chip').forEach(c => c.classList.toggle('active', c.dataset[key] === val)); }
  $('#recClear').addEventListener('click', clearForm);

  function startEdit(p) {
    clearForm();
    rec.editing = p.id; rec.perspective = p.perspective || '';
    $('#recTitle').value = p.title; $('#recBody').value = p.body || '';
    renderCircleSelect($('#recCircle'), p.circleId || '');
    setChip('#tagChips', 'tag', rec.tag = p.tag || '手元'); setChip('#stateChips', 'state', rec.state = p.state || 'seen');
    $('#recPerspective').textContent = p.perspective || 'なし';
    $('#recordForm button[type=submit]').textContent = '更新する';
    show('record');
  }

  function pointItem(p, actions = '') {
    return `<li class="point-item" data-id="${p.id}">
      <span class="dot ${p.state || 'seen'}"></span>
      <div class="pi-main">
        <div class="pi-title">${esc(p.title)}</div>
        <div class="pi-sub"><span class="tag">${esc(p.tag)}</span>${p.perspective ? `<span class="tag v">${esc(p.perspective)}</span>` : ''}${esc(circleName(p.circleId))}${p.mediaId ? ' 🎥' : ''}${p.audioId ? ' 🎙' : ''}</div>
      </div>${actions}</li>`;
  }
  function renderRecent() {
    const list = points.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    $('#recentList').innerHTML = list.map(p => pointItem(p)).join('') || '<li class="muted small">まだ記録がありません</li>';
  }
  $('#recentList').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) openPoint(li.dataset.id); });

  /* ---------- 引き出す ---------- */
  let cardIdx = 0;
  function renderCard() {
    const c = CARDS[cardIdx];
    $('#pcardLabel').textContent = c.id; $('#pcardQ').textContent = c.q; $('#pcardHint').textContent = c.hint;
    $('#cardCount').textContent = `${cardIdx + 1} / ${CARDS.length}`;
    $('#cardAIOut').hidden = true;
  }
  $('#cardPrev').addEventListener('click', () => { cardIdx = (cardIdx - 1 + CARDS.length) % CARDS.length; renderCard(); });
  $('#cardNext').addEventListener('click', () => { cardIdx = (cardIdx + 1) % CARDS.length; renderCard(); });
  $('#cardRecord').addEventListener('click', () => {
    clearForm(); rec.perspective = CARDS[cardIdx].id; $('#recPerspective').textContent = rec.perspective;
    show('record'); $('#recTitle').focus();
  });
  $('#cardAI').addEventListener('click', async () => {
    const out = $('#cardAIOut'); out.hidden = false;
    if (!AI.hasKey()) { out.textContent = 'AIの深掘りにはClaude APIキーが必要です（設定から登録）。キーなしでも固定カードで語ってもらえます。'; return; }
    out.textContent = '考えています…';
    const c = CARDS[cardIdx];
    const ctx = pointsAsText();
    try {
      const text = await AI.call({
        effort: 'low', maxTokens: 2048,
        system: `あなたは製造現場の技術伝承を手伝う聞き手です。技術名「${settings.tech || '未設定'}」について、ベテランが「${c.id}」という視点で語るための質問を作ります。暗黙知（ベテランが無意識にやっている判断・見ている場所）を言葉にさせるのが目的です。既存の記録と重ならない角度で、具体的で答えやすい質問を3つ、日本語で番号付きで出してください。各質問は1〜2文。前置きは不要です。`,
        messages: [{ role: 'user', content: `視点カード：${c.id}\n基本の質問：${c.q}\n\n既に記録されている点：\n${ctx || '（まだありません）'}` }],
      });
      out.textContent = text;
    } catch (err) { out.textContent = 'AIエラー：' + err.message; }
  });
  function renderCoverage() {
    $('#coverage').innerHTML = CARDS.map(c => {
      const n = points.filter(p => p.perspective === c.id).length;
      return `<li class="${n ? 'done' : ''}"><span>${c.id}</span><span class="n">${n ? n + ' 点' : '—'}</span></li>`;
    }).join('');
  }

  /* ---------- 整理する ---------- */
  async function addCircle(name) {
    const c = { id: uid(), name, color: CIRCLE_COLORS[circles.length % CIRCLE_COLORS.length], order: circles.length };
    await DB.put('circles', c); await load(); refreshSphere(); return c;
  }
  $('#addCircle').addEventListener('click', async () => {
    const name = prompt('工程（円）の名前'); if (!name) return;
    await addCircle(name); renderOrganize(); toast('工程を追加しました');
  });
  $('#addLink').addEventListener('click', () => {
    if (points.length < 2) { toast('点が2つ以上必要です'); return; }
    const opts = points.map(p => `<option value="${p.id}">${esc(circleName(p.circleId))}：${esc(p.title)}</option>`).join('');
    const box = document.createElement('div'); box.className = 'circle-block';
    box.innerHTML = `<div class="field"><label>この点が…</label><select id="lkFrom">${opts}</select></div>
      <div class="field"><label>この点と関係している（条件が違っても判断に効く）</label><select id="lkTo">${opts}</select></div>
      <div class="field"><label>どう関係している？</label><input type="text" id="lkNote" placeholder="例：ここが狂うと次工程で色ムラが出る"></div>
      <div class="form-actions"><button class="btn btn-primary" id="lkSave">つなぐ</button><button class="btn btn-ghost" id="lkCancel">やめる</button></div>`;
    $('#circleList').prepend(box);
    box.querySelector('#lkCancel').onclick = () => box.remove();
    box.querySelector('#lkSave').onclick = async () => {
      const from = box.querySelector('#lkFrom').value, to = box.querySelector('#lkTo').value;
      if (from === to) { toast('別の点を選んでください'); return; }
      await DB.put('links', { id: uid(), from, to, note: box.querySelector('#lkNote').value.trim() });
      await load(); refreshSphere(); renderOrganize(); toast('関係をつなぎました');
    };
  });

  function renderOrganize() {
    const groups = [...circles.map(c => ({ c, pts: points.filter(p => p.circleId === c.id) })), { c: null, pts: points.filter(p => !p.circleId || !circles.some(c => c.id === p.circleId)) }];
    $('#circleList').innerHTML = groups.filter(g => g.c || g.pts.length).map(g => `
      <div class="circle-block" data-cid="${g.c ? g.c.id : ''}">
        <div class="circle-head">
          <span class="cdot" style="background:${g.c ? g.c.color : '#9aa3ad'}"></span>
          ${g.c ? `<input class="cname" value="${esc(g.c.name)}" data-rename="${g.c.id}">` : '<span class="cname">未分類</span>'}
          ${g.c ? `<button data-delc="${g.c.id}">削除</button>` : ''}
        </div>
        ${g.pts.map((p, i) => `<div class="step" data-id="${p.id}">
            <div class="step-main"><span class="idx">${i + 1}</span><span class="dot ${p.state || 'seen'}"></span><span class="stitle">${esc(p.title)}</span></div>
            <div class="step-ctl">
              <button class="sbtn" data-up="${p.id}" ${i === 0 ? 'disabled' : ''}>↑ 前へ</button>
              <button class="sbtn" data-down="${p.id}" ${i === g.pts.length - 1 ? 'disabled' : ''}>↓ 後へ</button>
              <select class="sbtn" data-move="${p.id}" title="工程を移す"></select>
            </div>
          </div>`).join('') || '<div class="step muted">点がありません</div>'}
      </div>`).join('');
    $$('#circleList select[data-move]').forEach(s => { renderCircleSelect(s, pointById(s.dataset.move).circleId || ''); s.querySelector('option[value="__new"]').remove(); });
  }
  $('#circleList').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.up || b.dataset.down) {
      const id = b.dataset.up || b.dataset.down, p = pointById(id);
      const sib = points.filter(q => (q.circleId || '') === (p.circleId || '')).sort((a, c) => a.order - c.order);
      const i = sib.indexOf(p), j = b.dataset.up ? i - 1 : i + 1;
      if (j < 0 || j >= sib.length) return;
      sib.forEach((q, k) => q.order = k);
      [sib[i].order, sib[j].order] = [sib[j].order, sib[i].order];
      await DB.putMany('points', sib); await load(); refreshSphere(); renderOrganize();
    } else if (b.dataset.delc) {
      if (!confirm('この工程を削除しますか？（点は未分類になります）')) return;
      await DB.del('circles', b.dataset.delc);
      for (const p of points.filter(p => p.circleId === b.dataset.delc)) { p.circleId = ''; await DB.put('points', p); }
      await load(); refreshSphere(); renderOrganize();
    }
  });
  $('#circleList').addEventListener('change', async e => {
    const s = e.target;
    if (s.dataset.move) {
      const p = pointById(s.dataset.move); p.circleId = s.value;
      p.order = Math.max(-1, ...points.filter(q => q.circleId === s.value && q.id !== p.id).map(q => q.order ?? 0)) + 1;
      await DB.put('points', p); await load(); refreshSphere(); renderOrganize();
    } else if (s.dataset.rename) {
      const c = circles.find(c => c.id === s.dataset.rename); c.name = s.value.trim() || c.name;
      await DB.put('circles', c); await load(); refreshSphere();
    }
  });
  $('#circleList').addEventListener('click', e => { const st = e.target.closest('.step-main'); if (st) openPoint(st.closest('.step').dataset.id); });
  function renderLinks() {
    $('#linkList').innerHTML = links.map(l => {
      const a = pointById(l.from), b = pointById(l.to); if (!a || !b) return '';
      return `<li><span>${esc(a.title)} <span class="arrow">⇄</span> ${esc(b.title)}${l.note ? `<br><small class="muted">${esc(l.note)}</small>` : ''}</span><button class="sbtn" data-dell="${l.id}">×</button></li>`;
    }).join('') || '<li class="muted small">まだ関係がありません。工程をまたいで効くコツをつなぎましょう。</li>';
  }
  $('#linkList').addEventListener('click', async e => {
    const b = e.target.closest('[data-dell]'); if (!b) return;
    await DB.del('links', b.dataset.dell); await load(); refreshSphere(); renderLinks();
  });
  const _renderOrganize = renderOrganize;
  renderOrganize = function () { _renderOrganize(); renderLinks(); };

  /* ---------- 探す ---------- */
  const chatHistory = [];
  function pointsAsText() {
    return points.map((p, i) => `[#${i + 1}] 工程:${circleName(p.circleId)} ／ タグ:${p.tag} ／ 視点:${p.perspective || '-'} ／ 見え方:${({ seen: '見えている', told: '言われて気づいた', hidden: 'まだ見えていない' })[p.state] || ''}\n　${p.title}${p.body ? '\n　' + p.body.replace(/\n/g, '\n　') : ''}`).join('\n\n');
  }
  function renderChatMode() {
    $('#chatMode').textContent = AI.viaHub ? 'AIが語りの記録から答えます（サーバーのAPIキーを使用。未設定時はキーワード検索）。' : AI.hasKey() ? `AI（${AI.MODEL}）が語りの記録から答えます。` : 'APIキー未設定：記録のキーワード検索で答えます（設定からキーを登録するとAIが答えます）。';
    if (!$('#chat').children.length) addMsg('ai', 'この症状のとき、ベテランはどこを見る？ と聞いてみてください。' + (points.length ? '' : '\n（まだ記録がないので、先に「記録」で点を残してください）'));
  }
  function renderSuggest() {
    const qs = ['色がくすむとき、どこを見る？', '立ち上げで最初に確かめることは？', '止めるか続けるかの判断は？', ...CARDS.slice(0, 3).map(c => c.id + '見るところは？')];
    $('#suggestRow').innerHTML = qs.map(q => `<button type="button">${esc(q)}</button>`).join('');
  }
  $('#suggestRow').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('#chatText').value = b.textContent; $('#chatForm').requestSubmit(); });
  function addMsg(role, text, refs = []) {
    const d = document.createElement('div'); d.className = 'msg ' + role;
    d.textContent = text;
    if (refs.length) { d.appendChild(document.createElement('br')); refs.forEach(p => { const s = document.createElement('span'); s.className = 'ref'; s.textContent = '▶ ' + p.title; s.onclick = () => openPoint(p.id); d.appendChild(s); }); }
    $('#chat').appendChild(d); d.scrollIntoView({ block: 'end', behavior: 'smooth' });
    return d;
  }
  $('#chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#chatText').value.trim(); if (!q) return;
    $('#chatText').value = '';
    addMsg('user', q);
    if (AI.hasKey()) await askAI(q); else askLocal(q);
  });
  function bigrams(s) { const t = s.replace(/[\s、。？?！!「」（）()・,.]/g, ''); const out = new Set(); for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2)); return out; }
  function askLocal(q) {
    const g = bigrams(q);
    const scored = points.map(p => { const txt = `${p.title} ${p.body || ''} ${p.tag} ${p.perspective || ''} ${circleName(p.circleId)}`; let s = 0; g.forEach(b => { if (txt.includes(b)) s++; }); return { p, s }; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
    if (!scored.length) { addMsg('ai', '近い記録が見つかりませんでした。「引き出す」でこの症状について語ってもらい、点として残すと答えられるようになります。'); return; }
    const text = '記録の中で近いものです：\n' + scored.map(({ p }) => `● ${p.title}（${p.tag}／${circleName(p.circleId)}）${p.body ? '\n　' + p.body.slice(0, 80) + (p.body.length > 80 ? '…' : '') : ''}`).join('\n');
    addMsg('ai', text, scored.map(x => x.p));
  }
  async function askAI(q) {
    const th = addMsg('ai thinking', '記録を読んでいます…');
    chatHistory.push({ role: 'user', content: q });
    try {
      const text = await AI.call({
        effort: 'medium', maxTokens: 4096,
        system: `あなたは製造現場の「${settings.tech || '技術'}」について、ベテランの語りの記録をもとに若手の質問に答える案内役です。
答えは必ず下の記録に基づき、根拠にした記録を [#番号] の形で引用してください。記録にないことは推測と明記し、「ベテランに次に聞くべき質問」を1つ添えてください。
若手が現場ですぐ動けるよう、「どこを見るか」「何を確かめるか」を先に、簡潔な日本語で答えます。

=== 語りの記録 ===
${pointsAsText() || '（記録なし）'}`,
        messages: chatHistory.slice(-10),
      });
      chatHistory.push({ role: 'assistant', content: text });
      const refs = [...new Set((text.match(/\[#(\d+)\]/g) || []).map(m => +m.match(/\d+/)[0]))].map(n => points[n - 1]).filter(Boolean);
      th.remove(); addMsg('ai', text, refs);
    } catch (err) {
      chatHistory.pop(); th.remove();
      addMsg('ai', (err.message === 'NO_KEY' ? 'APIキーが未設定です。' : 'AIエラー：' + err.message) + '\nキーワード検索で代わりに探します。');
      askLocal(q);
    }
  }

  /* ---------- 点の詳細シート ---------- */
  let sheetPoint = null;
  async function openPoint(id) {
    const p = pointById(id); if (!p) return;
    sheetPoint = p;
    $('#psTag').textContent = p.tag; $('#psCircle').textContent = `${circleName(p.circleId)}${p.perspective ? '　視点：' + p.perspective : ''}`;
    $('#psTitle').textContent = p.title; $('#psBody').textContent = p.body || '（メモなし）';
    setChip('#psState', 'state', p.state || 'seen');
    const m = $('#psMedia'); m.innerHTML = '';
    if (p.mediaId) { const r = await DB.get('media', p.mediaId); if (r) { const d = document.createElement('div'); showMedia(d, r.blob, p.mediaType); m.appendChild(d); } }
    if (p.audioId) { const r = await DB.get('media', p.audioId); if (r) { const d = document.createElement('div'); showMedia(d, r.blob, 'audio'); m.appendChild(d); } }
    $('#pointSheet').hidden = false;
  }
  $('#psState').addEventListener('click', async e => {
    const b = e.target.closest('.chip'); if (!b || !sheetPoint) return;
    sheetPoint.state = b.dataset.state; setChip('#psState', 'state', sheetPoint.state);
    await DB.put('points', sheetPoint); await load(); refreshSphere();
  });
  $('#psEdit').addEventListener('click', () => { $('#pointSheet').hidden = true; startEdit(sheetPoint); });
  $('#psDelete').addEventListener('click', async () => {
    if (!confirm('この点を削除しますか？')) return;
    if (sheetPoint.mediaId) await DB.del('media', sheetPoint.mediaId);
    if (sheetPoint.audioId) await DB.del('media', sheetPoint.audioId);
    await DB.del('points', sheetPoint.id);
    for (const l of links.filter(l => l.from === sheetPoint.id || l.to === sheetPoint.id)) await DB.del('links', l.id);
    $('#pointSheet').hidden = true;
    await load(); refreshSphere(); renderRecent(); renderOrganize(); toast('削除しました');
  });
  $$('[data-close]').forEach(el => el.addEventListener('click', () => { el.closest('.sheet').hidden = true; sphere.selected = null; }));

  /* ---------- 設定 ---------- */
  function openSettings() { $('#setTech').value = settings.tech; $('#setKey').value = settings.key; $('#settingsSheet').hidden = false; }
  $('#openSettings').addEventListener('click', openSettings);
  $('#setSave').addEventListener('click', () => { settings.tech = $('#setTech').value.trim(); settings.key = $('#setKey').value.trim(); renderHeader(); $('#settingsSheet').hidden = true; toast('保存しました'); renderChatMode(); });
  $('#setSample').addEventListener('click', async () => {
    if (points.length && !confirm('サンプルを追加します。よろしいですか？')) return;
    await loadSample(); $('#settingsSheet').hidden = true; show('sphere'); toast('サンプルを読み込みました。指で回してみてください');
  });
  $('#setExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ tech: settings.tech, points, circles, links, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sphere_${(settings.tech || 'export')}.json`; a.click();
    toast('書き出しました（動画・音声は含みません）');
  });
  $('#setImport').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      await DB.putMany('circles', j.circles || []); await DB.putMany('points', (j.points || []).map(p => ({ ...p, mediaId: null, audioId: null }))); await DB.putMany('links', j.links || []);
      if (j.tech && !settings.tech) settings.tech = j.tech;
      await load(); refreshSphere(); renderHeader(); $('#settingsSheet').hidden = true; toast('読み込みました');
    } catch (err) { toast('読み込み失敗：' + err.message); }
  });
  $('#setClear').addEventListener('click', async () => {
    if (!confirm('すべての記録・工程・関係を削除します。元に戻せません。')) return;
    for (const s of ['points', 'circles', 'links', 'media']) await DB.clear(s);
    await load(); refreshSphere(); $('#settingsSheet').hidden = true; toast('削除しました');
  });

  /* ---------- サンプル ---------- */
  async function loadSample() {
    if (!settings.tech) settings.tech = 'オフセット印刷の色合わせ';
    const C = [['段取り', 0], ['刷り出し', 1], ['本刷りの監視', 2], ['不良対応', 3]].map(([name, i]) => ({ id: uid(), name, color: CIRCLE_COLORS[i], order: i }));
    const P = [
      [0, '手元', '段取りから', '版の汚れは爪で軽くなぞって確かめる', '目では分からない薄い汚れも、爪の引っかかりで分かる。ここを飛ばすと刷り出しで必ずやり直しになる。', 'seen'],
      [0, '機械', '材料から', 'インキの硬さを指で練って見る', '気温が低い朝はインキが硬い。ヘラで少し練って、糸の引き方で今日の調子を決める。数字（粘度計）は後。', 'told'],
      [0, '目線', '季節・環境から', '梅雨どきは紙の伸びを先に疑う', '湿度が高い日は紙が伸びて見当がずれる。朝一番に紙の端を触って波打ちを見る。', 'hidden'],
      [1, '目線', '若手に教えるとしたら', '最初の10枚は色より見当を見る', '色は後から追える。見当がずれていると全部やり直し。まずトンボを見る。', 'seen'],
      [1, '手元', '数字から', '濃度計の数値より、ベタの縁の切れを見る', '数値が合っていても縁がにじんでいれば水が多い。縁の切れが先。', 'told'],
      [1, '機械', '道具・機械から', '2号機は右側が薄くなるクセがある', '号機ごとにインキキーの効きが違う。2号機は右3本を最初から少し開けておく。', 'hidden'],
      [2, '音から', '音から', 'ローラーの音が「ペタペタ」に変わったら水が切れている', '正常は「サー」という音。乾いた音になったら止める前に水を足す。', 'seen'],
      [2, '目線', '時間・タイミングから', '休憩明けの最初の1枚は必ず抜く', '止めている間にインキが締まる。休憩明けは色が濃く出るので1枚抜いて確認。', 'told'],
      [2, '手元', '手の感触から', '刷った紙の裏を指でなぞって裏移りを見る', '目で見るより指の方が早い。少しでも指にインキが付いたら乾燥を疑う。', 'hidden'],
      [2, '目線', '判断の分かれ目から', '色が振れ始めたら、まず水を疑い、次にインキ', '順番を間違えるとどんどん悪くなる。水→インキ→紙の順。', 'seen'],
      [3, '目線', '不良品から', '汚れの位置が同じ場所なら版、ばらつくならローラー', '不良紙を10枚重ねて光に透かす。同じ場所に出るか、ばらつくかで原因の見当をつける。', 'seen'],
      [3, '機械', '失敗から', 'ブランケットの交換を渋って1日ロスしたことがある', '早めに替える方が結局安い。表面の艶が落ちたら迷わず替える。', 'told'],
      [3, '手元', '材料から', '紙のロットが変わったら不良のパターンも変わる', '同じ症状でも紙が変わると原因が違う。まず紙の納品日を見る。', 'hidden'],
    ].map(([ci, tag, persp, title, body, state], k) => ({ id: uid(), circleId: C[ci].id, tag, perspective: persp, title, body, state, order: k, speaker: 'veteran', createdAt: Date.now() - (20 - k) * 86400000, mediaId: null, audioId: null }));
    const L = [
      { id: uid(), from: P[1].id, to: P[9].id, note: '朝のインキの硬さが、本刷り中の色振れの出方を決める' },
      { id: uid(), from: P[2].id, to: P[12].id, note: '紙の状態は段取りでも不良対応でも最初に疑う' },
      { id: uid(), from: P[6].id, to: P[4].id, note: '水の量は音でも縁でも分かる' },
    ];
    await DB.putMany('circles', C); await DB.putMany('points', P); await DB.putMany('links', L);
    await load(); refreshSphere(); renderHeader();
  }

  /* ---------- 雑 ---------- */
  let toastT = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

  /* ---------- 起動 ---------- */
  // 親ページ（ジェネギャすきる）からの更新通知：音声マニュアルなどで点が追加されたとき
  window.addEventListener('message', async e => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'sphere:refresh') return;
    await load(); renderHeader(); refreshSphere(); renderCircleSelect(); renderRecent(); renderOrganize();
    toast('技術伝承に新しい点が追加されました');
  });

  (async () => {
    await load(); renderHeader(); refreshSphere(); renderCircleSelect();
    if ('serviceWorker' in navigator && location.protocol !== 'file:' && window.self === window.top) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
