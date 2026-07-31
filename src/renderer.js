(() => {
  const MONTH_NAMES = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];

  // ---------- Shared state ----------
  let appData = { goalHours: 4, months: {}, timerState: { running: false } };
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth(); // 0-indexed
  let currentRange = 'daily';
  let timerInterval = null;
  let overwriteArmed = false;
  let overwriteTimeout = null;

  function pad(n) { return String(n).padStart(2, '0'); }
  function monthKey(year, month) { return `${year}-${pad(month + 1)}`; }
  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

  function getMonthDays(year, month) {
    const key = monthKey(year, month);
    if (!appData.months[key]) appData.months[key] = { days: {} };
    if (!appData.months[key].days) appData.months[key].days = {};
    return appData.months[key].days;
  }

  function getDayHours(year, month, day) {
    const days = getMonthDays(year, month);
    return days[day] ? (days[day].hours || 0) : 0;
  }

  async function saveData() {
    await window.studyAPI.writeData(appData);
  }

  // ---------- Nav ----------
  const navTabs = document.querySelectorAll('.nav-tab');
  const views = {
    study: document.getElementById('view-study'),
    tracker: document.getElementById('view-tracker'),
    journal: document.getElementById('view-journal'),
  };

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(views).forEach(v => v.classList.remove('active'));
      views[tab.dataset.view].classList.add('active');
      if (tab.dataset.view === 'tracker') renderTracker();
      if (tab.dataset.view === 'journal') renderJournalList();
    });
  });

  // ---------- Goal ----------
  const goalInput = document.getElementById('goalInput');
  const goalLockBtn = document.getElementById('goalLockBtn');

  goalInput.addEventListener('change', async () => {
    const v = parseFloat(goalInput.value);
    appData.goalHours = isNaN(v) || v < 0 ? 0 : v;
    await saveData();
    renderTracker();
  });

  goalLockBtn.addEventListener('click', async () => {
    const v = parseFloat(goalInput.value);
    const goalVal = isNaN(v) || v < 0 ? 0 : v;
    appData.goalHours = goalVal;

    const { y, m, d } = todayParts();
    const days = getMonthDays(y, m);
    if (!days[d]) days[d] = { hours: 0, journal: '' };
    days[d].goalHours = goalVal;
    days[d].goalLocked = true;

    await saveData();
    goalLockBtn.textContent = 'Locked';
    goalLockBtn.classList.add('locked');
    setTimeout(() => {
      goalLockBtn.textContent = 'Lock in';
      goalLockBtn.classList.remove('locked');
    }, 1400);
    renderTracker();
  });

  // ================== STUDY MODE ==================

  const timerDateLabel = document.getElementById('timerDateLabel');
  const timerDigits = document.getElementById('timerDigits');
  const timerTodayTotal = document.getElementById('timerTodayTotal');
  const recDot = document.getElementById('recDot');
  const timerToggleBtn = document.getElementById('timerToggleBtn');
  const timerBtnIcon = document.getElementById('timerBtnIcon');
  const timerBtnLabel = document.getElementById('timerBtnLabel');

  const journalDateLabel = document.getElementById('journalDateLabel');
  const journalText = document.getElementById('journalText');
  const journalStatus = document.getElementById('journalStatus');
  const journalSaveBtn = document.getElementById('journalSaveBtn');
  const journalOverwriteBtn = document.getElementById('journalOverwriteBtn');

  const pauseOverlay = document.getElementById('pauseOverlay');
  const pauseCounter = document.getElementById('pauseCounter');
  const pausePromptEarly = document.getElementById('pausePromptEarly');
  const pausePromptLate = document.getElementById('pausePromptLate');
  const resumeEarlyBtn = document.getElementById('resumeEarlyBtn');
  const addPausedBtn = document.getElementById('addPausedBtn');
  const discardPausedBtn = document.getElementById('discardPausedBtn');

  const TEN_MIN_MS = 10 * 60 * 1000;
  let pauseInterval = null;

  function todayParts() {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  }

  function formatTodayLabel() {
    const now = new Date();
    return `${MONTH_NAMES[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  }

  function formatHMS(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function updateTodayTotalLabel() {
    const { y, m, d } = todayParts();
    const hours = getDayHours(y, m, d);
    timerTodayTotal.textContent = `${hours.toFixed(2)}h logged today`;
  }

  function stopTickInterval() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function tickDisplay(startedAt) {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    timerDigits.textContent = formatHMS(elapsedSec);
  }

  function stopPauseInterval() {
    if (pauseInterval) { clearInterval(pauseInterval); pauseInterval = null; }
  }

  function hidePauseModal() {
    stopPauseInterval();
    pauseOverlay.classList.add('hidden');
  }

  function tickPauseCounter(pausedAt) {
    const gapSec = Math.max(0, (Date.now() - pausedAt) / 1000);
    const m = Math.floor(gapSec / 60);
    const s = Math.floor(gapSec % 60);
    pauseCounter.textContent = `${pad(m)}:${pad(s)}`;

    if (gapSec * 1000 >= TEN_MIN_MS) {
      pausePromptEarly.classList.add('hidden');
      pausePromptLate.classList.remove('hidden');
    } else {
      pausePromptEarly.classList.remove('hidden');
      pausePromptLate.classList.add('hidden');
    }
  }

  function showPauseModal(pausedAt) {
    pauseOverlay.classList.remove('hidden');
    stopPauseInterval();
    tickPauseCounter(pausedAt);
    pauseInterval = setInterval(() => tickPauseCounter(pausedAt), 1000);
  }

  async function handleResume(mode) {
    await window.studyAPI.timerResume(mode);
    hidePauseModal();
    appData = await window.studyAPI.readData();
    updateTodayTotalLabel();
    await refreshTimerUI();
  }

  resumeEarlyBtn.addEventListener('click', () => handleResume('seamless'));
  addPausedBtn.addEventListener('click', () => handleResume('addPaused'));
  discardPausedBtn.addEventListener('click', () => handleResume('discard'));

  async function refreshTimerUI() {
    const ts = await window.studyAPI.timerStatus();
    stopTickInterval();

    if (ts && ts.running && ts.paused && ts.pausedAt) {
      // Timer is paused: freeze the display at the pause point and show the modal.
      recDot.classList.remove('running');
      timerToggleBtn.classList.add('running');
      timerBtnIcon.innerHTML = '&#9724;';
      timerBtnLabel.textContent = 'Stop';
      tickDisplay(ts.startedAt < ts.pausedAt ? ts.startedAt : ts.pausedAt);
      timerDigits.textContent = formatHMS((ts.pausedAt - ts.startedAt) / 1000);
      showPauseModal(ts.pausedAt);
    } else if (ts && ts.running && ts.startedAt) {
      hidePauseModal();
      recDot.classList.add('running');
      timerToggleBtn.classList.add('running');
      timerBtnIcon.innerHTML = '&#9724;';
      timerBtnLabel.textContent = 'Stop';
      tickDisplay(ts.startedAt);
      timerInterval = setInterval(() => tickDisplay(ts.startedAt), 1000);
    } else {
      hidePauseModal();
      recDot.classList.remove('running');
      timerToggleBtn.classList.remove('running');
      timerBtnIcon.innerHTML = '&#9654;';
      timerBtnLabel.textContent = 'Start';
      timerDigits.textContent = '00:00:00';
    }
  }

  timerToggleBtn.addEventListener('click', async () => {
    const ts = await window.studyAPI.timerStatus();
    if (ts && ts.running) {
      await window.studyAPI.timerStop();
      appData = await window.studyAPI.readData();
      updateTodayTotalLabel();
    } else {
      await window.studyAPI.timerStart();
    }
    await refreshTimerUI();
  });

  // ---------- Journal ----------

  function loadJournalForToday() {
    const { y, m, d } = todayParts();
    const days = getMonthDays(y, m);
    const entry = days[d];
    journalText.value = entry ? (entry.journal || '') : '';
    resetOverwriteState();
  }

  function resetOverwriteState() {
    overwriteArmed = false;
    journalOverwriteBtn.classList.add('hidden');
    journalOverwriteBtn.textContent = 'Hold to overwrite existing entry';
    if (overwriteTimeout) { clearTimeout(overwriteTimeout); overwriteTimeout = null; }
  }

  function showJournalSaved() {
    journalStatus.textContent = 'saved';
    journalStatus.classList.add('show');
    setTimeout(() => journalStatus.classList.remove('show'), 1400);
  }

  async function doSaveJournal() {
    const { y, m, d } = todayParts();
    const days = getMonthDays(y, m);
    if (!days[d]) days[d] = { hours: 0, journal: '' };
    days[d].journal = journalText.value;
    await saveData();
    showJournalSaved();
    resetOverwriteState();
  }

  journalSaveBtn.addEventListener('click', async () => {
    const { y, m, d } = todayParts();
    const days = getMonthDays(y, m);
    const existing = days[d] && days[d].journal;
    if (existing && existing.trim().length > 0 && existing !== journalText.value) {
      // existing entry differs -> require overwrite confirm
      overwriteArmed = true;
      journalOverwriteBtn.classList.remove('hidden');
      journalStatus.textContent = 'entry exists — confirm below';
      journalStatus.classList.add('show');
      if (overwriteTimeout) clearTimeout(overwriteTimeout);
      overwriteTimeout = setTimeout(resetOverwriteState, 8000);
      return;
    }
    await doSaveJournal();
  });

  // Make overwrite deliberately "slightly hard to press": require a press-and-hold
  let holdTimer = null;
  journalOverwriteBtn.addEventListener('mousedown', () => {
    journalOverwriteBtn.textContent = 'Hold...';
    holdTimer = setTimeout(async () => {
      journalOverwriteBtn.textContent = 'Overwriting...';
      await doSaveJournal();
    }, 900);
  });
  ['mouseup', 'mouseleave'].forEach(evt => {
    journalOverwriteBtn.addEventListener(evt, () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (overwriteArmed) journalOverwriteBtn.textContent = 'Hold to overwrite existing entry';
    });
  });

  // ---------- Journal list (history view) ----------

  const journalListEl = document.getElementById('journalList');

  function renderJournalList() {
    const entries = [];
    for (const key of Object.keys(appData.months).sort().reverse()) {
      const [y, m] = key.split('-').map(Number);
      const days = appData.months[key].days || {};
      for (const dayKey of Object.keys(days).sort((a, b) => Number(b) - Number(a))) {
        const entry = days[dayKey];
        if (entry && entry.journal && entry.journal.trim().length > 0) {
          entries.push({ y, m: m - 1, d: Number(dayKey), hours: entry.hours || 0, journal: entry.journal });
        }
      }
    }

    if (entries.length === 0) {
      journalListEl.innerHTML = '<div class="journal-empty">No journal entries yet.</div>';
      return;
    }

    journalListEl.innerHTML = entries.map(e => {
      const label = `${MONTH_NAMES[e.m]} ${e.d}, ${e.y}`;
      const hoursLabel = `${e.hours.toFixed(2)}h`;
      const safeJournal = e.journal
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `
        <div class="journal-entry">
          <div class="journal-entry-head">
            <span class="journal-entry-date">${label}</span>
            <span class="journal-entry-meta">${hoursLabel}</span>
          </div>
          <div class="journal-entry-body">${safeJournal}</div>
        </div>
      `;
    }).join('');
  }

  // ================== TRACKER (ANALYTICS) ==================

  const monthLabelEl = document.getElementById('monthLabel');
  const chartEl = document.getElementById('chart');
  const dayInput = document.getElementById('dayInput');
  const hoursInput = document.getElementById('hoursInput');
  const logBtn = document.getElementById('logBtn');
  const savedNote = document.getElementById('savedNote');
  const prevMonthBtn = document.getElementById('prevMonth');
  const nextMonthBtn = document.getElementById('nextMonth');
  const filepathNote = document.getElementById('filepathNote');
  const rangeTabs = document.querySelectorAll('.range-tab');

  const statTotal = document.getElementById('statTotal');
  const statAvg = document.getElementById('statAvg');
  const statBest = document.getElementById('statBest');
  const statStreak = document.getElementById('statStreak');
  const statGoalDays = document.getElementById('statGoalDays');

  rangeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      rangeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentRange = tab.dataset.range;
      renderTracker();
    });
  });

  function renderTracker() {
    monthLabelEl.textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    if (currentRange === 'daily') drawDailyChart();
    else if (currentRange === 'weekly') drawWeeklyChart();
    else drawMonthlyChart();
    updateStats();
  }

  function drawDailyChart() {
    const days = getMonthDays(currentYear, currentMonth);
    const goal = Number(appData.goalHours) || 0;
    const nDays = daysInMonth(currentYear, currentMonth);

    const width = 1000, height = 340;
    const marginLeft = 44, marginRight = 16, marginTop = 16, marginBottom = 34;
    const plotW = width - marginLeft - marginRight;
    const plotH = height - marginTop - marginBottom;

    let maxHours = goal;
    for (let d = 1; d <= nDays; d++) {
      const v = days[d] ? days[d].hours : 0;
      if (v > maxHours) maxHours = v;
    }
    maxHours = Math.max(maxHours * 1.15, 4);
    const niceMax = Math.ceil(maxHours / 2) * 2;

    const yForHours = (h) => marginTop + plotH - (h / niceMax) * plotH;
    const barSlot = plotW / nDays;
    const barWidth = Math.min(barSlot * 0.6, 22);

    let svg = '';
    for (let h = 0; h <= niceMax; h += 2) {
      const y = yForHours(h);
      svg += `<line class="grid-line" x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}" />`;
      svg += `<text class="axis-label" x="${marginLeft - 8}" y="${y + 3}" text-anchor="end">${h}</text>`;
    }

    for (let d = 1; d <= nDays; d++) {
      const xCenter = marginLeft + barSlot * (d - 1) + barSlot / 2;
      const x = xCenter - barWidth / 2;
      const val = days[d] ? days[d].hours : 0;

      const goalY = yForHours(goal);
      if (goal > 0) {
        svg += `<line class="goal-tick" x1="${x - 3}" y1="${goalY}" x2="${x + barWidth + 3}" y2="${goalY}" />`;
      }

      if (val > 0) {
        const barY = yForHours(val);
        const barH = (marginTop + plotH) - barY;
        const cls = val >= goal && goal > 0 ? 'bar-met' : (goal > 0 ? 'bar-under' : 'bar-met');
        svg += `<rect class="bar ${cls}" x="${x}" y="${barY}" width="${barWidth}" height="${Math.max(barH, 1.5)}" rx="2"><title>Day ${d}: ${val.toFixed(2)}h</title></rect>`;
        svg += `<text class="bar-value-label" x="${xCenter}" y="${barY - 5}">${val.toFixed(1)}</text>`;
      } else {
        const baseY = marginTop + plotH;
        svg += `<circle class="bar-empty-dot" cx="${xCenter}" cy="${baseY - 2}" r="2"></circle>`;
      }

      const showLabel = nDays <= 15 || d % (nDays > 20 ? 2 : 1) === 0 || d === 1 || d === nDays;
      if (showLabel) {
        svg += `<text class="day-label" x="${xCenter}" y="${height - marginBottom + 16}" text-anchor="middle">${d}</text>`;
      }
    }
    svg += `<line class="grid-line" x1="${marginLeft}" y1="${marginTop + plotH}" x2="${width - marginRight}" y2="${marginTop + plotH}" />`;
    chartEl.innerHTML = svg;
  }

  function drawWeeklyChart() {
    const days = getMonthDays(currentYear, currentMonth);
    const goal = Number(appData.goalHours) || 0;
    const nDays = daysInMonth(currentYear, currentMonth);

    // Group into weeks of 7 days starting day 1
    const weeks = [];
    for (let start = 1; start <= nDays; start += 7) {
      const end = Math.min(start + 6, nDays);
      let total = 0;
      for (let d = start; d <= end; d++) total += days[d] ? days[d].hours : 0;
      weeks.push({ label: `${start}-${end}`, total });
    }

    const width = 1000, height = 340;
    const marginLeft = 50, marginRight = 16, marginTop = 16, marginBottom = 34;
    const plotW = width - marginLeft - marginRight;
    const plotH = height - marginTop - marginBottom;

    const weeklyGoal = goal * 7;
    let maxTotal = weeklyGoal;
    weeks.forEach(w => { if (w.total > maxTotal) maxTotal = w.total; });
    maxTotal = Math.max(maxTotal * 1.15, 8);
    const niceMax = Math.ceil(maxTotal / 4) * 4;

    const yForHours = (h) => marginTop + plotH - (h / niceMax) * plotH;
    const barSlot = plotW / weeks.length;
    const barWidth = Math.min(barSlot * 0.5, 80);

    let svg = '';
    for (let h = 0; h <= niceMax; h += 4) {
      const y = yForHours(h);
      svg += `<line class="grid-line" x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}" />`;
      svg += `<text class="axis-label" x="${marginLeft - 8}" y="${y + 3}" text-anchor="end">${h}</text>`;
    }

    if (weeklyGoal > 0) {
      const goalY = yForHours(weeklyGoal);
      svg += `<line class="goal-tick" x1="${marginLeft}" y1="${goalY}" x2="${width - marginRight}" y2="${goalY}" />`;
    }

    weeks.forEach((w, i) => {
      const xCenter = marginLeft + barSlot * i + barSlot / 2;
      const x = xCenter - barWidth / 2;
      if (w.total > 0) {
        const barY = yForHours(w.total);
        const barH = (marginTop + plotH) - barY;
        const cls = w.total >= weeklyGoal && weeklyGoal > 0 ? 'bar-met' : (weeklyGoal > 0 ? 'bar-under' : 'bar-met');
        svg += `<rect class="bar ${cls}" x="${x}" y="${barY}" width="${barWidth}" height="${Math.max(barH, 1.5)}" rx="3"><title>Week ${w.label}: ${w.total.toFixed(2)}h</title></rect>`;
        svg += `<text class="bar-value-label" x="${xCenter}" y="${barY - 6}">${w.total.toFixed(1)}</text>`;
      }
      svg += `<text class="day-label" x="${xCenter}" y="${height - marginBottom + 16}" text-anchor="middle">${w.label}</text>`;
    });
    svg += `<line class="grid-line" x1="${marginLeft}" y1="${marginTop + plotH}" x2="${width - marginRight}" y2="${marginTop + plotH}" />`;
    chartEl.innerHTML = svg;
  }

  function drawMonthlyChart() {
    // Show last 6 months ending at currentYear/currentMonth
    const months = [];
    for (let i = 5; i >= 0; i--) {
      let m = currentMonth - i;
      let y = currentYear;
      while (m < 0) { m += 12; y -= 1; }
      const days = getMonthDays(y, m);
      const nDays = daysInMonth(y, m);
      let total = 0;
      for (let d = 1; d <= nDays; d++) total += days[d] ? days[d].hours : 0;
      months.push({ label: `${MONTH_NAMES[m].slice(0, 3)} ${String(y).slice(2)}`, total });
    }

    const goal = Number(appData.goalHours) || 0;
    const width = 1000, height = 340;
    const marginLeft = 50, marginRight = 16, marginTop = 16, marginBottom = 34;
    const plotW = width - marginLeft - marginRight;
    const plotH = height - marginTop - marginBottom;

    let maxTotal = 0;
    months.forEach(m => { if (m.total > maxTotal) maxTotal = m.total; });
    maxTotal = Math.max(maxTotal * 1.15, 20);
    const niceMax = Math.ceil(maxTotal / 10) * 10;

    const yForHours = (h) => marginTop + plotH - (h / niceMax) * plotH;
    const barSlot = plotW / months.length;
    const barWidth = Math.min(barSlot * 0.45, 90);

    let svg = '';
    for (let h = 0; h <= niceMax; h += 10) {
      const y = yForHours(h);
      svg += `<line class="grid-line" x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}" />`;
      svg += `<text class="axis-label" x="${marginLeft - 8}" y="${y + 3}" text-anchor="end">${h}</text>`;
    }

    months.forEach((m, i) => {
      const xCenter = marginLeft + barSlot * i + barSlot / 2;
      const x = xCenter - barWidth / 2;
      if (m.total > 0) {
        const barY = yForHours(m.total);
        const barH = (marginTop + plotH) - barY;
        svg += `<rect class="bar bar-met" x="${x}" y="${barY}" width="${barWidth}" height="${Math.max(barH, 1.5)}" rx="3"><title>${m.label}: ${m.total.toFixed(2)}h</title></rect>`;
        svg += `<text class="bar-value-label" x="${xCenter}" y="${barY - 6}">${m.total.toFixed(1)}</text>`;
      }
      svg += `<text class="day-label" x="${xCenter}" y="${height - marginBottom + 16}" text-anchor="middle">${m.label}</text>`;
    });
    svg += `<line class="grid-line" x1="${marginLeft}" y1="${marginTop + plotH}" x2="${width - marginRight}" y2="${marginTop + plotH}" />`;
    chartEl.innerHTML = svg;
  }

  function updateStats() {
    const days = getMonthDays(currentYear, currentMonth);
    const goal = Number(appData.goalHours) || 0;
    const nDays = daysInMonth(currentYear, currentMonth);

    let total = 0, loggedCount = 0, best = { day: null, hours: 0 }, goalDays = 0;

    for (let d = 1; d <= nDays; d++) {
      const v = days[d] ? days[d].hours : 0;
      if (v > 0) {
        total += v;
        loggedCount++;
        if (v > best.hours) best = { day: d, hours: v };
        if (goal > 0 && v >= goal) goalDays++;
      }
    }

    let streak = 0;
    if (goal > 0) {
      const today = new Date();
      const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;
      let startDay = isCurrentMonth ? today.getDate() : nDays;
      for (let d = startDay; d >= 1; d--) {
        const v = days[d] ? days[d].hours : 0;
        if (v >= goal) streak++; else break;
      }
    }

    statTotal.textContent = total.toFixed(total % 1 === 0 ? 0 : 2);
    statAvg.textContent = loggedCount > 0 ? (total / loggedCount).toFixed(1) : '0';
    statBest.textContent = best.day ? `Day ${best.day} · ${best.hours.toFixed(2)}h` : '—';
    statStreak.textContent = streak;
    statGoalDays.textContent = `${goalDays}/${nDays}`;
  }

  // ---------- Manual entry ----------

  logBtn.addEventListener('click', async () => {
    const day = parseInt(dayInput.value, 10);
    const hours = parseFloat(hoursInput.value);
    const nDays = daysInMonth(currentYear, currentMonth);

    if (!day || day < 1 || day > nDays) { dayInput.focus(); return; }
    if (isNaN(hours) || hours < 0) { hoursInput.focus(); return; }

    const days = getMonthDays(currentYear, currentMonth);
    if (!days[day]) days[day] = { hours: 0, journal: '' };
    days[day].hours = Math.round(hours * 100) / 100;
    await saveData();
    renderTracker();

    savedNote.textContent = 'Saved';
    savedNote.classList.add('show');
    setTimeout(() => savedNote.classList.remove('show'), 1200);

    hoursInput.value = '';
    hoursInput.focus();

    // reflect on study mode timer sub if same day
    const { y, m, d } = todayParts();
    if (y === currentYear && m === currentMonth && d === day) updateTodayTotalLabel();
  });

  hoursInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') logBtn.click(); });
  dayInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') hoursInput.focus(); });

  prevMonthBtn.addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderTracker();
  });

  nextMonthBtn.addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderTracker();
  });

  function prefillToday() {
    const today = new Date();
    if (today.getFullYear() === currentYear && today.getMonth() === currentMonth) {
      dayInput.value = today.getDate();
    }
  }

  // ================== INIT ==================

  async function loadData() {
    appData = await window.studyAPI.readData();
    if (typeof appData.goalHours !== 'number') appData.goalHours = 4;
    if (!appData.months) appData.months = {};
    goalInput.value = appData.goalHours;
    const path = await window.studyAPI.getFilePath();
    filepathNote.textContent = `Saved to ${path}`;
  }

  (async function init() {
    await loadData();
    timerDateLabel.textContent = formatTodayLabel();
    journalDateLabel.textContent = formatTodayLabel();
    prefillToday();
    updateTodayTotalLabel();
    loadJournalForToday();
    await refreshTimerUI();
    renderTracker();
  })();

  // Refresh timer status periodically in case timer was toggled from tray/background,
  // or paused by the 30-minute "still studying?" check in main.js.
  setInterval(async () => {
    const ts = await window.studyAPI.timerStatus();
    const displayedRunning = timerToggleBtn.classList.contains('running');
    const displayedPaused = !pauseOverlay.classList.contains('hidden');
    const actuallyPaused = !!(ts.running && ts.paused);
    if (!!ts.running !== displayedRunning || actuallyPaused !== displayedPaused) {
      appData = await window.studyAPI.readData();
      updateTodayTotalLabel();
      await refreshTimerUI();
    }
  }, 5000);
})();
