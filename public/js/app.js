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

function statusTagLabel(status) {
  return { pending: '承認待ち', approved: '承認済み', rejected: '却下' }[status] || status;
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

/* ---------- ② Schedule & appointment ---------- */
function initSchedule() {
  loadTodaySchedule();
  loadMyAppointments();

  document.getElementById('appointment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = document.getElementById('apt-date').value;
    const startTime = document.getElementById('apt-start').value;
    const endTime = document.getElementById('apt-end').value;
    const reason = document.getElementById('apt-reason').value.trim();
    try {
      await api('/api/schedule/appointments', {
        method: 'POST',
        body: JSON.stringify({ date, startTime, endTime, reason })
      });
      e.target.reset();
      loadMyAppointments();
      if (currentUser.role === 'boss') loadPendingAppointments();
    } catch (err) {
      alert(err.message);
    }
  });

  if (currentUser.role === 'boss') {
    document.getElementById('schedule-admin').classList.remove('hidden');
    document.getElementById('schedule-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = document.getElementById('s-date').value;
      const startTime = document.getElementById('s-start').value;
      const endTime = document.getElementById('s-end').value;
      const title = document.getElementById('s-title').value.trim();
      await api('/api/schedule/entries', { method: 'POST', body: JSON.stringify({ date, startTime, endTime, title }) });
      e.target.reset();
      loadScheduleEntries();
      loadTodaySchedule();
    });
    loadScheduleEntries();
    loadPendingAppointments();
  }
}

async function loadTodaySchedule() {
  const data = await api('/api/schedule/today');
  const banner = document.getElementById('status-banner');
  banner.className = `status-banner ${data.canAskNow ? 'ok' : 'busy'}`;
  banner.textContent = data.canAskNow ? '✅ 今日は質問できます！' : '⏳ 現在は対応中です。空き時間をご確認ください。';

  const slotsEl = document.getElementById('free-slots');
  slotsEl.innerHTML = '';
  if (!data.freeSlots.length) {
    slotsEl.innerHTML = '<li class="empty-msg">本日の空き時間はありません。</li>';
  } else {
    data.freeSlots.forEach((s) => {
      const li = document.createElement('li');
      li.textContent = `${s.start} 〜 ${s.end}`;
      slotsEl.appendChild(li);
    });
  }
}

async function loadMyAppointments() {
  const { appointments } = await api('/api/schedule/appointments');
  const list = document.getElementById('my-appointments');
  list.innerHTML = '';
  const mine = currentUser.role === 'boss' ? appointments : appointments;
  if (!mine.length) {
    list.innerHTML = '<li class="empty-msg">申請はまだありません。</li>';
    return;
  }
  mine.forEach((a) => {
    const li = document.createElement('li');
    li.innerHTML = `<div><strong>${escapeHtml(a.date)} ${escapeHtml(a.startTime)}-${escapeHtml(a.endTime)}</strong><div class="meta">${escapeHtml(a.reason || '')}${currentUser.role === 'boss' ? ' / ' + escapeHtml(a.fromUserName) : ''}</div></div><span class="status-tag ${a.status}">${statusTagLabel(a.status)}</span>`;
    list.appendChild(li);
  });
}

async function loadPendingAppointments() {
  const { appointments } = await api('/api/schedule/appointments');
  const list = document.getElementById('pending-appointments');
  list.innerHTML = '';
  const pending = appointments.filter((a) => a.status === 'pending');
  if (!pending.length) {
    list.innerHTML = '<li class="empty-msg">承認待ちの申請はありません。</li>';
    return;
  }
  pending.forEach((a) => {
    const li = document.createElement('li');
    li.innerHTML = `<div><strong>${escapeHtml(a.fromUserName)}</strong><div class="meta">${escapeHtml(a.date)} ${escapeHtml(a.startTime)}-${escapeHtml(a.endTime)} / ${escapeHtml(a.reason || '')}</div></div>`;
    const actions = document.createElement('div');
    const approveBtn = document.createElement('button');
    approveBtn.textContent = '承認';
    approveBtn.className = 'small-btn';
    approveBtn.onclick = () => decideAppointment(a.id, 'approved');
    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = '却下';
    rejectBtn.className = 'small-btn danger-btn';
    rejectBtn.onclick = () => decideAppointment(a.id, 'rejected');
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

async function decideAppointment(id, decision) {
  await api(`/api/schedule/appointments/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision }) });
  loadPendingAppointments();
  loadMyAppointments();
  loadTodaySchedule();
  loadScheduleEntries();
}

async function loadScheduleEntries() {
  const { entries } = await api('/api/schedule/entries');
  const list = document.getElementById('schedule-list');
  list.innerHTML = '';
  if (!entries.length) {
    list.innerHTML = '<li class="empty-msg">登録された予定はありません。</li>';
    return;
  }
  entries.forEach((s) => {
    const li = document.createElement('li');
    li.innerHTML = `<div><strong>${escapeHtml(s.title)}</strong><div class="meta">${escapeHtml(s.date)} ${escapeHtml(s.startTime)}-${escapeHtml(s.endTime)}</div></div>`;
    const del = document.createElement('button');
    del.textContent = '削除';
    del.className = 'small-btn danger-btn';
    del.onclick = async () => {
      await api(`/api/schedule/entries/${s.id}`, { method: 'DELETE' });
      loadScheduleEntries();
      loadTodaySchedule();
    };
    li.appendChild(del);
    list.appendChild(li);
  });
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
  initAsk();
  initSchedule();
  initTech();
  initChat();
}

init();
