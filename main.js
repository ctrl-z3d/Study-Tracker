const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'StudyTracker');
const DATA_FILE = path.join(DATA_DIR, 'study-data.json');

let win = null;
let tray = null;
let isQuitting = false;
let notifyTimeout = null;   // fires at 30-min mark
let autoStopTimeout = null; // fires at 10-min-after-pause mark

const THIRTY_MIN_MS = 30 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;

function pad(n) { return String(n).padStart(2, '0'); }
function monthKey(y, m) { return `${y}-${pad(m + 1)}`; } // m is 0-indexed

function defaultTimerState() {
  return {
    running: false,
    startedAt: null,
    year: null, month: null, day: null,
    // pause sub-state: when the 30-min mark fires, running stays true conceptually
    // but we track a pause window separately.
    paused: false,
    pausedAt: null,
  };
}

function defaultData() {
  return { goalHours: 4, months: {}, timerState: defaultTimerState() };
}

// Migrate old flat format: months[key][day] = number -> months[key].days[day] = {hours, journal}
// Also backfills per-day goal/lock fields and new timerState pause fields.
function migrate(data) {
  if (!data.months) data.months = {};
  for (const key of Object.keys(data.months)) {
    const m = data.months[key];
    if (!m.days) {
      const days = {};
      for (const dayKey of Object.keys(m)) {
        const v = m[dayKey];
        if (typeof v === 'number') {
          days[dayKey] = { hours: v, journal: '' };
        }
      }
      data.months[key] = { days };
    } else {
      for (const dayKey of Object.keys(m.days)) {
        const entry = m.days[dayKey];
        if (typeof entry === 'number') {
          m.days[dayKey] = { hours: entry, journal: '' };
        } else if (entry && typeof entry.journal !== 'string') {
          entry.journal = '';
        }
      }
    }
  }
  if (typeof data.goalHours !== 'number') data.goalHours = 4;
  if (!data.timerState) data.timerState = defaultTimerState();
  if (typeof data.timerState.paused !== 'boolean') data.timerState.paused = false;
  if (typeof data.timerState.pausedAt === 'undefined') data.timerState.pausedAt = null;
  return data;
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2), 'utf-8');
  }
}

function readData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return migrate(JSON.parse(raw));
  } catch (e) {
    return defaultData();
  }
}

function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getDayEntry(data, y, m, d) {
  const key = monthKey(y, m);
  if (!data.months[key]) data.months[key] = { days: {} };
  if (!data.months[key].days) data.months[key].days = {};
  if (!data.months[key].days[d]) data.months[key].days[d] = { hours: 0, journal: '', goalHours: null, goalLocked: false };
  const entry = data.months[key].days[d];
  if (typeof entry.goalHours === 'undefined') entry.goalHours = null;
  if (typeof entry.goalLocked === 'undefined') entry.goalLocked = false;
  return entry;
}

function clearNotifyTimer() {
  if (notifyTimeout) {
    clearTimeout(notifyTimeout);
    notifyTimeout = null;
  }
}

function clearAutoStopTimer() {
  if (autoStopTimeout) {
    clearTimeout(autoStopTimeout);
    autoStopTimeout = null;
  }
}

function fireNotification(title, body) {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body });
    n.on('click', () => {
      if (win) { win.show(); win.focus(); }
    });
    n.show();
  }
}

// Arms the 30-minute "still running" check. When it fires, we mark the
// timer as paused (pausedAt = now) and pop the app to the front.
function armNotifyTimer() {
  clearNotifyTimer();
  notifyTimeout = setTimeout(() => {
    const data = readData();
    const ts = data.timerState;
    if (ts && ts.running && !ts.paused) {
      ts.paused = true;
      ts.pausedAt = Date.now();
      writeData(data);
      fireNotification('Study Tracker', 'Still studying? Confirm to keep the timer going.');
      if (win) { win.show(); win.focus(); }
      armAutoStopTimer();
    }
  }, THIRTY_MIN_MS);
}

// If the user doesn't respond within 10 minutes of the pause prompt,
// we don't auto-add the paused time — we just leave it paused and let
// the renderer show the "add this time?" prompt indefinitely until acted on.
// (No forced action needed here; renderer polls pausedAt via timer:status.)
function armAutoStopTimer() {
  clearAutoStopTimer();
  autoStopTimeout = setTimeout(() => {
    // Nothing to auto-do; this just exists so main.js could hook additional
    // behavior at the 10-min mark if ever needed. The renderer independently
    // computes elapsed-since-pause from pausedAt and decides which prompt to show.
  }, TEN_MIN_MS);
}

// ---------- Timer IPC ----------

ipcMain.handle('timer:start', () => {
  const data = readData();
  const now = new Date();
  data.timerState = {
    running: true,
    startedAt: now.getTime(),
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
    paused: false,
    pausedAt: null,
  };
  writeData(data);
  armNotifyTimer();
  return data.timerState;
});

// Full stop: commits elapsed running time (excluding any active pause window)
// to today's log and clears the timer entirely.
ipcMain.handle('timer:stop', () => {
  const data = readData();
  const ts = data.timerState;
  if (ts && ts.running && ts.startedAt) {
    const endPoint = ts.paused && ts.pausedAt ? ts.pausedAt : Date.now();
    const elapsedHours = Math.max(0, endPoint - ts.startedAt) / 1000 / 60 / 60;
    const entry = getDayEntry(data, ts.year, ts.month, ts.day);
    entry.hours = Math.round((entry.hours + elapsedHours) * 1000) / 1000;
  }
  data.timerState = defaultTimerState();
  writeData(data);
  clearNotifyTimer();
  clearAutoStopTimer();
  return data;
});

ipcMain.handle('timer:status', () => {
  const data = readData();
  return data.timerState;
});

// Resume from a pause prompt.
// mode: 'seamless'   -> resume-within-10-min case: always add the paused gap
// mode: 'addPaused'  -> resume-after-10-min, user chose "yes, add it"
// mode: 'discard'    -> resume-after-10-min, user chose "no, don't add it"
ipcMain.handle('timer:resume', (event, mode) => {
  const data = readData();
  const ts = data.timerState;
  if (ts && ts.running && ts.paused && ts.pausedAt) {
    const pauseGapMs = Date.now() - ts.pausedAt;
    if (mode === 'seamless' || mode === 'addPaused') {
      // Add the pause gap to the timer by rolling startedAt back so the
      // elapsed-time math (Date.now() - startedAt) already includes it.
      ts.startedAt = ts.startedAt; // unchanged: pause gap is naturally included
    } else if (mode === 'discard') {
      // Don't count the paused time: push startedAt forward by the gap so
      // it's excluded from the elapsed calculation.
      ts.startedAt = ts.startedAt + pauseGapMs;
    }
    ts.paused = false;
    ts.pausedAt = null;
    writeData(data);
    clearAutoStopTimer();
    armNotifyTimer(); // re-arm for the next 30-minute window
  }
  return data.timerState;
});

// ---------- Data IPC ----------

ipcMain.handle('data:read', () => readData());

ipcMain.handle('data:write', (event, data) => {
  writeData(data);
  return true;
});

ipcMain.handle('data:filepath', () => DATA_FILE);

// ---------- Window / Tray ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 800,
    minHeight: 620,
    backgroundColor: '#0D0E12',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'src', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'src', 'icon.ico'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const menu = Menu.buildFromTemplate([
    { label: 'Open Study Tracker', click: () => { win.show(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Study Tracker');
  tray.setContextMenu(menu);
  tray.on('click', () => { win.show(); });
}

app.whenReady().then(() => {
  ensureDataFile();
  createWindow();
  createTray();

  const data = readData();
  if (data.timerState && data.timerState.running) {
    if (data.timerState.paused) {
      armAutoStopTimer();
    } else {
      armNotifyTimer();
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // keep running in tray; do not quit
  }
});
