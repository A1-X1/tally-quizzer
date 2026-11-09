# Tally — build plan

Tally is a local-first desktop quiz and revision tracker. This document records the
milestones, the decisions taken while building, and where the build departs from the
original brief.

## Stack (versions current at the time of writing)

| Concern | Choice |
|---|---|
| Shell | Electron 45 + TypeScript, bundled with electron-vite 6 (Vite 8) |
| UI | React 19, hand-written CSS with design tokens (no UI kit) |
| Database | SQLite via better-sqlite3 13, main process only |
| Maths | KaTeX (bundled, `trust: false`) |
| Charts | Hand-written SVG (no charting dependency) |
| Fonts | Bricolage Grotesque (display), Instrument Sans (text), JetBrains Mono (data), bundled via Fontsource |
| IPC validation | zod |
| Packaging | electron-builder 26 |
| Tests | Vitest (unit/integration, run under Electron's Node so the native ABI matches), Playwright `_electron` against the packaged app |

## Milestones

1. **Scaffold** – Electron + electron-vite + React; secure `BrowserWindow` (contextIsolation,
   sandbox, no nodeIntegration), CSP, navigation/new-window blocking, single-instance lock,
   window-state persistence, seamless title bar; typed preload bridge; database layer with
   `PRAGMA user_version` migrations.
2. **First run and recovery** – welcome screen with `Documents/Tally Data` default or a native
   folder picker; detection and validation of an existing database ("Use this existing data");
   recovery screen (Retry / Locate folder / Choose new location) that never creates an empty
   database.
3. **CSV import** – RFC 4180 parser (BOM, CRLF, quoted commas, multi-line fields), whole-file
   validation with row/column/fix messages, preview, duplicate-hash detection, versioning,
   single-transaction save, `quizzes/` mirror. Unit tests for every rule.
4. **Quiz engine** – setup screen, shuffles, feedback modes, time limit, strict/partial marking,
   autosave per answer, resume, active-time tracking, results and review, retry and
   practise-wrong-answers (practice excluded from official stats).
5. **Modules, history, analytics, dashboard** – module CRUD/archive/delete (typed confirmation +
   backup), module pages, history with filters/sorting/CSV export, dashboard headline, chart,
   resume card, module table, "Needs work", recent attempts, stat strip, empty states.
6. **Help and settings** – Help page with the AI prompt; Settings > Data (show, move, export,
   restore), appearance, About (version + releases link); startup backups (keep 10) verified
   with `PRAGMA integrity_check`.
7. **Design pass** – screenshots at 900×620 and 1600×1000 in light and dark with real sample
   data; remove anything that reads as templated.
8. **Packaging and CI** – electron-builder targets for Windows NSIS (assisted), macOS arm64 and
   x64 DMG (ad-hoc signed, hardened runtime + entitlements), Linux x64 AppImage; GitHub Actions
   matrix on native runners; architecture and `codesign` checks.
9. **Verify and publish** – Playwright suite against the packaged Linux build locally and in CI,
   then tag `v1.0.0` and confirm every release asset.

## Decisions and changes to the brief

- **Charts are hand-written SVG.** This avoids a dependency and lets charts use the app's
  type, colour and direct labels exactly.
- **Window state lives in `window-state.json`** next to `config.json` in Electron's `userData`.
  `config.json` holds only the data path, as specified; window geometry is not user data.
- **`quizzes/` mirror layout** is `quizzes/<module name>/<quiz title> v<n>.csv`. It is rewritten
  from the database when needed and is never read back.
- **Unit tests run under Electron's Node runtime** (`ELECTRON_RUN_AS_NODE=1`) so the single
  better-sqlite3 binary built for Electron's ABI is the one tested. No second build for system
  Node is needed.
- **Partial marking for single-answer questions** uses the same formula; with one correct option
  it reduces to strict marking.
- **"Practise wrong answers"** creates a practice attempt over the same quiz version restricted to
  the questions not awarded full marks. Practice attempts have no official attempt number
  (`attempt_number` is NULL) and are excluded from every statistic, but are listed in History
  with a "Practice" label.
- **Abandoned attempts.** Exiting a quiz offers "Save and exit" (stays `in_progress`, resumable)
  or "Discard attempt" (`abandoned`). Only one in-progress attempt per quiz is kept; starting a
  new one asks before abandoning the old.
- **Time limit** auto-submits when the active-time budget is used up.
- **File size limit** for CSV import is 2 MB and 500 questions.
- **E2E on other OSes.** The Playwright suite runs against the packaged app on Linux in this
  build environment. CI runs it on the packaged build for Linux, Windows and both macOS
  architectures; only Linux was exercised outside CI.
- **Release upload** uses electron-builder with `--publish never`, then a final job collects the
  four files and creates the GitHub Release, so no build can publish a partial release.
- **Sample CSVs live only in `samples/`.** They are bundled into the app at build time
  (Vite `?raw` imports), so `resources/` holds only icons and the macOS entitlements; there is
  no second copy to drift out of date.
- **Native module.** better-sqlite3 13 ships Node-API binaries for each platform and
  architecture, which are ABI-stable across Electron versions. `postinstall` still runs
  `electron-builder install-app-deps` against the exact Electron version, packaging skips a
  second rebuild, and an `afterPack` hook keeps only the binary for the target platform and
  architecture (outside the ASAR). CI checks the binary's architecture in every package.
- **System theme.** The main process forwards `nativeTheme` changes to the renderer through a
  single typed event, because `prefers-color-scheme` alone did not always update.
- **No licence file.** The repository owner has not chosen a licence for Tally's own code, so
  `package.json` says `UNLICENSED` and no `LICENSE` is added. Third-party licences are in
  `THIRD_PARTY_NOTICES.md`.

## Status

All nine milestones are implemented. Unit tests and the packaged-app end-to-end suite run
locally on Linux and in CI on every operating system before a release is published.
