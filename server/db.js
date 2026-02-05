import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import path from 'path'
import { fileURLToPath } from 'url'
import bcrypt from 'bcryptjs'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DB_PATH = path.join(DATA_DIR, 'starstack.sqlite')

const dbPromise = open({
  filename: DB_PATH,
  driver: sqlite3.Database,
})

export const initDb = async () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  const db = await dbPromise
  await db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions (user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions (problem_id);
    CREATE INDEX IF NOT EXISTS idx_testcases_problem ON testcases (problem_id);
  `)

  const columns = await db.all(`PRAGMA table_info(users)`)
  const columnNames = columns.map((col) => col.name)
  if (!columnNames.includes('is_banned')) {
    await db.exec(`ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0;`)
  }
  if (!columnNames.includes('avatar')) {
    await db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT;`)
  }
  if (!columnNames.includes('rating')) {
    await db.exec(`ALTER TABLE users ADD COLUMN rating REAL NOT NULL DEFAULT 0;`)
  }

  const testcaseColumns = await db.all(`PRAGMA table_info(testcases)`)
  const testcaseNames = testcaseColumns.map((col) => col.name)
  if (testcaseColumns.length > 0 && !testcaseNames.includes('is_sample')) {
    await db.exec(`ALTER TABLE testcases ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;`)
  }

  const submissionColumns = await db.all(`PRAGMA table_info(submissions)`)
  const submissionNames = submissionColumns.map((col) => col.name)
  if (submissionColumns.length > 0 && !submissionNames.includes('results_json')) {
    await db.exec(`ALTER TABLE submissions ADD COLUMN results_json TEXT;`)
  }

  // 添加 problems 表的新字段
  const problemColumns = await db.all(`PRAGMA table_info(problems)`)
  const problemNames = problemColumns.map((col) => col.name)
  if (problemColumns.length > 0) {
    if (!problemNames.includes('creator_id')) {
      await db.exec(`ALTER TABLE problems ADD COLUMN creator_id TEXT;`)
    }
    if (!problemNames.includes('data_range')) {
      await db.exec(`ALTER TABLE problems ADD COLUMN data_range TEXT NOT NULL DEFAULT '';`)
    }
    if (!problemNames.includes('status')) {
      await db.exec(`ALTER TABLE problems ADD COLUMN status TEXT NOT NULL DEFAULT 'published';`)
    }
  }

  const existingAdmin = await db.get(
    `SELECT id FROM users WHERE is_admin = 1 LIMIT 1`
  )
  if (!existingAdmin) {
    const adminId = process.env.ADMIN_ID || 'admin'
    const adminName = process.env.ADMIN_NAME || '管理员'
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
    const passwordHash = bcrypt.hashSync(adminPassword, 10)
    await db.run(
      `INSERT INTO users (id, name, password_hash, is_admin, is_banned, created_at)
       VALUES (?, ?, ?, 1, 0, ?)`,
      adminId,
      adminName,
      passwordHash,
      new Date().toISOString()
    )
  }

  const legacyProblem = await db.get(
    `SELECT id FROM problems WHERE slug IN ('sum-a-b', 'max-of-three', 'string-reverse') LIMIT 1`
  )
  const problemCount = await db.get(`SELECT COUNT(*) as count FROM problems`)
  if (legacyProblem || !problemCount || problemCount.count === 0) {
    await db.exec(`DELETE FROM submissions;`)
    await db.exec(`DELETE FROM testcases;`)
    await db.exec(`DELETE FROM problems;`)
    await db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('problems', 'testcases', 'submissions');`)

    const now = new Date().toISOString()
    const problems = [
      {
        id: 1001,
        slug: 'p1001-star-sum',
        title: '星尘求和',
        difficulty: '入门',
        tags: '数学,基础',
        statement: '给定两个整数 A 和 B，输出 A + B。',
        input_desc: '输入两个整数 A 和 B，以空格分隔。',
        output_desc: '输出 A + B 的结果。',
        samples: [{ input: '1 2', output: '3' }],
        testcases: [
          { input: '1 2', output: '3', is_sample: 1 },
          { input: '10 20', output: '30', is_sample: 0 },
          { input: '-5 7', output: '2', is_sample: 0 },
        ],
      },
      {
        id: 1002,
        slug: 'p1002-peak-energy',
        title: '能量峰值',
        difficulty: '普及-',
        tags: '数组,基础',
        statement: '给定 N 个整数，输出其中的最大值。',
        input_desc: '第一行输入整数 N。第二行输入 N 个整数。',
        output_desc: '输出最大值。',
        samples: [{ input: '5\n1 9 3 4 7', output: '9' }],
        testcases: [
          { input: '5\n1 9 3 4 7', output: '9', is_sample: 1 },
          { input: '3\n-5 -2 -8', output: '-2', is_sample: 0 },
          { input: '1\n42', output: '42', is_sample: 0 },
        ],
      },
      {
        id: 1003,
        slug: 'p1003-star-palindrome',
        title: '星码回文',
        difficulty: '普及',
        tags: '字符串,模拟',
        statement: '判断给定字符串是否为回文串。',
        input_desc: '输入一行字符串 s（不含空格）。',
        output_desc: '若 s 为回文串输出 Yes，否则输出 No。',
        samples: [{ input: 'level', output: 'Yes' }],
        testcases: [
          { input: 'level', output: 'Yes', is_sample: 1 },
          { input: 'star', output: 'No', is_sample: 0 },
          { input: 'abba', output: 'Yes', is_sample: 0 },
        ],
      },
    ]

    for (const problem of problems) {
      await db.run(
        `INSERT INTO problems (id, slug, title, difficulty, tags, statement, input_desc, output_desc, samples, creator_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        problem.id,
        problem.slug,
        problem.title,
        problem.difficulty,
        problem.tags,
        problem.statement,
        problem.input_desc,
        problem.output_desc,
        JSON.stringify(problem.samples),
        'admin',
        'published',
        now
      )
      for (const testcase of problem.testcases) {
        await db.run(
          `INSERT INTO testcases (problem_id, input, output, is_sample, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          problem.id,
          testcase.input,
          testcase.output,
          testcase.is_sample,
          now
        )
      }
    }
  }

  const testcaseCount = await db.get(`SELECT COUNT(*) as count FROM testcases`)
  if (testcaseCount && testcaseCount.count === 0) {
    const rows = await db.all(`SELECT id, samples FROM problems`)
    const now = new Date().toISOString()
    for (const row of rows) {
      const samples = JSON.parse(row.samples || '[]')
      for (const sample of samples) {
        if (!sample?.input || sample?.output === undefined) continue
        await db.run(
          `INSERT INTO testcases (problem_id, input, output, is_sample, created_at)
           VALUES (?, ?, ?, 1, ?)`,
          row.id,
          String(sample.input),
          String(sample.output),
          now
        )
      }
    }
  }

  // Create user statistics tables
  await db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date ON daily_activity (user_id, activity_date);
    CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements (user_id);
    CREATE INDEX IF NOT EXISTS idx_solved_problems_user ON solved_problems (user_id);
    CREATE INDEX IF NOT EXISTS idx_solved_problems_problem ON solved_problems (problem_id);
    CREATE INDEX IF NOT EXISTS idx_user_stats_rank ON user_stats (rank);
    CREATE INDEX IF NOT EXISTS idx_problem_plan_user ON problem_plan (user_id);
  `)

  // Initialize user_stats for existing users
  const existingUsers = await db.all(`SELECT id FROM users`)
  for (const user of existingUsers) {
    const existingStat = await db.get(`SELECT user_id FROM user_stats WHERE user_id = ?`, user.id)
    if (!existingStat) {
      await db.run(
        `INSERT INTO user_stats (user_id, total_submissions, accepted_count, tried_problems, solved_problems, acceptance_rate, current_streak, max_streak, last_submission_date, rank)
         VALUES (?, 0, 0, 0, 0, 0, 0, 0, NULL, 0)`,
        user.id
      )
    }
  }
}

export const getDb = async () => {
  const db = await dbPromise
  return db
}
