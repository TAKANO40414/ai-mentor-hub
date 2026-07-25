let currentUser = null;
let members = [];
let bossInfo = null;
let activePartnerId = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
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

/* ---------- ② Schedule calendar (Google Calendar-style week view) ---------- */
const CAL_HOUR_START = 9;
const CAL_HOUR_END = 18;
const CAL_ROW_HEIGHT = 44;
const CAL_WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

let calendarWeekDate = new Date();

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

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function initSchedule() {
  loadTodaySchedule();
  loadWeekCalendar();

  document.getElementById('cal-prev').addEventListener('click', () => {
    calendarWeekDate.setDate(calendarWeekDate.getDate() - 7);
    loadWeekCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calendarWeekDate.setDate(calendarWeekDate.getDate() + 7);
    loadWeekCalendar();
  });
  document.getElementById('cal-today').addEventListener('click', () => {
    calendarWeekDate = new Date();
    loadWeekCalendar();
  });

  document.getElementById('calendar-grid').addEventListener('click', (e) => {
    const eventEl = e.target.closest('.cal-event');
    if (eventEl) {
      openEventDetail(eventEl.dataset);
      return;
    }
    const colEl = e.target.closest('.cal-day-col');
    if (colEl) {
      const rect = colEl.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      openSlotModal(colEl.dataset.date, offsetY);
    }
  });
}

async function loadTodaySchedule() {
  const data = await api('/api/schedule/today');
  const banner = document.getElementById('status-banner');
  banner.className = `status-banner ${data.canAskNow ? 'ok' : 'busy'}`;
  banner.textContent = data.canAskNow ? '✅ 今日は質問できます！' : '⏳ 現在は対応中です。空き時間はカレンダーをご確認ください。';
}

async function loadWeekCalendar() {
  const data = await api(`/api/schedule/week?date=${isoDate(calendarWeekDate)}`);
  document.getElementById('cal-range-label').textContent = `${fmtMonthDay(data.days[0])} 〜 ${fmtMonthDay(data.days[6])}`;
  renderCalendar(data);
}

function renderCalendar(data) {
  const bodyHeight = (CAL_HOUR_END - CAL_HOUR_START) * CAL_ROW_HEIGHT;
  const today = isoDate(new Date());
  const parts = ['<div class="cal-corner"></div>'];

  data.days.forEach((date, i) => {
    const isToday = date === today ? ' is-today' : '';
    parts.push(`<div class="cal-day-head${isToday}">${CAL_WEEKDAY_LABELS[i]}<br>${fmtMonthDay(date)}</div>`);
  });

  const timeLabels = [];
  for (let h = CAL_HOUR_START; h <= CAL_HOUR_END; h++) {
    const top = (h - CAL_HOUR_START) * CAL_ROW_HEIGHT;
    timeLabels.push(`<span class="cal-time-label" style="top:${top}px">${h}:00</span>`);
  }
  parts.push(`<div class="cal-time-axis" style="height:${bodyHeight}px">${timeLabels.join('')}</div>`);

  data.days.forEach((date) => {
    const items = buildDayItems(data, date);
    const eventHtml = items
      .map((item, idx) => {
        const lane = idx % 3;
        const left = 3 + lane * 5;
        const width = 94 - lane * 5;
        return `<div class="cal-event ${item.className}" style="top:${item.top}px;height:${item.height}px;left:${left}%;width:${width}%" ${item.dataAttrs}>${item.label}</div>`;
      })
      .join('');
    parts.push(
      `<div class="cal-day-col" data-date="${date}" style="height:${bodyHeight}px;background-size:100% ${CAL_ROW_HEIGHT}px">${eventHtml}</div>`
    );
  });

  document.getElementById('calendar-grid').innerHTML = parts.join('');
}

function clampToRange(startMin, endMin) {
  const rangeStart = CAL_HOUR_START * 60;
  const rangeEnd = CAL_HOUR_END * 60;
  return [Math.max(startMin, rangeStart), Math.min(endMin, rangeEnd)];
}

function buildDayItems(data, date) {
  const items = [];

  data.entries
    .filter((e) => e.date === date)
    .forEach((e) => {
      const [s, en] = clampToRange(timeStrToMinutes(e.startTime), timeStrToMinutes(e.endTime));
      if (en <= s) return;
      const top = ((s - CAL_HOUR_START * 60) / 60) * CAL_ROW_HEIGHT;
      const height = Math.max(18, ((en - s) / 60) * CAL_ROW_HEIGHT - 2);
      const hasDetail = Boolean(e.id);
      const label = hasDetail ? escapeHtml(e.title) : '対応中';
      const dataAttrs = hasDetail
        ? `data-kind="entry" data-id="${e.id}" data-date="${e.date}" data-start="${e.startTime}" data-end="${e.endTime}" data-title="${escapeHtml(e.title)}"`
        : `data-kind="entry" data-date="${e.date}" data-start="${e.startTime}" data-end="${e.endTime}"`;
      items.push({ start: s, top, height, className: hasDetail ? 'busy' : 'busy-plain', label, dataAttrs });
    });

  data.appointments
    .filter((a) => a.date === date)
    .forEach((a) => {
      const [s, en] = clampToRange(timeStrToMinutes(a.startTime), timeStrToMinutes(a.endTime));
      if (en <= s) return;
      const top = ((s - CAL_HOUR_START * 60) / 60) * CAL_ROW_HEIGHT;
      const height = Math.max(18, ((en - s) / 60) * CAL_ROW_HEIGHT - 2);
      const label = a.mine ? '申請中（あなた）' : `${escapeHtml(a.fromUserName)}（申請中）`;
      const dataAttrs = `data-kind="pending" data-id="${a.id}" data-date="${a.date}" data-start="${a.startTime}" data-end="${a.endTime}" data-reason="${escapeHtml(a.reason || '')}" data-fromusername="${escapeHtml(a.fromUserName || '')}" data-mine="${a.mine}"`;
      items.push({ start: s, top, height, className: `pending${a.mine ? ' mine' : ''}`, label, dataAttrs });
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
              loadWeekCalendar();
              loadTodaySchedule();
            })
          );
        }
      );
    } else {
      openModal('予定の詳細', (body) => {
        body.innerHTML = `<p class="modal-meta">${escapeHtml(ds.date)} ${escapeHtml(ds.start)} - ${escapeHtml(ds.end)}<br>対応中です（詳細は上司のみ確認できます）</p>`;
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
              loadWeekCalendar();
              loadTodaySchedule();
            })
          );
          actions.appendChild(
            makeButton('却下', 'danger-btn', async () => {
              await api(`/api/schedule/appointments/${ds.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) });
              closeModal();
              loadWeekCalendar();
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

function openSlotModal(date, offsetY) {
  const rawMinutes = CAL_HOUR_START * 60 + (offsetY / CAL_ROW_HEIGHT) * 60;
  const snapped = Math.round(rawMinutes / 30) * 30;
  const clamped = Math.min(Math.max(snapped, CAL_HOUR_START * 60), CAL_HOUR_END * 60 - 30);
  const startTime = minutesToTime(clamped);
  const endTime = minutesToTime(clamped + 30);

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
            loadWeekCalendar();
            loadTodaySchedule();
          })
        );
      }
    );
  } else {
    openModal(
      'アポイントを申請',
      (body) => {
        body.innerHTML = `
          <p class="modal-meta">${escapeHtml(fmtMonthDay(date))}</p>
          <label>開始時刻<input type="time" id="modal-start" value="${startTime}" /></label>
          <label>終了時刻<input type="time" id="modal-end" value="${endTime}" /></label>
          <label>相談内容（任意）<textarea id="modal-reason"></textarea></label>
        `;
      },
      (actions) => {
        actions.appendChild(
          makeButton('申請する', '', async () => {
            const start = document.getElementById('modal-start').value;
            const end = document.getElementById('modal-end').value;
            const reason = document.getElementById('modal-reason').value.trim();
            try {
              await api('/api/schedule/appointments', {
                method: 'POST',
                body: JSON.stringify({ date, startTime: start, endTime: end, reason })
              });
              closeModal();
              loadWeekCalendar();
            } catch (err) {
              alert(err.message);
            }
          })
        );
      }
    );
  }
}

/* ---------- ③ Tech tip ---------- */
function initTech() {
  loadTodayTechTip();
  if (currentUser.role === 'boss') {
    document.getElementById('tech-admin').classList.remove('hidden');
    document.getElementById('tech-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = document.getElementById('tt-date').value;
      const technology = document.getElementById('tt-technology').value.trim();
      const relatedTask = document.getElementById('tt-related').value.trim();
      const description = document.getElementById('tt-description').value.trim();
      await api('/api/techtips', { method: 'POST', body: JSON.stringify({ date, technology, relatedTask, description }) });
      e.target.reset();
      loadTechTipList();
      loadTodayTechTip();
    });
    loadTechTipList();
  }
}

async function loadTodayTechTip() {
  const { tips } = await api('/api/techtips/today');
  const el = document.getElementById('tech-today');
  el.innerHTML = '';
  if (!tips.length) {
    el.innerHTML = '<p class="empty-msg">本日の技術情報はまだ登録されていません。</p>';
    return;
  }
  tips.forEach((t) => {
    const div = document.createElement('div');
    div.className = 'tip-card';
    div.innerHTML = `<div class="tech-name">今日はこの技術を使います：${escapeHtml(t.technology)}</div>${t.relatedTask ? `<div class="related">関連タスク：${escapeHtml(t.relatedTask)}</div>` : ''}${t.description ? `<div class="desc">${escapeHtml(t.description)}</div>` : ''}`;
    el.appendChild(div);
  });
}

async function loadTechTipList() {
  const { tips } = await api('/api/techtips');
  const list = document.getElementById('tech-list');
  list.innerHTML = '';
  if (!tips.length) {
    list.innerHTML = '<li class="empty-msg">登録されたTipはありません。</li>';
    return;
  }
  tips.forEach((t) => {
    const li = document.createElement('li');
    li.innerHTML = `<div><strong>${escapeHtml(t.date)} - ${escapeHtml(t.technology)}</strong><div class="meta">${escapeHtml(t.description || '')}</div></div>`;
    const del = document.createElement('button');
    del.textContent = '削除';
    del.className = 'small-btn danger-btn';
    del.onclick = async () => {
      await api(`/api/techtips/${t.id}`, { method: 'DELETE' });
      loadTechTipList();
      loadTodayTechTip();
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

/* ---------- Utils ---------- */
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Init ---------- */
async function init() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    members = data.members || [];
    bossInfo = data.boss || null;
  } catch (err) {
    return;
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
  initTech();
  initChat();
}

init();
