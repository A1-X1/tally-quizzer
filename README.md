# Tally

**[Download the latest release →](https://github.com/A1-X1/tally-quizzer/releases/latest)**

| Your computer | Download this file |
|---|---|
| Windows 10 or 11 (64-bit) | `Tally-Setup-<version>.exe` |
| Mac with Apple silicon (M1, M2, M3, M4 or later) | `Tally-<version>-arm64.dmg` |
| Mac with an Intel processor | `Tally-<version>-x64.dmg` |
| Linux (64-bit) | `Tally-<version>-x86_64.AppImage` |

Not sure which Mac you have? Open the Apple menu, choose **About This Mac**, and look at **Chip** (Apple silicon) or **Processor** (Intel).

---

Tally is a desktop app for revising with multiple-choice quizzes. You sort quizzes into modules, take them as often as you like, and see how your scores move over time: per module, per quiz, per topic and per question.

Everything stays on your computer in a single file you choose. There is no account, no sign-in and no internet connection. Tally makes no network requests.

- Modules for each subject, with a colour, an optional course code and a description.
- **New quiz → Generate with AI:** describe a topic, add your PDFs, Word documents or slides, and choose multiple choice, written answers or a mix. Your material is the source of truth. Uses your own OpenRouter key; free models work.
- **New quiz → Import a file:** CSV files from a spreadsheet or from the AI chat you already use (Claude, ChatGPT, Gemini), with every question checked before anything is saved.
- One-answer questions (radio buttons), select-all-that-apply questions (tick boxes) and written questions you answer in your own words.
- Written answers marked point by point against a mark scheme, by the AI (quoting the words that earned each mark) or by you. You can change any mark.
- Maths written in LaTeX between `$…$` and code in `backticks`.
- Shuffling, time limits, feedback after each question or at the end, and strict or partial marking.
- Every answer, mark and second recorded for every attempt. Close the app mid-quiz and pick up where you left off.
- Results with per-topic breakdowns, time spent on every question and topic, a full review, retries and practice runs on the questions you got wrong.
- Time and accuracy by question, topic and attempt for each quiz, so you can see where your time goes.
- A dashboard with score trends (per attempt, weekly or as a spread), a twelve-week activity calendar, time by module, and time against accuracy by topic; module pages; and a filterable, exportable history.
- Light and dark themes.

## Installing

### Windows

1. Download `Tally-Setup-<version>.exe` and open it.
2. **The first time**, Windows SmartScreen may say *"Windows protected your PC"*. Tally is not signed with a paid code-signing certificate, so Windows doesn't recognise the publisher. Click **More info**, check that the app is `Tally-Setup-<version>.exe`, then click **Run anyway**.
3. The installer asks whether to install for you only, and **where to install Tally**. Choose a folder or keep the suggested one.
4. Tally adds a Start menu entry and a desktop shortcut.

To uninstall, use **Settings → Apps → Installed apps → Tally → Uninstall**. Uninstalling never deletes your data folder.

### macOS

1. Download the `.dmg` for your Mac (see the table above) and open it.
2. Drag **Tally** onto the **Applications** folder (or any other folder you prefer).
3. Open Tally from Applications. **The first time**, macOS will say *"Apple could not verify ‘Tally’ is free of malware"* (or *"Tally can’t be opened because Apple cannot check it for malicious software"*). Tally is signed ad hoc but not notarised, because notarisation needs a paid Apple developer account. Click **Done** (not **Move to Bin**).
4. Open **System Settings → Privacy & Security**. Scroll down to **Security**, where you'll see *"Tally was blocked to protect your Mac"*. Click **Open Anyway**, then confirm with **Open Anyway** again and enter your password or use Touch ID.
5. Tally opens. From now on it opens normally.

If macOS instead says the app *"is damaged and can’t be opened"*, the download was quarantined in a way the button above doesn't clear. Open **Terminal** and run the following, then open Tally again:

```bash
xattr -dr com.apple.quarantine /Applications/Tally.app
```

### Linux

1. Download `Tally-<version>-x86_64.AppImage`.
2. Make it executable: right-click → **Properties → Permissions → Allow executing file as program**, or in a terminal:

```bash
chmod +x Tally-*-x86_64.AppImage
```

3. Double-click it to run. AppImages need FUSE 2. If it doesn't start on Ubuntu 22.04 or later, install it:

```bash
sudo apt install libfuse2t64
```

(On Ubuntu 22.04 the package is called `libfuse2`.) To add Tally to your app launcher, use a tool such as AppImageLauncher or Gear Lever.

## First launch: choosing where your data lives

The first time Tally opens, it asks where to keep your data. The suggestion is `Documents/Tally Data`; **Choose another folder…** lets you pick anywhere else, such as a synced folder. Tally creates:

```text
Tally Data/
├── userdata.sqlite   ← everything: modules, quizzes (including the original CSV text), attempts, settings
├── quizzes/          ← readable copies of your quiz CSVs, by module (a convenience; safe to delete)
└── backups/          ← automatic backups, the latest ten
```

If the folder you choose already contains Tally data, for example a folder you copied or synced from another computer, Tally recognises it and offers **Use this existing data**. It never overwrites existing data.

If the data folder isn't available when Tally starts (an unplugged drive, or a sync that hasn't finished), Tally shows a recovery screen with **Retry**, **Locate folder** and **Choose new location**. It never quietly starts again with an empty database.

Only the path to your data folder is stored outside it, in a small `config.json` in Tally's settings folder. Nothing you create is stored in the installation folder.

## Quiz CSV format

One question per row. The header row must contain these columns, in any order:

```text
question,option_a,option_b,option_c,option_d,option_e,type,correct
```

These columns are optional: `marks`, `explanation`, `topic`, and, for written questions, `model_answer` and `mark_scheme`.

| Column | What goes in it |
|---|---|
| `question` | The question. Maths between `$…$` (inline) or `$$…$$` (display); code between backticks. |
| `option_a` … `option_e` | Exactly five options, all filled in and all different. |
| `type` | `single` (one correct answer), `multi` (one or more correct answers) or `written` (a typed answer; leave the options and `correct` empty). |
| `correct` | The correct letters, separated by semicolons: `C`, or `A;C;E`. Case doesn't matter. A `single` question has exactly one; a `multi` question has between one and five. |
| `marks` | A positive number. Empty means 1. |
| `explanation` | Shown when the answer is revealed. |
| `topic` | A short subtopic name, used for per-topic statistics. |
| `model_answer` | Written questions only: a full-mark answer, shown after marking. |
| `mark_scheme` | Written questions only: each creditworthy point as `[marks] description`, separated by semicolons, e.g. `[2] Names the mitochondrion; [1] Mentions ATP`. Add `(accept: …)` or `(do not accept: …)` inside a point. `marks` must equal the total, or be left empty. |

Wrap any value containing a comma, a double quote or a line break in double quotes, and write a double quote inside such a value as `""`. Tally reads UTF-8 with or without a BOM, and Windows or Unix line endings.

```csv
question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic
"Which connective is false only when the antecedent is true and the consequent is false?",Conjunction,Disjunction,Implication,Biconditional,Exclusive or,single,C,1,"An implication P → Q fails only when P is true and Q is false.",Propositional logic
"Which of these are tautologies?",$P \lor \neg P$,$P \land \neg P$,$P \to P$,$P \to Q$,$\neg(P \land \neg P)$,multi,A;C;E,2,"A, C and E are true under every assignment; B is a contradiction and D is contingent.",Propositional logic
```

This is [`samples/template.csv`](samples/template.csv). [`samples/example_quiz.csv`](samples/example_quiz.csv) is a complete 12-question sample. Both can also be saved from **Help** inside the app, along with a ready-made prompt for asking an AI assistant to write quizzes from your notes.

When you upload a file, Tally checks all of it first. If anything is wrong, it lists every problem with its row number (the header is row 1, as in a spreadsheet), the column, and how to fix it, and saves nothing. Uploading the exact same file to the same module twice is detected. Uploading a changed file with the same title lets you **Save as new version** (past attempts keep the questions they were taken on) or **Create separate quiz**.

Files are limited to 2 MB and 500 questions. Everything in a CSV is treated as text: HTML is shown literally and never runs.

## Creating quizzes with AI

The first time you open Tally (after choosing a data folder) it offers two ways to make quizzes faster. You can change either later in **Settings → AI** and **Help**.

**In Tally, with an OpenRouter key.** [OpenRouter](https://openrouter.ai) gives one key for many models (Claude, GPT, Gemini and others), including free ones.

1. Create an account at openrouter.ai.
2. Open **Settings → Keys**, choose **Create key**, name it "Tally" and copy it. It starts with `sk-or-` and is only shown once.
3. Paste it into Tally. Tally checks it, picks a free model that works for your account, and stores the key on this computer only: encrypted by the system keychain where one is available (on Linux without a keyring, in a file only your user account can read). It is never put in your data folder.

Free models (names ending in `:free`) cost nothing but allow a limited number of requests a day and can be slow or busy. If OpenRouter's privacy or guardrail settings on your account block a model, Tally says so; choose another model in Settings, where each choice is tested.

Then choose **New quiz → Generate with AI**: describe the topic, optionally add study files (PDF, .docx, .pptx, .txt, .md), choose **Multiple choice**, **Mixed** or **Written only**, the difficulty and how many questions. When you add files, the AI is told to treat them as the only source of truth and to cite where each question comes from. Tally validates the result with the same rules as an imported CSV, asks the model to fix any rows that break them, leaves out any that still do, and shows you a preview before anything is saved.

When AI features are used, the topic, the text of your files and your written answers are sent to OpenRouter and the model's provider. Nothing else leaves your computer, and Tally makes no other network requests.

**In the AI chat you already use.** Help → *Create quizzes with AI* has step-by-step guides for Claude, ChatGPT and Gemini (including reusable Projects and Gems) and two prompts to copy: multiple choice, and with written answers. Save the reply as a `.csv` file and choose **New quiz → Import a file**.

## Written answers

Written questions have a model answer and a mark scheme of independent points, each worth a number of marks. When you submit, they are marked in one of two ways:

- **By the AI** (if you have a key and leave *Mark written answers with AI* on). It marks each point separately, quotes the words in your answer that earn it, and follows fixed rules shown with worked examples: equivalent wording counts, spelling doesn't unless it changes a technical term, a correct point contradicted by a wrong one earns nothing, vague or off-scheme content earns nothing, and instructions inside an answer are ignored. It runs at temperature 0 so the same answer gets the same mark.
- **By you**, against the same scheme, point by point.

Either way, you can change any mark afterwards and the score updates.

## Updating

Tally never updates itself in the background, and it makes no network requests on its own.

- **Settings → About → Check for updates** asks GitHub for the latest release, only when you click it. If there is a newer version, Tally shows what changed and offers the right download for your computer. You can also turn on **Check for updates when Tally starts** (off by default).
- To update, install the new version over the old one: run the new installer on Windows, drag the new Tally into Applications on a Mac and choose **Replace**, or replace the AppImage on Linux.
- Your data folder is never touched by installing. The first time a new version opens your data, Tally runs a **pre-upgrade check**: it saves a verified copy of `userdata.sqlite` to `backups/` (named `…-pre-upgrade.sqlite`), then updates the database for the new version if needed. If that update fails, Tally puts the copy back and leaves your data exactly as it was.
- A database written by a newer version of Tally is never opened by an older one; Tally asks you to update instead.

## Backups

- Tally backs up `userdata.sqlite` into `backups/` every time it starts, before opening it with a new version, and before deleting a module or quiz, restoring, or moving your data. The latest ten are kept. Every copy is checked with SQLite's `PRAGMA integrity_check`.
- **Settings → Data → Export my data** saves a complete, consistent copy of your data wherever you choose. Keep one somewhere other than your data folder.
- **Settings → Data → Restore from file** replaces your data with an exported or backed-up file. Tally checks the file first and backs up your current data before replacing anything.
- **Settings → Data → Move data folder** copies your data to a new folder, verifies the copy, switches to it, and only then removes the old one.

Installing a new version of Tally, or uninstalling it, never touches your data folder.

## Using Tally on more than one computer

Your whole history is in one file, so you can:

- **Move to a new computer:** copy the `Tally Data` folder across (or export your data and restore it on the new computer). Install Tally, and on the first screen choose that folder. Tally offers **Use this existing data**.
- **Keep it in a synced folder** (Dropbox, OneDrive, iCloud Drive, Google Drive). Put `Tally Data` inside the synced folder, or move it there with **Move data folder**, and choose the same folder on your other computer.

> **Only run Tally on one computer at a time** against the same synced folder. Close Tally on one computer and let syncing finish before you open it on another. Two copies of Tally writing to the same file at once can lose work or create sync conflicts.

Tally uses SQLite's rollback journal rather than write-ahead logging, so the database stays a single file and is safe to sync while Tally is closed.

## Building from source

You need Node.js 22 or later and Git. Building the installers for an operating system must be done on that operating system.

```bash
git clone https://github.com/A1-X1/tally-quizzer.git
```

```bash
cd tally-quizzer
```

```bash
npm ci
```

`npm ci` also runs `electron-builder install-app-deps`, which prepares the native SQLite module for the exact Electron version (better-sqlite3 ships Node-API binaries for each platform and architecture).

```bash
npm run dev
```

```bash
npm run dist
```

`npm run dev` starts Tally with live reloading. `npm run dist` builds the installer for the current operating system into `release/`.

### Tests

```bash
npm test
```

```bash
npm run dist:dir
```

```bash
npm run test:e2e
```

`npm test` runs the unit and database tests with Vitest. They run inside Electron's own Node runtime, so the SQLite module is tested under the same ABI the app uses. `npm run test:e2e` drives the **packaged** app (built by `npm run dist:dir`) with Playwright: first run, recovery, importing, taking quizzes, resuming, export, restore, moving data and security settings. On Linux without a display, prefix it with `xvfb-run -a`. Set `TALLY_SCREENSHOTS=1` to also capture design-review screenshots into `screenshots/`.

### How it's built

- Electron, TypeScript and electron-vite; React with hand-written CSS; SQLite through better-sqlite3 in the main process only.
- The window runs with `contextIsolation`, `sandbox` and no `nodeIntegration`. The renderer can only call a fixed list of typed functions, and the main process validates every request. A strict Content Security Policy applies, navigation and new windows are blocked, and every outbound network request is refused. Files are opened and saved only through the system's own dialogs.
- Fonts (Bricolage Grotesque, Instrument Sans, Spline Sans Mono) and KaTeX are bundled; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Releases are built by [GitHub Actions](.github/workflows/release.yml) on Windows, macOS (Apple silicon and Intel) and Linux runners, each natively. Every build is checked for the right native binary architecture, macOS builds pass `codesign --verify --deep --strict`, and the end-to-end tests run against each packaged app before anything is published.

See [docs/PLAN.md](docs/PLAN.md) for the build plan and design decisions.
