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
| Fonts | Bricolage Grotesque (display), Instrument Sans (text), Spline Sans Mono (data), bundled via Fontsource |
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

- **Updating (added after the first build).** No background or self-installing updater: macOS
  cannot install unsigned updates, and Tally must make no automatic network requests. Instead,
  *Check for updates* in Settings queries the GitHub Releases API only when clicked (an opt-in
  setting repeats it at startup) and opens the right download. Opening data with a new version
  runs a pre-upgrade check: a verified copy is saved to `backups/` before any migration, and is
  restored if the migration fails. The network filter admits only that one API URL, and only
  while a check is running.
- **Schema 2.** Adds per-response `visit_count`, `answer_changes` and `first_answer_seconds`, and
  moves modules to a six-colour palette validated for colour-blind separation in both themes.
- **Time metrics and dashboard formats.** Results, quiz and module pages break time down by
  question, topic and attempt. The dashboard offers score trends as every attempt, weekly
  averages or a spread; a twelve-week activity calendar; time by module as bars or shares; and
  time against accuracy by topic as a chart or table. Charts animate in briefly and respect
  `prefers-reduced-motion`.
- **Monospace font.** JetBrains Mono replaced by Spline Sans Mono, which reads as part of the
  type system rather than a code editor.

- **AI quiz generation and written answers (1.1.0).** OpenRouter is the only AI provider: one
  key covers Claude, GPT, Gemini and free models. The key is stored with Electron `safeStorage`
  (OS keychain), or, on Linux without a keyring, in a file readable only by the user, never in the
  data folder; it never reaches the renderer. AI requests go only from the main process, and the
  network filter admits `openrouter.ai/api/v1/` only while one is in flight. Study files are read
  locally (unpdf/PDF.js, mammoth, JSZip). Generated quizzes are converted to CSV and pass the same
  validator as imports, with one automatic repair round; anything still invalid is dropped.
  Written questions add `model_answer` and a points-based `mark_scheme` (schema 3 rebuilds the
  questions table with foreign keys off, then checks them). AI marking is point by point at
  temperature 0, with fixed rules, two worked examples, quoted evidence, and clamping to the scheme;
  self-marking uses the same scheme, and any mark can be adjusted.
- **Onboarding** gains a second step: connect a key, or follow the Claude / ChatGPT / Gemini
  guides with copyable prompts. **Upload quiz** becomes **New quiz** (generate or import).

- **Study materials (1.2.0).** Each module keeps a library of study files. Extracted text is
  stored in `userdata.sqlite` (schema 4: `materials`, `quiz_version_materials`, and
  `quiz_versions.generation_json`); the original file is copied to `Tally Data/materials/<module>/`
  as a readable mirror, renamed with the module and removed with the material. Generation takes
  any mix of saved materials and one-off files, records which it used, and supports *New version*
  and *Add questions* (existing questions are passed as an avoid-list and merged into the next
  version). Exact duplicate files are refused per module.

## Status

All nine milestones are implemented. Unit tests and the packaged-app end-to-end suite run
locally on Linux and in CI on every operating system before a release is published.
