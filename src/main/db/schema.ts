import type Database from 'better-sqlite3'

/** "TALY" – written to PRAGMA application_id so a Tally database can be recognised. */
export const APPLICATION_ID = 0x54414c59

/**
 * Migrations, applied in order. Index 0 migrates user_version 0 → 1, and so on.
 * Never edit a migration that has shipped; append a new one.
 */
export const MIGRATIONS: ((db: Database.Database) => void)[] = [
  (db) => {
    db.exec(`
      CREATE TABLE modules (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT,
        colour TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE quizzes (
        id INTEGER PRIMARY KEY,
        module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE INDEX quizzes_module ON quizzes(module_id);

      CREATE TABLE quiz_versions (
        id INTEGER PRIMARY KEY,
        quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        version_no INTEGER NOT NULL,
        content_sha256 TEXT NOT NULL,
        source_filename TEXT,
        csv_text TEXT NOT NULL,
        question_count INTEGER NOT NULL,
        total_marks REAL NOT NULL,
        imported_at TEXT NOT NULL,
        UNIQUE (quiz_id, version_no)
      );
      CREATE INDEX quiz_versions_hash ON quiz_versions(content_sha256);

      CREATE TABLE questions (
        id INTEGER PRIMARY KEY,
        quiz_version_id INTEGER NOT NULL REFERENCES quiz_versions(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('single', 'multi')),
        marks REAL NOT NULL CHECK (marks > 0),
        explanation TEXT,
        topic TEXT,
        UNIQUE (quiz_version_id, position)
      );

      CREATE TABLE options (
        id INTEGER PRIMARY KEY,
        question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        label TEXT NOT NULL CHECK (label IN ('A', 'B', 'C', 'D', 'E')),
        text TEXT NOT NULL,
        is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
        UNIQUE (question_id, label)
      );

      CREATE TABLE attempts (
        id INTEGER PRIMARY KEY,
        quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        quiz_version_id INTEGER NOT NULL REFERENCES quiz_versions(id) ON DELETE CASCADE,
        attempt_number INTEGER,
        status TEXT NOT NULL CHECK (status IN ('in_progress', 'submitted', 'abandoned')),
        is_practice INTEGER NOT NULL DEFAULT 0 CHECK (is_practice IN (0, 1)),
        marking_mode TEXT NOT NULL CHECK (marking_mode IN ('strict', 'partial')),
        feedback_mode TEXT NOT NULL CHECK (feedback_mode IN ('end', 'each')),
        settings_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        submitted_at TEXT,
        duration_seconds REAL NOT NULL DEFAULT 0,
        marks_awarded REAL,
        marks_available REAL NOT NULL,
        percentage REAL,
        current_position INTEGER NOT NULL DEFAULT 0,
        parent_attempt_id INTEGER REFERENCES attempts(id) ON DELETE SET NULL,
        CHECK (attempt_number IS NULL OR (is_practice = 0 AND status = 'submitted'))
      );
      CREATE UNIQUE INDEX attempts_official_number ON attempts(quiz_id, attempt_number)
        WHERE attempt_number IS NOT NULL;
      CREATE INDEX attempts_quiz ON attempts(quiz_id, status);

      CREATE TABLE responses (
        id INTEGER PRIMARY KEY,
        attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        display_position INTEGER NOT NULL,
        option_order_json TEXT NOT NULL,
        selected_option_ids_json TEXT NOT NULL DEFAULT '[]',
        is_correct INTEGER,
        marks_awarded REAL,
        time_spent_seconds REAL NOT NULL DEFAULT 0,
        flagged INTEGER NOT NULL DEFAULT 0,
        revealed_at TEXT,
        answered_at TEXT,
        UNIQUE (attempt_id, question_id),
        UNIQUE (attempt_id, display_position)
      );
      CREATE INDEX responses_question ON responses(question_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  },
  // 2: richer per-question timing, and the six-colour module palette.
  (db) => {
    db.exec(`
      ALTER TABLE responses ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE responses ADD COLUMN answer_changes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE responses ADD COLUMN first_answer_seconds REAL;
      CREATE INDEX attempts_started ON attempts(started_at);
      UPDATE modules SET colour = CASE colour
        WHEN 'plum' THEN 'violet'
        WHEN 'olive' THEN 'orange'
        WHEN 'slate' THEN 'cobalt'
        WHEN 'graphite' THEN 'violet'
        ELSE colour END;
    `)
  }
]

export const SCHEMA_VERSION = MIGRATIONS.length

export const REQUIRED_TABLES = [
  'modules',
  'quizzes',
  'quiz_versions',
  'questions',
  'options',
  'attempts',
  'responses',
  'settings'
]
