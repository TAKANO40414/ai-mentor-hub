let currentUser = null;
let members = [];
let bossInfo = null;
let activePartnerId = null;

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(path, {
    ...options,
    headers: isFormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('unauthenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました。');
  return data;
}

function timeLabel(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- Tabs ---------- */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

/* ---------- ① AI Q&A ---------- */
function initAsk() {
  document.getElementById('ask-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('ask-input');
    const box = document.getElementById('ask-result');
    try {
      const data = await api('/api/knowledge/ask', {
        method: 'POST',
        body: JSON.stringify({ question: input.value })
      });
      box.classList.remove('hidden', 'no-match');
      if (!data.matched) box.classList.add('no-match');
      box.textContent = data.answer;
    } catch (err) {
      box.classList.remove('hidden');
      box.textContent = err.message;
    }
  });

  if (currentUser.role === 'boss') {
    document.getElementById('knowledge-admin').classList.remove('hidden');
    document.getElementById('knowledge-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const question = document.getElementById('k-question').value.trim();
      const answer = document.getElementById('k-answer').value.trim();
      const category = document.getElementById('k-category').value.trim();
      const keywords = document.getElementById('k-keywords').value.split(',').map((s) => s.trim()).filter(Boolean);
      await api('/api/knowledge', { method: 'POST', body: JSON.stringify({ question, answer, category, keywords }) });
      e.target.reset();
      loadKnowledgeList();
    });
    loadKnowledgeList();
  }
}

async function loadKnowledgeList() {
  const { knowledge } = await api('/api/knowledge');
  const list = document.getElementById('knowledge-list');
  list.innerHTML = '';
  if (!knowledge.length) {
    list.innerHTML = '<li class="empty-msg">登録されたナレッジはありません。</li>';
    return;
  }
  knowledge.forEach((k) => {
    const li = document.createElement('li');
    li.innerHTML = `<div><strong>${escapeHtml(k.question)}</strong><div class="meta">${escapeHtml(k.category)} / ${escapeHtml(k.keywords.join(', '))}</div></div>`;
    const del = document.createElement('button');
    del.textContent = '削除';
    del.className = 'small-btn danger-btn';
    del.onclick = async () => {
      await api(`/api/knowledge/${k.id}`, { method: 'DELETE' });
      loadKnowledgeList();
    };
    li.appendChild(del);
    list.appendChild(li);
  });
}

/* ---------- ② Schedule calendar (Google Calendar-style month view) ---------- */
const CAL_WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];
const CAL_DEFAULT_START = '09:00';
const CAL_DEFAULT_END = '09:30';

let calendarMonthDate = new Date();

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtMonthDay(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function initSchedule() {
  loadTodaySchedule();
  loadMonthCalendar();

  document.getElementById('cal-prev').addEventListener('click', () => {
    calendarMonthDate.setMonth(calendarMonthDate.getMonth() - 1);
    loadMonthCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calendarMonthDate.setMonth(calendarMonthDate.getMonth() + 1);
    loadMonthCalendar();
  });
  document.getElementById('cal-today').addEventListener('click', () => {
    calendarMonthDate = new Date();
    loadMonthCalendar();
  });

  document.getElementById('calendar-grid').addEventListener('click', (e) => {
    const chipEl = e.target.closest('.cal-chip');
    if (chipEl) {
      openEventDetail(chipEl.dataset);
      return;
    }
    const cellEl = e.target.closest('.cal-month-cell');
    if (cellEl) {
      openSlotModal(cellEl.dataset.date);
    }
  });
}

async function loadTodaySchedule() {
  const data = await api('/api/schedule/today');
  const banner = document.getElementById('status-banner');
  banner.className = `status-banner ${data.canAskNow ? 'ok' : 'busy'}`;
  banner.textContent = data.canAskNow ? '✅ 今日は質問できます！' : '⏳ 現在は対応中です。空き時間はカレンダーをご確認ください。';
}

async function loadMonthCalendar() {
  const data = await api(`/api/schedule/month?date=${isoDate(calendarMonthDate)}`);
  document.getElementById('cal-range-label').textContent = `${calendarMonthDate.getFullYear()}年${calendarMonthDate.getMonth() + 1}月`;
  renderCalendar(data);
}

function renderCalendar(data) {
  const today = isoDate(new Date());
  const parts = CAL_WEEKDAY_LABELS.map((w) => `<div class="cal-month-headcell">${w}</div>`);

  data.days.forEach((date) => {
    const inMonth = date.slice(0, 7) === data.month;
    const isToday = date === today;
    const dayNum = Number(date.slice(8, 10));
    const items = buildDayItems(data, date);
    const chipHtml = items.map((item) => `<div class="cal-chip ${item.className}" ${item.dataAttrs}>${item.label}</div>`).join('');
    parts.push(`
      <div class="cal-month-cell${inMonth ? '' : ' is-outside'}" data-date="${date}">
        <div class="cal-day-number${isToday ? ' is-today' : ''}">${dayNum}</div>
        <div class="cal-chip-list">${chipHtml}</div>
      </div>
    `);
  });

  document.getElementById('calendar-grid').innerHTML = parts.join('');
}

function buildDayItems(data, date) {
  const items = [];

  data.entries
    .filter((e) => e.date === date)
    .forEach((e) => {
      const mine = e.source === 'mine';
      const label = mine ? escapeHtml(e.title) : '上司: 対応中';
      const dataAttrs = mine
        ? `data-kind="entry" data-id="${e.id}" data-date="${e.date}" data-start="${e.startTime}" data-end="${e.endTime}" data-title="${escapeHtml(e.title)}"`
        : `data-kind="entry" data-date="${e.date}" data-start="${e.startTime}" data-end="${e.endTime}"`;
      items.push({ start: timeStrToMinutes(e.startTime), className: mine ? 'busy' : 'boss-busy', label, dataAttrs });
    });

  data.appointments
    .filter((a) => a.date === date)
    .forEach((a) => {
      const label = a.mine ? '申請中（あなた）' : `${escapeHtml(a.fromUserName)}（申請中）`;
      const dataAttrs = `data-kind="pending" data-id="${a.id}" data-date="${a.date}" data-start="${a.startTime}" data-end="${a.endTime}" data-reason="${escapeHtml(a.reason || '')}" data-fromusername="${escapeHtml(a.fromUserName || '')}" data-mine="${a.mine}"`;
      items.push({ start: timeStrToMinutes(a.startTime), className: `pending${a.mine ? ' mine' : ''}`, label, dataAttrs });
    });

  return items.sort((a, b) => a.start - b.start);
}

function timeStrToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/* ---------- Modal helpers ---------- */
function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}

function openModal(title, buildBody, buildActions) {
  document.getElementById('modal-title').textContent = title;
  const bodyEl = document.getElementById('modal-body');
  const actionsEl = document.getElementById('modal-actions');
  bodyEl.innerHTML = '';
  actionsEl.innerHTML = '';
  buildBody(bodyEl);
  if (buildActions) buildActions(actionsEl);
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function makeButton(label, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.className = className;
  btn.onclick = onClick;
  return btn;
}

function openEventDetail(ds) {
  if (ds.kind === 'entry') {
    if (ds.id) {
      openModal(
        '予定の詳細',
        (body) => {
          body.innerHTML = `<p class="modal-meta"><strong>${escapeHtml(ds.title)}</strong><br>${escapeHtml(ds.date)} ${escapeHtml(ds.start)} - ${escapeHtml(ds.end)}</p>`;
        },
        (actions) => {
          actions.appendChild(
            makeButton('削除', 'danger-btn', async () => {
              await api(`/api/schedule/entries/${ds.id}`, { method: 'DELETE' });
              closeModal();
              loadMonthCalendar();
              loadTodaySchedule();
            })
          );
        }
      );
    } else {
      openModal('予定の詳細', (body) => {
        body.innerHTML = `<p class="modal-meta">${escapeHtml(ds.date)} ${escapeHtml(ds.start)} - ${escapeHtml(ds.end)}<br>上司の予定です（詳細は上司のみ確認できます）</p>`;
      });
    }
    return;
  }

  if (ds.kind === 'pending') {
    if (currentUser.role === 'boss') {
      openModal(
        'アポイント申請',
        (body) => {
          body.innerHTML = `<p class="modal-meta"><strong>${escapeHtml(ds.fromusername)}</strong><br>${escapeHtml(ds.date)} ${escapeHtml(ds.start)} - ${escapeHtml(ds.end)}<br>${escapeHtml(ds.reason || '（相談内容の指定なし）')}</p>`;
        },
        (actions) => {
          actions.appendChild(
            makeButton('承認', '', async () => {
              await api(`/api/schedule/appointments/${ds.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
              closeModal();
              loadMonthCalendar();
              loadTodaySchedule();
            })
          );
          actions.appendChild(
            makeButton('却下', 'danger-btn', async () => {
              await api(`/api/schedule/appointments/${ds.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) });
              closeModal();
              loadMonthCalendar();
              loadTodaySchedule();
            })
          );
        }
      );
    } else {
      openModal('アポイント申請', (body) => {
        body.innerHTML = `<p class="modal-meta">${escapeHtml(ds.date)} ${escapeHtml(ds.start)} - ${escapeHtml(ds.end)}<br>${escapeHtml(ds.reason || '')}<br>承認待ちです。</p>`;
      });
    }
  }
}

function openSlotModal(date) {
  const startTime = CAL_DEFAULT_START;
  const endTime = CAL_DEFAULT_END;

  if (currentUser.role === 'boss') {
    openModal(
      '予定を追加',
      (body) => {
        body.innerHTML = `
          <p class="modal-meta">${escapeHtml(fmtMonthDay(date))}</p>
          <label>開始時刻<input type="time" id="modal-start" value="${startTime}" /></label>
          <label>終了時刻<input type="time" id="modal-end" value="${endTime}" /></label>
          <label>予定名<input type="text" id="modal-title-input" placeholder="例：定例会議" /></label>
        `;
      },
      (actions) => {
        actions.appendChild(
          makeButton('追加', '', async () => {
            const start = document.getElementById('modal-start').value;
            const end = document.getElementById('modal-end').value;
            const title = document.getElementById('modal-title-input').value.trim();
            if (!title) {
              alert('予定名を入力してください。');
              return;
            }
            await api('/api/schedule/entries', {
              method: 'POST',
              body: JSON.stringify({ date, startTime: start, endTime: end, title })
            });
            closeModal();
            loadMonthCalendar();
            loadTodaySchedule();
          })
        );
      }
    );
  } else {
    let mode = 'own';
    let submitBtn;

    openModal(
      '予定を追加 / アポイント申請',
      (body) => {
        body.innerHTML = `
          <p class="modal-meta">${escapeHtml(fmtMonthDay(date))}</p>
          <label>種類
            <select id="modal-type">
              <option value="own">自分の予定を追加</option>
              <option value="appointment">上司にアポイントを申請</option>
            </select>
          </label>
          <label>開始時刻<input type="time" id="modal-start" value="${startTime}" /></label>
          <label>終了時刻<input type="time" id="modal-end" value="${endTime}" /></label>
          <div id="modal-extra"></div>
        `;
        renderSlotExtraField(mode);
        document.getElementById('modal-type').addEventListener('change', (e) => {
          mode = e.target.value;
          renderSlotExtraField(mode);
          if (submitBtn) submitBtn.textContent = mode === 'own' ? '自分の予定に追加' : '申請する';
        });
      },
      (actions) => {
        submitBtn = makeButton('自分の予定に追加', '', async () => {
          const start = document.getElementById('modal-start').value;
          const end = document.getElementById('modal-end').value;
          try {
            if (mode === 'own') {
              const title = document.getElementById('modal-title-input').value.trim();
              if (!title) {
                alert('予定名を入力してください。');
                return;
              }
              await api('/api/schedule/entries', {
                method: 'POST',
                body: JSON.stringify({ date, startTime: start, endTime: end, title })
              });
            } else {
              const reason = document.getElementById('modal-reason').value.trim();
              await api('/api/schedule/appointments', {
                method: 'POST',
                body: JSON.stringify({ date, startTime: start, endTime: end, reason })
              });
            }
            closeModal();
            loadMonthCalendar();
            loadTodaySchedule();
          } catch (err) {
            alert(err.message);
          }
        });
        actions.appendChild(submitBtn);
      }
    );
  }
}

function renderSlotExtraField(mode) {
  const el = document.getElementById('modal-extra');
  el.innerHTML =
    mode === 'own'
      ? '<label>予定名<input type="text" id="modal-title-input" placeholder="例：資料作成" /></label>'
      : '<label>相談内容（任意）<textarea id="modal-reason"></textarea></label>';
}

/* ---------- ③ Manual (rules / technical key points / announcements) ---------- */
const MANUAL_CATEGORIES = ['ルール', '技術要点', 'お知らせ'];

function initManual() {
  loadManualList();
  if (currentUser.role === 'boss') {
    document.getElementById('manual-admin').classList.remove('hidden');
    document.getElementById('manual-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const category = document.getElementById('mn-category').value;
      const title = document.getElementById('mn-title').value.trim();
      const description = document.getElementById('mn-description').value.trim();
      await api('/api/manual', { method: 'POST', body: JSON.stringify({ category, title, description }) });
      e.target.reset();
      loadManualList();
      loadManualAdminList();
    });
    document.getElementById('manual-upload-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('mn-pdf-file');
      if (!fileInput.files[0]) return;
      const formData = new FormData();
      formData.append('category', document.getElementById('mn-pdf-category').value);
      formData.append('title', document.getElementById('mn-pdf-title').value.trim());
      formData.append('file', fileInput.files[0]);
      try {
        await api('/api/manual/upload', { method: 'POST', body: formData });
        e.target.reset();
        loadManualList();
        loadManualAdminList();
      } catch (err) {
        alert(err.message);
      }
    });
    loadManualAdminList();
  }
}

async function loadManualList() {
  const { entries } = await api('/api/manual');
  const container = document.getElementById('manual-list');
  container.innerHTML = '';
  MANUAL_CATEGORIES.forEach((category) => {
    const items = entries.filter((e) => e.category === category);
    const section = document.createElement('div');
    section.className = 'manual-section';
    const heading = document.createElement('h3');
    heading.textContent = category;
    section.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-msg';
      empty.textContent = '登録されている内容はありません。';
      section.appendChild(empty);
    } else {
      items.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'manual-item';
        div.innerHTML = `<div class="manual-item-title">${escapeHtml(item.title)}</div>${item.description ? `<div class="manual-item-desc">${escapeHtml(item.description)}</div>` : ''}${item.hasFile ? `<a class="manual-item-pdf" href="/api/manual/${item.id}/file" target="_blank" rel="noopener">📄 PDFを開く</a>` : ''}`;
        section.appendChild(div);
      });
    }
    container.appendChild(section);
  });
}

async function loadManualAdminList() {
  const { entries } = await api('/api/manual');
  const list = document.getElementById('manual-admin-list');
  list.innerHTML = '';
  if (!entries.length) {
    list.innerHTML = '<li class="empty-msg">登録された内容はありません。</li>';
    return;
  }
  entries.forEach((e) => {
    const li = document.createElement('li');
    const metaText = e.hasFile ? `📄 ${escapeHtml(e.fileName || 'PDF')}` : escapeHtml(e.description || '');
    li.innerHTML = `<div><strong>[${escapeHtml(e.category)}] ${escapeHtml(e.title)}</strong><div class="meta">${metaText}</div></div>`;
    const del = document.createElement('button');
    del.textContent = '削除';
    del.className = 'small-btn danger-btn';
    del.onclick = async () => {
      await api(`/api/manual/${e.id}`, { method: 'DELETE' });
      loadManualList();
      loadManualAdminList();
    };
    li.appendChild(del);
    list.appendChild(li);
  });
}

/* ---------- ④ Chat ---------- */
function initChat() {
  if (currentUser.role === 'boss') {
    const wrap = document.getElementById('chat-partner-select-wrap');
    wrap.classList.remove('hidden');
    const select = document.getElementById('chat-partner-select');
    select.innerHTML = members.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
    select.addEventListener('change', () => {
      activePartnerId = select.value;
      loadThread();
    });
    activePartnerId = members[0] ? members[0].id : null;
  } else {
    activePartnerId = bossInfo ? bossInfo.id : null;
  }

  if (activePartnerId) loadThread();

  document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!activePartnerId || !input.value.trim()) return;
    await api(`/api/chat/thread/${activePartnerId}`, { method: 'POST', body: JSON.stringify({ text: input.value }) });
    input.value = '';
    loadThread();
  });
}

async function loadThread() {
  if (!activePartnerId) return;
  const { thread } = await api(`/api/chat/thread/${activePartnerId}`);
  const el = document.getElementById('chat-thread');
  el.innerHTML = '';
  if (!thread.length) {
    el.innerHTML = '<p class="empty-msg">まだメッセージはありません。</p>';
    return;
  }
  thread.forEach((m) => {
    const div = document.createElement('div');
    div.className = `chat-bubble ${m.fromUserId === currentUser.id ? 'mine' : 'theirs'}`;
    div.innerHTML = `${escapeHtml(m.text)}<span class="time">${timeLabel(m.timestamp)}</span>`;
    el.appendChild(div);
  });
  el.scrollTop = el.scrollHeight;
}

/* ---------- ⑤ AI summary (boss only) ---------- */
function initAiSummary() {
  const tabBtn = document.querySelector('.tab-btn[data-tab="ai"]');
  if (currentUser.role !== 'boss') {
    tabBtn.classList.add('hidden');
    return;
  }
  tabBtn.classList.remove('hidden');

  if (window.mermaid) mermaid.initialize({ startOnLoad: false });

  document.getElementById('ai-text-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = document.getElementById('ai-text-input').value.trim();
    if (!text) return;
    await runAiConversion(() => api('/api/ai/summarize-text', { method: 'POST', body: JSON.stringify({ text }) }));
  });

  document.getElementById('ai-pdf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('ai-pdf-input');
    if (!fileInput.files[0]) return;
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    await runAiConversion(() => api('/api/ai/summarize-pdf', { method: 'POST', body: formData }));
  });

  document.getElementById('ai-copy-btn').addEventListener('click', () => {
    const raw = document.getElementById('ai-result').dataset.raw || '';
    navigator.clipboard.writeText(raw);
  });
}

async function runAiConversion(request) {
  const statusEl = document.getElementById('ai-status');
  const resultWrap = document.getElementById('ai-result-wrap');
  statusEl.textContent = '変換中です…（Claude APIを呼び出しています）';
  resultWrap.classList.add('hidden');
  try {
    const { markdown } = await request();
    statusEl.textContent = '';
    const resultEl = document.getElementById('ai-result');
    renderMarkdownWithMermaid(markdown, resultEl);
    resultEl.dataset.raw = markdown;
    resultWrap.classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function renderMarkdownWithMermaid(markdown, containerEl) {
  containerEl.innerHTML = window.marked ? window.marked.parse(markdown) : escapeHtml(markdown);
  containerEl.querySelectorAll('pre code.language-mermaid').forEach((codeEl) => {
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = codeEl.textContent;
    codeEl.parentElement.replaceWith(div);
  });
  if (window.mermaid) {
    window.mermaid.run({ nodes: containerEl.querySelectorAll('.mermaid') }).catch(() => {});
  }
}

/* ---------- Utils ---------- */
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Init ---------- */
async function init() {
  let data;
  try {
    data = await api('/api/auth/me');
    currentUser = data.user;
    members = data.members || [];
    bossInfo = data.boss || null;
  } catch (err) {
    return;
  }

  const banner = document.getElementById('announcement-banner');
  if (data.announcement && data.announcement.text) {
    banner.classList.remove('hidden');
    banner.innerHTML = `📢 ${escapeHtml(data.announcement.text)}<span class="meta">${escapeHtml(data.announcement.updatedBy)} - ${timeLabel(data.announcement.updatedAt)}</span>`;
  }

  document.getElementById('user-badge').textContent = `${currentUser.name}（${currentUser.role === 'boss' ? '上司' : '部下'}）`;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  initTabs();
  initModal();
  initAsk();
  initSchedule();
  initManual();
  initChat();
  initAiSummary();
}

init();
