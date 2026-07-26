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
    select.innerHTML = models.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
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

  document.getElementById('user-badge').textContent = `${currentUser.name}（${currentUser.role === 'boss' ? '上司' : '部下'}）`;
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
  initAiChat();
  initAiSummary();
}

init();
