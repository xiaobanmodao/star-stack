import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DB_PATH = path.join(DATA_DIR, 'starstack.sqlite')

const BASE_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    title TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    statement TEXT NOT NULL,
    input_desc TEXT NOT NULL DEFAULT '',
    output_desc TEXT NOT NULL DEFAULT '',
    data_range TEXT NOT NULL DEFAULT '',
    samples TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    problem_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    language TEXT NOT NULL,
    code TEXT NOT NULL,
    status TEXT NOT NULL,
    time_ms INTEGER,
    memory_kb INTEGER,
    message TEXT,
    results_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (problem_id) REFERENCES problems (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS testcases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    problem_id INTEGER NOT NULL,
    input TEXT NOT NULL,
    output TEXT NOT NULL,
    is_sample INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (problem_id) REFERENCES problems (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY,
    total_submissions INTEGER DEFAULT 0,
    accepted_count INTEGER DEFAULT 0,
    tried_problems INTEGER DEFAULT 0,
    solved_problems INTEGER DEFAULT 0,
    acceptance_rate REAL DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    max_streak INTEGER DEFAULT 0,
    last_submission_date TEXT,
    rank INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    activity_date TEXT NOT NULL,
    submission_count INTEGER DEFAULT 0,
    accepted_count INTEGER DEFAULT 0,
    UNIQUE(user_id, activity_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    achievement_type TEXT NOT NULL,
    achievement_data TEXT,
    unlocked_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS solved_problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    problem_id INTEGER NOT NULL,
    difficulty TEXT,
    first_solved_at TEXT NOT NULL,
    UNIQUE(user_id, problem_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS problem_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    problem_id INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    completed_at TEXT,
    UNIQUE(user_id, problem_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS discussion_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    problem_id INTEGER,
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS discussion_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    parent_id INTEGER,
    like_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (post_id) REFERENCES discussion_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES discussion_comments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS discussion_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, target_type, target_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS discussion_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES discussion_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS leaderboard_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    period_type TEXT NOT NULL,
    period_key TEXT NOT NULL,
    rank INTEGER NOT NULL,
    value REAL NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(user_id, period_type, period_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_id TEXT NOT NULL,
    user2_id TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user1_id, user2_id),
    FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message_deletions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    UNIQUE(message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions (problem_id)',
  'CREATE INDEX IF NOT EXISTS idx_testcases_problem ON testcases (problem_id)',
  'CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date ON daily_activity (user_id, activity_date)',
  'CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_solved_problems_user ON solved_problems (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_solved_problems_problem ON solved_problems (problem_id)',
  'CREATE INDEX IF NOT EXISTS idx_solved_problems_time_user_problem ON solved_problems (first_solved_at, user_id, problem_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_stats_rank ON user_stats (rank)',
  'CREATE INDEX IF NOT EXISTS idx_problem_plan_user ON problem_plan (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_posts_user ON discussion_posts(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_posts_problem ON discussion_posts(problem_id)',
  'CREATE INDEX IF NOT EXISTS idx_posts_created ON discussion_posts(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_comments_post ON discussion_comments(post_id)',
  'CREATE INDEX IF NOT EXISTS idx_comments_parent ON discussion_comments(parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_likes_target ON discussion_likes(target_type, target_id)',
  'CREATE INDEX IF NOT EXISTS idx_likes_user ON discussion_likes(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_discussion_views_post ON discussion_views(post_id)',
  'CREATE INDEX IF NOT EXISTS idx_leaderboard_history_period ON leaderboard_history(period_type, period_key)',
  'CREATE INDEX IF NOT EXISTS idx_leaderboard_history_period_user ON leaderboard_history(period_type, period_key, user_id)',
  'CREATE INDEX IF NOT EXISTS idx_leaderboard_history_user ON leaderboard_history(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_user1 ON conversations(user1_id)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_user2 ON conversations(user2_id)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at)',
  'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender_read ON messages(conversation_id, sender_id, is_read)',
  'CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_message_deletions_message ON message_deletions(message_id)',
  'CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON message_deletions(user_id)',
]

const COLUMN_PATCHES = [
  { table: 'users', column: 'is_banned', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'users', column: 'avatar', ddl: 'TEXT' },
  { table: 'users', column: 'rating', ddl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'submissions', column: 'results_json', ddl: 'TEXT' },
  { table: 'submissions', column: 'score', ddl: 'INTEGER DEFAULT 0' },
  { table: 'testcases', column: 'is_sample', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'problems', column: 'creator_id', ddl: 'TEXT' },
  { table: 'problems', column: 'data_range', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'problems', column: 'status', ddl: "TEXT NOT NULL DEFAULT 'published'" },
]

async function ensureColumns(db) {
  for (const patch of COLUMN_PATCHES) {
    const columns = await db.all(`PRAGMA table_info(${patch.table})`)
    const hasColumn = columns.some((column) => column.name === patch.column)
    if (hasColumn) continue
    await db.exec(`ALTER TABLE ${patch.table} ADD COLUMN ${patch.column} ${patch.ddl}`)
    console.log(`+ added column ${patch.table}.${patch.column}`)
  }
}

async function ensureIndexes(db) {
  for (const sql of INDEXES) {
    await db.exec(sql)
  }
  console.log(`+ ensured ${INDEXES.length} indexes`)
}

async function backfillTestcasesFromSamples(db) {
  const rows = await db.all(`SELECT id, samples FROM problems`)
  let inserted = 0
  for (const row of rows) {
    let samples = []
    try {
      samples = JSON.parse(row.samples || '[]')
    } catch {
      samples = []
    }
    if (!Array.isArray(samples)) continue
    const existingCount = await db.get(
      `SELECT COUNT(*) AS count FROM testcases WHERE problem_id = ?`,
      row.id
    )
    if ((existingCount?.count ?? 0) > 0) continue
    for (const sample of samples) {
      if (!sample || sample.input === undefined || sample.output === undefined) continue
      await db.run(
        `INSERT INTO testcases (problem_id, input, output, is_sample, created_at)
         VALUES (?, ?, ?, 1, ?)`,
        row.id,
        String(sample.input),
        String(sample.output),
        new Date().toISOString()
      )
      inserted += 1
    }
  }
  if (inserted > 0) {
    console.log(`+ backfilled ${inserted} testcase rows from samples`)
  }
}

async function ensureUserStatsRows(db) {
  const users = await db.all(`SELECT id FROM users`)
  let inserted = 0
  for (const user of users) {
    const existing = await db.get(`SELECT user_id FROM user_stats WHERE user_id = ?`, user.id)
    if (existing) continue
    await db.run(`INSERT INTO user_stats (user_id) VALUES (?)`, user.id)
    inserted += 1
  }
  if (inserted > 0) {
    console.log(`+ initialized ${inserted} user_stats rows`)
  }
}

async function migrate() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  console.log(`Database path: ${DB_PATH}`)
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database })

  await db.exec(BASE_SCHEMA_SQL)
  console.log('+ ensured base tables')

  await ensureColumns(db)
  await ensureIndexes(db)
  await backfillTestcasesFromSamples(db)
  await ensureUserStatsRows(db)

  const finalTables = await db.all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  )
  console.log(`Done. Current tables (${finalTables.length}):`)
  for (const table of finalTables) {
    console.log(`- ${table.name}`)
  }

  await db.close()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
