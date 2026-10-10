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

/* ---------- ② Schedule calendar (month / week / day views) ---------- */
const CAL_WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];
const CAL_DEFAULT_START = '09:00';
const CAL_DEFAULT_END = '09:30';
const CAL_HOUR_START = 8;
const CAL_HOUR_END = 23;
const CAL_ROW_HEIGHT = 40;
const PERSON_COLORS = ['#e6553f', '#3f9e6d', '#2fa5a0', '#e0a52b', '#8a6b4f', '#e0559c', '#4f8fe0', '#8b5fe0', '#707070', '#2c2c2c'];

let calendarViewMode = 'month'; // 'month' | 'week' | 'day'
let calendarCursorDate = new Date();
let lastRangeData = null;
let hiddenPeopleIds = new Set();

function personColor(ownerId, people) {
  const idx = people.findIndex((p) => p.id === ownerId);
  return PERSON_COLORS[(idx >= 0 ? idx : 0) % PERSON_COLORS.length];
}

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

function timeStrToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function initSchedule() {
  loadTodaySchedule();
  loadCalendarView();

  document.querySelectorAll('.cal-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cal-view-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      calendarViewMode = btn.dataset.view;
      loadCalendarView();
    });
  });

  document.getElementById('cal-prev').addEventListener('click', () => {
    stepCalendarCursor(-1);
    loadCalendarView();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    stepCalendarCursor(1);
    loadCalendarView();
  });
  document.getElementById('cal-today').addEventListener('click', () => {
    calendarCursorDate = new Date();
    loadCalendarView();
  });
  document.getElementById('cal-reload').addEventListener('click', () => {
    loadCalendarView();
    loadTodaySchedule();
  });
  document.getElementById('cal-filter').addEventListener('click', openPeopleFilterModal);

  document.getElementById('calendar-grid').addEventListener('click', (e) => {
    const chipEl = e.target.closest('.cal-chip, .cal-week-event, .cal-day-item');
    if (chipEl) {
      openEventDetail(chipEl.dataset);
      return;
    }

    const addBtn = e.target.closest('.cal-day-add-btn');
    if (addBtn) {
      openSlotModal(addBtn.dataset.date);
      return;
    }

    const monthCell = e.target.closest('.cal-month-cell');
    if (monthCell) {
      openSlotModal(monthCell.dataset.date);
      return;
    }

    const weekCol = e.target.closest('.cal-week-col');
    if (weekCol) {
      const rect = weekCol.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      const rawMinutes = CAL_HOUR_START * 60 + (offsetY / CAL_ROW_HEIGHT) * 60;
      const snapped = Math.round(rawMinutes / 30) * 30;
      const clamped = Math.min(Math.max(snapped, CAL_HOUR_START * 60), CAL_HOUR_END * 60 - 30);
      openSlotModal(weekCol.dataset.date, minutesToTime(clamped));
      return;
    }

    const dayRow = e.target.closest('.cal-day-row');
    if (dayRow) {
      const h = Number(dayRow.dataset.hour);
      openSlotModal(dayRow.dataset.date, `${String(h).padStart(2, '0')}:00`);
    }
  });
}

function stepCalendarCursor(dir) {
  if (calendarViewMode === 'month') {
    calendarCursorDate.setMonth(calendarCursorDate.getMonth() + dir);
  } else if (calendarViewMode === 'week') {
    calendarCursorDate.setDate(calendarCursorDate.getDate() + dir * 7);
  } else {
    calendarCursorDate.setDate(calendarCursorDate.getDate() + dir);
  }
}

async function loadTodaySchedule() {
  const data = await api('/api/schedule/today');
  const banner = document.getElementById('status-banner');
  banner.className = `status-banner ${data.canAskNow ? 'ok' : 'busy'}`;
  banner.textContent = data.canAskNow ? '✅ 今日は質問できます！' : '⏳ 現在は対応中です。空き時間はカレンダーをご確認ください。';
}

async function loadCalendarView() {
  if (calendarViewMode === 'month') {
    const data = await api(`/api/schedule/month?date=${isoDate(calendarCursorDate)}`);
    lastRangeData = data;
    document.getElementById('cal-range-label').textContent = `${calendarCursorDate.getFullYear()}年${calendarCursorDate.getMonth() + 1}月`;
    renderMonthView(data);
  } else if (calendarViewMode === 'week') {
    const data = await api(`/api/schedule/week?date=${isoDate(calendarCursorDate)}`);
    lastRangeData = data;
    document.getElementById('cal-range-label').textContent = `${fmtMonthDay(data.days[0])} 〜 ${fmtMonthDay(data.days[6])}`;
    renderWeekView(data);
  } else {
    const data = await api(`/api/schedule/day?date=${isoDate(calendarCursorDate)}`);
    lastRangeData = data;
    document.getElementById('cal-range-label').textContent = `${calendarCursorDate.getFullYear()}年${calendarCursorDate.getMonth() + 1}月${calendarCursorDate.getDate()}日`;
    renderDayView(data);
  }
  renderCalendarLegend(lastRangeData);
  const scrollEl = document.querySelector('.calendar-scroll');
  if (scrollEl) scrollEl.scrollLeft = 0;
}

function renderCalendarLegend(data) {
  const el = document.getElementById('calendar-legend');
  const peopleHtml = data.people
    .map(
      (p, i) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${PERSON_COLORS[i % PERSON_COLORS.length]}"></span>${escapeHtml(p.name)}</span>`
    )
    .join('');
  el.innerHTML = `${peopleHtml}<span class="legend-item"><span class="legend-dot pending"></span>申請中</span>`;
}

function openPeopleFilterModal() {
  if (!lastRangeData) return;
  openModal(
    '表示する人を選択',
    (body) => {
      body.innerHTML = lastRangeData.people
        .map(
          (p, i) => `
            <label style="flex-direction: row; align-items: center; gap: 0.5rem;">
              <input type="checkbox" data-person-id="${p.id}" ${hiddenPeopleIds.has(p.id) ? '' : 'checked'} />
              <span class="legend-dot" style="background:${PERSON_COLORS[i % PERSON_COLORS.length]}"></span>
              <span>${escapeHtml(p.name)}</span>
            </label>
          `
        )
        .join('');
    },
    (actions) => {
      actions.appendChild(
        makeButton('適用', '', () => {
          const checkboxes = document.querySelectorAll('#modal-body input[type="checkbox"]');
          hiddenPeopleIds = new Set();
          checkboxes.forEach((cb) => {
            if (!cb.checked) hiddenPeopleIds.add(cb.dataset.personId);
          });
          closeModal();
          rerenderCurrentView();
        })
      );
    }
  );
}

function rerenderCurrentView() {
  if (!lastRangeData) return;
  if (calendarViewMode === 'month') renderMonthView(lastRangeData);
  else if (calendarViewMode === 'week') renderWeekView(lastRangeData);
  else renderDayView(lastRangeData);
}

function buildTimedItems(data, date) {
  const items = [];

  data.entries
    .filter((e) => e.date === date && !hiddenPeopleIds.has(e.ownerId))
    .forEach((e) => {
      const color = personColor(e.ownerId, data.people);
      const label = `${escapeHtml(e.ownerName)}：${escapeHtml(e.title)}`;
      const dataAttrs = `data-kind="entry" data-id="${e.id}" data-date="${e.date}" data-start="${e.startTime}" data-end="${e.endTime}" data-title="${escapeHtml(e.title)}" data-ownername="${escapeHtml(e.ownerName)}" data-owner="${e.ownerId}"`;
      items.push({ start: timeStrToMinutes(e.startTime), end: timeStrToMinutes(e.endTime), style: `background:${color}`, label, dataAttrs });
    });

  data.appointments
    .filter((a) => a.date === date)
    .forEach((a) => {
      const label = a.mine ? '申請中（あなた）' : `${escapeHtml(a.fromUserName)}（申請中）`;
      const dataAttrs = `data-kind="pending" data-id="${a.id}" data-date="${a.date}" data-start="${a.startTime}" data-end="${a.endTime}" data-reason="${escapeHtml(a.reason || '')}" data-fromusername="${escapeHtml(a.fromUserName || '')}" data-mine="${a.mine}"`;
      items.push({ start: timeStrToMinutes(a.startTime), end: timeStrToMinutes(a.endTime), className: `pending${a.mine ? ' mine' : ''}`, label, dataAttrs });
    });

  return items.sort((a, b) => a.start - b.start);
}

/* ----- Month view ----- */
function renderMonthView(data) {
  const grid = document.getElementById('calendar-grid');
  grid.className = 'calendar-grid';

  const today = isoDate(new Date());
  const parts = CAL_WEEKDAY_LABELS.map((w) => `<div class="cal-month-headcell">${w}</div>`);

  data.days.forEach((date) => {
    const inMonth = date.slice(0, 7) === data.month;
    const isToday = date === today;
    const dayNum = Number(date.slice(8, 10));
    const items = buildTimedItems(data, date);
    const chipHtml = items
      .map((item) => `<div class="cal-chip ${item.className || ''}" style="${item.style || ''}" ${item.dataAttrs}>${item.label}</div>`)
      .join('');
    parts.push(`
      <div class="cal-month-cell${inMonth ? '' : ' is-outside'}" data-date="${date}">
        <div class="cal-day-number${isToday ? ' is-today' : ''}">${dayNum}</div>
        <div class="cal-chip-list">${chipHtml}</div>
      </div>
    `);
  });

  grid.innerHTML = parts.join('');
}

/* ----- Week view ----- */
function renderWeekView(data) {
  const grid = document.getElementById('calendar-grid');
  grid.className = 'calendar-grid view-week';

  const bodyHeight = (CAL_HOUR_END - CAL_HOUR_START) * CAL_ROW_HEIGHT;
  const today = isoDate(new Date());
  const parts = ['<div class="cal-corner"></div>'];

  data.days.forEach((date, i) => {
    const isToday = date === today ? ' is-today' : '';
    parts.push(`<div class="cal-week-headcell${isToday}">${CAL_WEEKDAY_LABELS[i]}<br>${fmtMonthDay(date)}</div>`);
  });

  const timeLabels = [];
  for (let h = CAL_HOUR_START; h <= CAL_HOUR_END; h++) {
    timeLabels.push(`<span class="cal-time-label" style="top:${(h - CAL_HOUR_START) * CAL_ROW_HEIGHT}px">${h}:00</span>`);
  }
  parts.push(`<div class="cal-time-axis" style="height:${bodyHeight}px">${timeLabels.join('')}</div>`);

  data.days.forEach((date) => {
    const items = buildTimedItems(data, date);
    const html = items
      .map((item, idx) => {
        const [s, en] = clampToHourRange(item.start, item.end);
        if (en <= s) return '';
        const top = ((s - CAL_HOUR_START * 60) / 60) * CAL_ROW_HEIGHT;
        const height = Math.max(16, ((en - s) / 60) * CAL_ROW_HEIGHT - 2);
        const lane = idx % 3;
        const left = 2 + lane * 4;
        const width = 96 - lane * 4;
        return `<div class="cal-week-event ${item.className || ''}" style="top:${top}px;height:${height}px;left:${left}%;width:${width}%;${item.style || ''}" ${item.dataAttrs}>${item.label}</div>`;
      })
      .join('');
    parts.push(
      `<div class="cal-week-col" data-date="${date}" style="height:${bodyHeight}px;background-size:100% ${CAL_ROW_HEIGHT}px">${html}</div>`
    );
  });

  grid.innerHTML = parts.join('');
}

function clampToHourRange(startMin, endMin) {
  const rangeStart = CAL_HOUR_START * 60;
  const rangeEnd = CAL_HOUR_END * 60;
  return [Math.max(startMin, rangeStart), Math.min(endMin, rangeEnd)];
}

/* ----- Day view ----- */
function renderDayView(data) {
  const grid = document.getElementById('calendar-grid');
  grid.className = 'calendar-grid view-day';

  const items = buildTimedItems(data, data.date);
  const grouped = {};
  items.forEach((item) => {
    const h = Math.max(CAL_HOUR_START, Math.min(CAL_HOUR_END, Math.floor(item.start / 60)));
    if (!grouped[h]) grouped[h] = [];
    grouped[h].push(item);
  });

  const rows = [];
  for (let h = CAL_HOUR_START; h <= CAL_HOUR_END; h++) {
    const hourItems = grouped[h] || [];
    const itemsHtml = hourItems
      .map((item) => `<div class="cal-day-item ${item.className || ''}" style="${item.style || ''}" ${item.dataAttrs}>${item.label}</div>`)
      .join('');
    rows.push(`
      <div class="cal-day-row" data-hour="${h}" data-date="${data.date}">
        <div class="cal-day-row-time">${String(h).padStart(2, '0')}:00</div>
        <div class="cal-day-row-content">${itemsHtml}</div>
      </div>
    `);
  }

  grid.innerHTML = `
    <div class="cal-day-list-header">
      <div class="cal-day-list-date">${escapeHtml(fmtMonthDay(data.date))}</div>
      <button type="button" class="cal-day-add-btn" data-date="${data.date}">+</button>
    </div>
    <div class="cal-day-rows">${rows.join('')}</div>
  `;
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
    const mine = ds.owner === currentUser.id;
    openModal(
      '予定の詳細',
      (body) => {
        body.innerHTML = `<p class="modal-meta"><strong>${escapeHtml(ds.ownername)}：${escapeHtml(ds.title)}</strong><br>${escapeHtml(ds.date)} ${escapeHtml(ds.start)} - ${escapeHtml(ds.end)}</p>`;
      },
      mine
        ? (actions) => {
            actions.appendChild(
              makeButton('削除', 'danger-btn', async () => {
                await api(`/api/schedule/entries/${ds.id}`, { method: 'DELETE' });
                closeModal();
                loadCalendarView();
                loadTodaySchedule();
              })
            );
          }
        : undefined
    );
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
              loadCalendarView();
              loadTodaySchedule();
            })
          );
          actions.appendChild(
            makeButton('却下', 'danger-btn', async () => {
              await api(`/api/schedule/appointments/${ds.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) });
              closeModal();
              loadCalendarView();
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

function openSlotModal(date, startTimeOverride) {
  const startTime = startTimeOverride || CAL_DEFAULT_START;
  const endTime = startTimeOverride ? minutesToTime(timeStrToMinutes(startTimeOverride) + 30) : CAL_DEFAULT_END;

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
            loadCalendarView();
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
            loadCalendarView();
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
let manualEntries = [];
let manualActiveCategory = MANUAL_CATEGORIES[0];
let manualKeyword = '';
let manualFilter = 'all';

function initManual() {
  renderManualChannelList();
  document.getElementById('manual-search-toggle').addEventListener('click', () => {
    document.getElementById('manual-search-card').classList.toggle('hidden');
  });
  document.getElementById('manual-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    manualKeyword = document.getElementById('manual-search-input').value.trim();
    renderManualList();
  });
  document.querySelectorAll('.manual-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.manual-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      manualFilter = btn.dataset.filter;
      renderManualList();
    });
  });

  if (currentUser.role === 'boss') {
    const createBtn = document.getElementById('manual-create-btn');
    createBtn.classList.remove('hidden');
    createBtn.addEventListener('click', () => {
      document.getElementById('manual-admin').classList.toggle('hidden');
    });
    document.getElementById('manual-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const category = document.getElementById('mn-category').value;
      const title = document.getElementById('mn-title').value.trim();
      const description = document.getElementById('mn-description').value.trim();
      await api('/api/manual', { method: 'POST', body: JSON.stringify({ category, title, description }) });
      e.target.reset();
      manualActiveCategory = category;
      loadManualList();
    });
    document.getElementById('manual-upload-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('mn-pdf-file');
      if (!fileInput.files[0]) return;
      const category = document.getElementById('mn-pdf-category').value;
      const formData = new FormData();
      formData.append('category', category);
      formData.append('title', document.getElementById('mn-pdf-title').value.trim());
      formData.append('file', fileInput.files[0]);
      try {
        await api('/api/manual/upload', { method: 'POST', body: formData });
        e.target.reset();
        manualActiveCategory = category;
        loadManualList();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  loadManualList();
}

function renderManualChannelList() {
  const nav = document.getElementById('manual-channel-list');
  nav.innerHTML = MANUAL_CATEGORIES.map(
    (category) =>
      `<button type="button" class="manual-channel-btn${category === manualActiveCategory ? ' active' : ''}" data-category="${escapeHtml(category)}"># ${escapeHtml(category)}</button>`
  ).join('');
  nav.querySelectorAll('.manual-channel-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      manualActiveCategory = btn.dataset.category;
      renderManualChannelList();
      renderManualList();
    });
  });
}

function formatManualDate(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return '今日';
  if (days < 30) return `${days}日`;
  if (days < 365) return `${Math.floor(days / 30)}か月`;
  return `${Math.floor(days / 365)}年`;
}

async function loadManualList() {
  const { entries } = await api('/api/manual');
  manualEntries = entries;
  renderManualList();
}

function renderManualList() {
  const categoryItems = manualEntries.filter((e) => e.category === manualActiveCategory);
  document.getElementById('manual-active-title').textContent = `# ${manualActiveCategory}`;
  document.getElementById('manual-active-count').textContent = `${categoryItems.length}件`;

  const keyword = manualKeyword.toLowerCase();
  const items = categoryItems.filter((item) => {
    if (manualFilter === 'text' && item.hasFile) return false;
    if (manualFilter === 'pdf' && !item.hasFile) return false;
    if (!keyword) return true;
    return `${item.title} ${item.description}`.toLowerCase().includes(keyword);
  });

  const container = document.getElementById('manual-list');
  if (!items.length) {
    container.innerHTML = '<p class="empty-msg">登録されている内容はありません。</p>';
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const meta = [item.createdBy, formatManualDate(item.createdAt)].filter(Boolean).join('　');
      const desc = item.description ? `<div class="manual-card-desc">${escapeHtml(item.description)}</div>` : '';
      const pdf = item.hasFile
        ? `<a class="manual-card-pdf" href="/api/manual/${item.id}/file" target="_blank" rel="noopener">📄 ${escapeHtml(item.fileName || 'PDF')}を開く</a>`
        : '';
      const del =
        currentUser.role === 'boss'
          ? `<div class="manual-card-actions"><button type="button" class="small-btn danger-btn" data-delete-id="${item.id}">削除</button></div>`
          : '';
      const sphere = `<div class="manual-card-actions"><button type="button" class="small-btn ghost-btn" data-sphere-id="${item.id}">◎ 技術伝承に入れる</button></div>`;
      return `<div class="manual-card">
        <div class="manual-card-meta"><span class="cat-tag"># ${escapeHtml(item.category)}</span>${meta ? escapeHtml(meta) : ''}</div>
        <div class="manual-card-title">${escapeHtml(item.title)}</div>
        ${desc}
        ${pdf}
        ${sphere}
        ${del}
      </div>`;
    })
    .join('');

  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/manual/${btn.dataset.deleteId}`, { method: 'DELETE' });
      loadManualList();
    });
  });
  container.querySelectorAll('[data-sphere-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = manualEntries.find((e) => e.id === btn.dataset.sphereId);
      if (item) openManualToSphereModal(item);
    });
  });
}

/* マニュアル → 技術伝承（球体）：AIで手順に分けてから、確認して点として入れる */
function openManualToSphereModal(item) {
  openSphereImportModal({
    title: item.title,
    load: () => api(`/api/ai/manual-to-sphere/${item.id}`, { method: 'POST' }),
    fallback: item.description
      ? { title: item.title, process: item.category, summary: '', steps: [{ title: item.title.slice(0, 40), body: item.description, tag: '目線', caution: '' }], tips: [], questions: [] }
      : null
  });
}

/* AI要約（Markdown）→ 技術伝承（球体） */
function openSummaryToSphereModal(markdown) {
  const heading = (markdown.match(/^#\s*(.+)$/m) || [])[1];
  const title = (heading || 'AI要約').trim().slice(0, 40);
  const plain = markdown.replace(/```[\s\S]*?```/g, '').replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
  openSphereImportModal({
    title,
    load: () => api('/api/ai/manual-from-voice', { method: 'POST', body: JSON.stringify({ transcript: markdown, hint: title }) }),
    fallback: { title, process: 'AI要約', summary: '', steps: [{ title, body: plain, tag: '目線', caution: '' }], tips: [], questions: [] }
  });
}

/* 共通：AIで手順に分ける → 確認 → 球体の IndexedDB に入れる */
async function openSphereImportModal({ title, load, fallback }) {
  let manual = null;
  openModal(
    '技術伝承に入れる',
    (body) => {
      body.innerHTML = `<p class="modal-meta"><strong>${escapeHtml(title)}</strong></p><p id="m2s-status" class="empty-msg">AIが内容を手順（点）に分けています…</p><div id="m2s-preview" class="ai-result hidden"></div>`;
    },
    (actions) => {
      actions.appendChild(makeButton('やめる', 'ghost-btn', closeModal));
    }
  );
  const statusEl = document.getElementById('m2s-status');
  const previewEl = document.getElementById('m2s-preview');
  const actionsEl = document.getElementById('modal-actions');

  const showPreview = (m, note) => {
    manual = m;
    statusEl.textContent = note || `${m.steps.length} 個の手順と ${m.tips.length} 個のコツに分けました。内容を確認して「球体に入れる」を押してください。`;
    previewEl.innerHTML = `
      ${m.process ? `<p><strong>工程：</strong>${escapeHtml(m.process)}</p>` : ''}
      <ol>${m.steps.map((st) => `<li><strong>${escapeHtml(st.title)}</strong> <span class="voice-step-tag">${escapeHtml(st.tag)}</span><div>${escapeHtml(st.body)}</div>${st.caution ? `<div class="voice-caution">⚠ ${escapeHtml(st.caution)}</div>` : ''}</li>`).join('')}</ol>
      ${m.tips.length ? `<p><strong>コツ・勘所</strong></p><ul>${m.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}`;
    previewEl.classList.remove('hidden');
    actionsEl.innerHTML = '';
    actionsEl.appendChild(
      makeButton('◎ 球体に入れる', '', async (e) => {
        e.target.disabled = true;
        try {
          const n = await importManualToSphere(manual);
          statusEl.textContent = `技術伝承の球体に 工程「${manual.process || manual.title}」と ${n} 個の点を入れました。「技術伝承」タブで回して確認できます。`;
          previewEl.classList.add('hidden');
          actionsEl.innerHTML = '';
          actionsEl.appendChild(makeButton('閉じる', 'ghost-btn', closeModal));
        } catch (err) {
          statusEl.textContent = `追加に失敗しました：${err.message}`;
          e.target.disabled = false;
        }
      })
    );
    actionsEl.appendChild(makeButton('やめる', 'ghost-btn', closeModal));
  };

  try {
    const { manual: m } = await load();
    showPreview(m);
  } catch (err) {
    if (fallback) {
      // AIが使えないときは、内容全体を1つの点として入れる
      showPreview(fallback, `AIで手順に分けられませんでした（${err.message}）。代わりに、内容全体を1つの点として入れます。`);
    } else {
      statusEl.textContent = `手順に分けられませんでした：${err.message}`;
    }
  }
}

/* ---------- ④ Chat ---------- */
function chatPartnerName() {
  if (currentUser.role === 'boss') {
    const m = members.find((mm) => mm.id === activePartnerId);
    return m ? m.name : '';
  }
  return bossInfo ? bossInfo.name : '';
}

function updateChatHeader() {
  const name = chatPartnerName();
  document.getElementById('chat-header-name').textContent = name || '相手';
  document.getElementById('chat-avatar').textContent = (name || '?').charAt(0);
}

function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function scrollChatToBottom() {
  const el = document.getElementById('chat-thread');
  el.scrollTop = el.scrollHeight;
}

function initChat() {
  if (currentUser.role === 'boss') {
    const wrap = document.getElementById('chat-partner-select-wrap');
    wrap.classList.remove('hidden');
    const select = document.getElementById('chat-partner-select');
    select.innerHTML = members.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
    select.addEventListener('change', () => {
      activePartnerId = select.value;
      updateChatHeader();
      loadThread();
    });
    activePartnerId = members[0] ? members[0].id : null;
  } else {
    activePartnerId = bossInfo ? bossInfo.id : null;
  }

  updateChatHeader();
  if (activePartnerId) loadThread();

  document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!activePartnerId || !input.value.trim()) return;
    await api(`/api/chat/thread/${activePartnerId}`, { method: 'POST', body: JSON.stringify({ text: input.value }) });
    input.value = '';
    loadThread();
  });

  document.getElementById('chat-back-btn').addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="schedule"]').click();
  });

  const threadEl = document.getElementById('chat-thread');
  const jumpBtn = document.getElementById('chat-jump-latest');
  threadEl.addEventListener('scroll', () => {
    const distanceFromBottom = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight;
    jumpBtn.classList.toggle('hidden', distanceFromBottom < 60);
  });
  jumpBtn.addEventListener('click', scrollChatToBottom);
}

async function loadThread() {
  if (!activePartnerId) return;
  const { thread } = await api(`/api/chat/thread/${activePartnerId}`);
  const el = document.getElementById('chat-thread');
  el.innerHTML = '<div class="chat-date-divider"><span>今日</span></div>';
  if (!thread.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-msg';
    empty.style.textAlign = 'center';
    empty.textContent = 'まだメッセージはありません。';
    el.appendChild(empty);
  } else {
    thread.forEach((m) => {
      const mine = m.fromUserId === currentUser.id;
      const senderName = mine ? currentUser.name : chatPartnerName();
      const row = document.createElement('div');
      row.className = `chat-row ${mine ? 'mine' : 'theirs'}`;
      row.innerHTML = `
        <div class="chat-row-avatar">${escapeHtml((senderName || '?').charAt(0))}</div>
        <div class="chat-bubble-col">
          <div class="chat-bubble ${mine ? 'mine' : 'theirs'}">${escapeHtml(m.text)}</div>
          <div class="chat-row-meta">${mine ? '既読 ' : ''}${hhmm(m.timestamp)}</div>
        </div>
      `;
      el.appendChild(row);
    });
  }
  scrollChatToBottom();
}

/* ---------- 音くらべ検品 (self-contained page, AIタブ内のモードとして初回表示時に読み込む) ---------- */
function initKenpin() {
  document.querySelector('.ai-mode-btn[data-mode="kenpin"]').addEventListener('click', () => {
    const frame = document.getElementById('kenpin-frame');
    if (!frame.src) frame.src = frame.dataset.src;
  });
}

/* ---------- 球体を回す (技術伝承の暗黙知アプリ, loaded on first open) ---------- */
function initSphere() {
  document.querySelector('.tab-btn[data-tab="sphere"]').addEventListener('click', () => {
    const frame = document.getElementById('sphere-frame');
    if (!frame.src) frame.src = frame.dataset.src;
  });
}

/* ---------- AI hub: chat (all users) + summary (boss only), chosen after entering ---------- */
function initAiHub() {
  if (currentUser.role === 'boss') {
    document.querySelector('.ai-mode-btn[data-mode="summary"]').classList.remove('hidden');
  }
  document.querySelectorAll('.ai-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ai-mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.ai-mode-panel').forEach((p) => p.classList.add('hidden'));
      document.getElementById(`ai-mode-${btn.dataset.mode}`).classList.remove('hidden');
    });
  });
}

/* ---------- 音声からマニュアル作成 → 技術伝承（球体）へ ---------- */
let voiceManual = null;
let voiceRecognition = null;
let voiceTimerId = null;

function initAiVoiceManual() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recBtn = document.getElementById('voice-rec-btn');
  const transcriptEl = document.getElementById('voice-transcript');
  const timerEl = document.getElementById('voice-timer');
  const supportEl = document.getElementById('voice-support');

  if (!SR) {
    supportEl.textContent = 'このブラウザは音声の文字起こしに対応していません（Chrome / Safari をお使いください）。文字起こし済みのテキストを貼り付けてもマニュアルを作成できます。';
    recBtn.disabled = true;
  }
  if (currentUser.role === 'boss') {
    document.getElementById('voice-to-manual-btn').classList.remove('hidden');
  }

  recBtn.addEventListener('click', () => {
    if (voiceRecognition) { voiceRecognition.stop(); return; }
    voiceRecognition = new SR();
    voiceRecognition.lang = 'ja-JP';
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    const base = transcriptEl.value ? transcriptEl.value.replace(/\s+$/, '') + '\n' : '';
    let finals = '';
    voiceRecognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript + '。';
        else interim += r[0].transcript;
      }
      transcriptEl.value = base + finals + interim;
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    };
    voiceRecognition.onerror = (e) => {
      supportEl.textContent = e.error === 'not-allowed' ? 'マイクの使用が許可されていません。' : `文字起こしエラー：${e.error}`;
    };
    voiceRecognition.onend = () => {
      voiceRecognition = null;
      recBtn.textContent = '🎙 録音開始';
      recBtn.classList.remove('recording');
      clearInterval(voiceTimerId);
      timerEl.textContent = '';
    };
    voiceRecognition.start();
    supportEl.textContent = '';
    recBtn.textContent = '■ 録音停止';
    recBtn.classList.add('recording');
    const start = Date.now();
    voiceTimerId = setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000);
      timerEl.textContent = `● ${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }, 500);
  });

  document.getElementById('voice-text-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    transcriptEl.value = (transcriptEl.value ? transcriptEl.value + '\n' : '') + (await file.text());
    e.target.value = '';
  });

  document.getElementById('voice-manual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const transcript = transcriptEl.value.trim();
    const statusEl = document.getElementById('voice-status');
    if (!transcript) { statusEl.textContent = '先に録音するか、文字起こしを貼り付けてください。'; return; }
    if (voiceRecognition) voiceRecognition.stop();
    statusEl.textContent = 'マニュアルを作成中です…（Claude APIを呼び出しています）';
    document.getElementById('voice-result-wrap').classList.add('hidden');
    try {
      const { manual } = await api('/api/ai/manual-from-voice', {
        method: 'POST',
        body: JSON.stringify({ transcript, hint: document.getElementById('voice-hint').value.trim() })
      });
      voiceManual = manual;
      statusEl.textContent = '';
      renderVoiceManual(manual);
      document.getElementById('voice-action-status').textContent = '';
      document.getElementById('voice-result-wrap').classList.remove('hidden');
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  document.getElementById('voice-copy-btn').addEventListener('click', () => {
    if (voiceManual) navigator.clipboard.writeText(voiceManualToMarkdown(voiceManual));
  });

  document.getElementById('voice-to-manual-btn').addEventListener('click', async () => {
    if (!voiceManual) return;
    const statusEl = document.getElementById('voice-action-status');
    try {
      await api('/api/manual', {
        method: 'POST',
        body: JSON.stringify({ category: '技術要点', title: voiceManual.title, description: voiceManualToPlainText(voiceManual) })
      });
      statusEl.textContent = `「${voiceManual.title}」をマニュアル（技術要点）に登録しました。`;
      loadManualList();
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  document.getElementById('voice-to-sphere-btn').addEventListener('click', async () => {
    if (!voiceManual) return;
    const statusEl = document.getElementById('voice-action-status');
    const btn = document.getElementById('voice-to-sphere-btn');
    btn.disabled = true;
    try {
      const count = await importManualToSphere(voiceManual);
      statusEl.textContent = `技術伝承の球体に 工程「${voiceManual.process || voiceManual.title}」と ${count} 個の点（コツ）を入れました。「技術伝承」タブで回して確認できます。`;
    } catch (err) {
      statusEl.textContent = `技術伝承への追加に失敗しました：${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

function renderVoiceManual(m) {
  const el = document.getElementById('voice-result');
  const steps = m.steps.map((st, i) => `
    <li>
      <strong>${escapeHtml(st.title)}</strong> <span class="voice-step-tag">${escapeHtml(st.tag)}</span>
      <div>${escapeHtml(st.body)}</div>
      ${st.caution ? `<div class="voice-caution">⚠ ${escapeHtml(st.caution)}</div>` : ''}
    </li>`).join('');
  el.innerHTML = `
    <h1>${escapeHtml(m.title)}</h1>
    ${m.process ? `<p><strong>工程：</strong>${escapeHtml(m.process)}</p>` : ''}
    ${m.summary ? `<p>${escapeHtml(m.summary)}</p>` : ''}
    <h2>手順</h2>
    <ol>${steps}</ol>
    ${m.tips.length ? `<h2>コツ・勘所</h2><ul>${m.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
    ${m.questions.length ? `<h2>ベテランに確認したいこと</h2><ul>${m.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}</ul>` : ''}`;
}

function voiceManualToMarkdown(m) {
  const lines = [`# ${m.title}`, ''];
  if (m.process) lines.push(`**工程：** ${m.process}`, '');
  if (m.summary) lines.push(m.summary, '');
  lines.push('## 手順', '');
  m.steps.forEach((st, i) => {
    lines.push(`${i + 1}. **${st.title}**（${st.tag}）`, `   ${st.body}`);
    if (st.caution) lines.push(`   ⚠ ${st.caution}`);
  });
  if (m.tips.length) lines.push('', '## コツ・勘所', '', ...m.tips.map((t) => `- ${t}`));
  if (m.questions.length) lines.push('', '## ベテランに確認したいこと', '', ...m.questions.map((q) => `- ${q}`));
  return lines.join('\n');
}

function voiceManualToPlainText(m) {
  const lines = [];
  if (m.process) lines.push(`【工程】${m.process}`);
  if (m.summary) lines.push(m.summary, '');
  lines.push('【手順】');
  m.steps.forEach((st, i) => {
    lines.push(`${i + 1}. ${st.title}（${st.tag}）`, `　${st.body}`);
    if (st.caution) lines.push(`　⚠ ${st.caution}`);
  });
  if (m.tips.length) lines.push('', '【コツ・勘所】', ...m.tips.map((t) => `・${t}`));
  if (m.questions.length) lines.push('', '【ベテランに確認したいこと】', ...m.questions.map((q) => `・${q}`));
  return lines.join('\n');
}

/* 技術伝承タブ（public/sphere/）と同じ IndexedDB「sphere-app」に書き込む（同一オリジンなので共有される） */
function openSphereDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sphere-app', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      ['points', 'circles', 'links', 'media'].forEach((name) => {
        if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function sphereGetAll(db, store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function spherePutMany(db, store, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    items.forEach((it) => tx.objectStore(store).put(it));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const sphereUid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const SPHERE_CIRCLE_COLORS = ['#2d3a4f', '#c44a2f', '#3b7a57', '#7a5c3b', '#5b4b8a', '#2a7b9b', '#9b6a2a'];

async function importManualToSphere(m) {
  const db = await openSphereDB();
  const circles = await sphereGetAll(db, 'circles');
  const points = await sphereGetAll(db, 'points');
  const processName = (m.process || m.title).slice(0, 20);
  let circle = circles.find((c) => c.name === processName);
  if (!circle) {
    circle = { id: sphereUid(), name: processName, color: SPHERE_CIRCLE_COLORS[circles.length % SPHERE_CIRCLE_COLORS.length], order: circles.length };
    await spherePutMany(db, 'circles', [circle]);
  }
  let order = points.filter((p) => p.circleId === circle.id).reduce((mx, p) => Math.max(mx, p.order ?? 0), -1) + 1;
  const now = Date.now();
  const speaker = currentUser.role === 'boss' ? 'veteran' : 'young';
  const newPoints = m.steps.map((st) => ({
    id: sphereUid(),
    title: st.title,
    body: st.body + (st.caution ? `\n⚠ ${st.caution}` : ''),
    tag: st.tag,
    state: 'seen',
    perspective: '音声マニュアル',
    circleId: circle.id,
    order: order++,
    speaker,
    source: `音声マニュアル：${m.title}`,
    createdAt: now,
    updatedAt: now,
    mediaId: null,
    mediaType: '',
    audioId: null
  }));
  m.tips.forEach((tip) => {
    newPoints.push({
      id: sphereUid(), title: tip.slice(0, 40), body: tip, tag: '目線', state: 'told', perspective: '音声マニュアル',
      circleId: circle.id, order: order++, speaker, source: `音声マニュアル：${m.title}`, createdAt: now, updatedAt: now,
      mediaId: null, mediaType: '', audioId: null
    });
  });
  await spherePutMany(db, 'points', newPoints);
  db.close();
  if (!localStorage.getItem('sphere.tech')) localStorage.setItem('sphere.tech', m.title);
  const frame = document.getElementById('sphere-frame');
  if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: 'sphere:refresh' }, location.origin);
  return newPoints.length;
}

/* ---------- ⑤ AI summary (boss only) ---------- */
function initAiSummary() {
  if (currentUser.role !== 'boss') return;

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

  document.getElementById('ai-to-sphere-btn').addEventListener('click', () => {
    const raw = document.getElementById('ai-result').dataset.raw || '';
    if (raw.trim()) openSummaryToSphereModal(raw);
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

/* ---------- AI chat (Claude, all users) ---------- */
let aiChatHistory = [];
let aiChatModel = null;

function initAiChat() {
  renderAiChatThread(false);
  loadAiChatModels();
  document.getElementById('ai-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('ai-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    aiChatHistory.push({ role: 'user', content: text });
    renderAiChatThread(true);
    try {
      const { reply } = await api('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: aiChatHistory, model: aiChatModel })
      });
      aiChatHistory.push({ role: 'assistant', content: reply });
    } catch (err) {
      aiChatHistory.push({ role: 'assistant', content: `⚠️ ${err.message}` });
    }
    renderAiChatThread(false);
  });
}

async function loadAiChatModels() {
  try {
    const { models, default: defaultModel } = await api('/api/ai/chat-models');
    const select = document.getElementById('ai-chat-model');
    const groupLabels = { anthropic: 'Claude', ollama: 'ローカルOllama' };
    const groups = {};
    models.forEach((m) => {
      const key = m.provider || 'anthropic';
      groups[key] = groups[key] || [];
      groups[key].push(m);
    });
    select.innerHTML = Object.entries(groups)
      .map(([key, list]) => {
        const options = list.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
        return `<optgroup label="${escapeHtml(groupLabels[key] || key)}">${options}</optgroup>`;
      })
      .join('');
    aiChatModel = defaultModel;
    select.value = defaultModel;
    select.addEventListener('change', () => {
      aiChatModel = select.value;
    });
  } catch (err) {
    /* モデル一覧取得に失敗してもサーバー側デフォルトで動作する */
  }
}

function renderAiChatThread(pending) {
  const el = document.getElementById('ai-chat-thread');
  if (!aiChatHistory.length && !pending) {
    el.innerHTML = '<p class="empty-msg">まだメッセージはありません。何でも聞いてみましょう。</p>';
    return;
  }
  const bubbles = aiChatHistory.map((m) => {
    if (m.role === 'user') {
      return `<div class="ai-chat-bubble user">${escapeHtml(m.content)}</div>`;
    }
    const html = window.marked ? window.marked.parse(m.content) : escapeHtml(m.content);
    return `<div class="ai-chat-bubble assistant">${html}</div>`;
  });
  if (pending) bubbles.push('<div class="ai-chat-bubble assistant pending">考え中…</div>');
  el.innerHTML = bubbles.join('');
  el.scrollTop = el.scrollHeight;
}

/* ---------- Utils ---------- */
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Announcement (dashboard banner + boss editor) ---------- */
function renderAnnouncementBanner(announcement) {
  const banner = document.getElementById('announcement-banner');
  if (announcement && announcement.text) {
    banner.classList.remove('hidden');
    banner.innerHTML = `📢 ${escapeHtml(announcement.text)}<span class="meta">${escapeHtml(announcement.updatedBy)} - ${timeLabel(announcement.updatedAt)}</span>`;
  } else {
    banner.classList.add('hidden');
    banner.innerHTML = '';
  }
}

function initAnnouncementAdmin(currentAnnouncement) {
  if (currentUser.role !== 'boss') return;
  document.getElementById('announcement-admin').classList.remove('hidden');
  document.getElementById('announcement-edit-btn').addEventListener('click', () => {
    openModal(
      '全体のお知らせを編集',
      (body) => {
        body.innerHTML = `<label>お知らせ内容（空にすると非表示になります）<textarea id="announcement-edit-input" rows="4"></textarea></label>`;
        document.getElementById('announcement-edit-input').value = currentAnnouncement ? currentAnnouncement.text : '';
      },
      (actions) => {
        actions.appendChild(
          makeButton('保存', '', async () => {
            const text = document.getElementById('announcement-edit-input').value;
            const { announcement } = await api('/api/announcement', { method: 'POST', body: JSON.stringify({ text }) });
            currentAnnouncement = announcement;
            renderAnnouncementBanner(announcement);
            closeModal();
          })
        );
      }
    );
  });
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

  renderAnnouncementBanner(data.announcement);

  document.getElementById('user-badge').textContent = `${currentUser.name}（${currentUser.roleName || (currentUser.role === 'boss' ? '上司' : '部下')}）`;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  initTabs();
  initModal();
  initAnnouncementAdmin(data.announcement);
  initAsk();
  initSchedule();
  initManual();
  initChat();
  initKenpin();
  initSphere();
  initAiHub();
  initAiChat();
  initAiSummary();
  initAiVoiceManual();
}

init();
