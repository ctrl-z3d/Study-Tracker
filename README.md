# Study Tracker

A quiet, minimal desktop app for tracking study hours. Start a timer, log a journal entry for the day, and watch your hours stack up on a daily/weekly/monthly chart.

Built with Electron. Fully vibe-coded with [Claude](https://claude.ai) — every feature, fix, and line in this repo came out of a conversation, not a spec doc.

## Features

- **Study timer** — start/stop a session timer that logs hours to today automatically
- **Pause detection** — if you go idle for 30 minutes, the app asks "still studying?" and lets you decide whether to count the gap
- **Daily journal** — jot notes for what you studied, with a soft confirm-to-overwrite if an entry already exists
- **Journal history** — browse past entries in one place
- **Tracker view** — daily / weekly / monthly bar charts with goal line, streaks, and stats (total hours, average, best day, goal days hit)
- **Daily goal lock-in** — set and lock a study-hour goal for the day
- **Local-only storage** — everything is saved to a JSON file on your machine, nothing leaves your computer

## Tech stack

- [Electron](https://www.electronjs.org/) (main + renderer process, `contextIsolation` on, no `nodeIntegration`)
- Vanilla JS/HTML/CSS — no frontend framework
- Data persisted as JSON under `~/StudyTracker/study-data.json`

## Getting started

```bash
npm install
npm start
```

## Building a Windows executable

```bash
npm run build
```

This uses `electron-builder` to produce a portable `.exe` in `dist/`.

> Note: the build config currently targets Windows only (`"win": { "target": "portable" }`). To build for macOS or Linux, add the corresponding `mac`/`linux` targets to the `build` field in `package.json` — Linux builds should generally be run on Linux, and macOS builds on macOS.

## Project structure

```
Tracker/
├── main.js          # Electron main process — window, tray, timer logic, file I/O
├── preload.js        # Safe IPC bridge exposed to the renderer as window.studyAPI
├── package.json
└── src/
    ├── index.html
    ├── style.css
    ├── renderer.js    # All UI logic — timer, journal, charts, tracker
    └── icon.ico
```

## Data storage

All data lives in a single JSON file:

```
%USERPROFILE%\StudyTracker\study-data.json   (Windows)
~/StudyTracker/study-data.json                (macOS/Linux)
```

Nothing is synced or sent anywhere — it's just a local file the app reads and writes to.

## License

No license specified yet — add one if you plan to share or open source this.
