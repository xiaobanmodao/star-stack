import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import path from 'path'
import { fileURLToPath } from 'url'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DB_PATH = path.join(DATA_DIR, 'starstack.sqlite')

const dbPromise = open({
  filename: DB_PATH,
  driver: sqlite3.Database,
})

const BUILTIN_PROBLEMS = [
  {
    id: 1001,
    slug: 'p1001-star-sum',
    title: '星尘求和',
    difficulty: '入门',
    tags: '数学,基础',
    statement: '给定两个整数 A 和 B，输出 A + B。',
    input_desc: '输入两个整数 A 和 B，以空格分隔。',
    output_desc: '输出 A + B 的结果。',
    data_range: '-10^9 \\le A, B \\le 10^9',
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
    data_range: '1 \\le N \\le 10^5',
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
    data_range: '1 \\le |s| \\le 10^5',
    samples: [{ input: 'level', output: 'Yes' }],
    testcases: [
      { input: 'level', output: 'Yes', is_sample: 1 },
      { input: 'star', output: 'No', is_sample: 0 },
      { input: 'abba', output: 'Yes', is_sample: 0 },
    ],
  },
  {
    id: 1004,
    slug: 'p1004-ladder-sum',
    title: '阶梯求和',
    difficulty: '入门',
    tags: '数学,前缀和',
    statement: '输入整数 N，输出 1 到 N 的和。',
    input_desc: '输入一个整数 N。',
    output_desc: '输出 1+2+...+N 的结果。',
    data_range: '1 \\le N \\le 10^6',
    samples: [{ input: '5', output: '15' }],
    testcases: [
      { input: '5', output: '15', is_sample: 1 },
      { input: '1', output: '1', is_sample: 0 },
      { input: '100', output: '5050', is_sample: 0 },
    ],
  },
  {
    id: 1005,
    slug: 'p1005-even-odd-line',
    title: '奇偶分流',
    difficulty: '入门',
    tags: '模拟,分支',
    statement: '输入一个整数 N，如果 N 为偶数输出 Even，否则输出 Odd。',
    input_desc: '输入一个整数 N。',
    output_desc: '输出 Even 或 Odd。',
    data_range: '-10^9 \\le N \\le 10^9',
    samples: [{ input: '8', output: 'Even' }],
    testcases: [
      { input: '8', output: 'Even', is_sample: 1 },
      { input: '7', output: 'Odd', is_sample: 0 },
      { input: '0', output: 'Even', is_sample: 0 },
    ],
  },
  {
    id: 1006,
    slug: 'p1006-prefix-delta',
    title: '区间增量统计',
    difficulty: '提高-',
    tags: '前缀和,差分,数组',
    statement: '给定一个长度为 N 的数组与若干次区间加法操作，输出最终数组。',
    input_desc: '第一行输入 N 和 M。第二行输入 N 个整数。接下来 M 行每行输入 l, r, c，表示区间 [l,r] 每个数加上 c。',
    output_desc: '输出操作完成后的数组，每个整数之间用空格分隔。',
    data_range: '1 \\le N, M \\le 2 \\times 10^5',
    samples: [{ input: '5 2\n1 2 3 4 5\n1 3 2\n2 5 -1', output: '3 3 4 3 4' }],
    testcases: [
      { input: '5 2\n1 2 3 4 5\n1 3 2\n2 5 -1', output: '3 3 4 3 4', is_sample: 1 },
      { input: '3 1\n0 0 0\n1 3 5', output: '5 5 5', is_sample: 0 },
      { input: '4 0\n3 1 4 1', output: '3 1 4 1', is_sample: 0 },
    ],
  },
  {
    id: 1007,
    slug: 'p1007-binary-search-answer',
    title: '最小可行值',
    difficulty: '提高',
    tags: '二分,贪心',
    statement: '给定若干木板长度和目标段数 K。每次可以把木板切成若干段，要求每段长度相同且为整数。求能切出至少 K 段时，这个长度的最大值。',
    input_desc: '第一行输入 N 和 K。第二行输入 N 个木板长度。',
    output_desc: '输出满足条件的最大整数长度。',
    data_range: '1 \\le N \\le 10^5, 1 \\le K \\le 10^9',
    samples: [{ input: '4 11\n8 7 6 5', output: '2' }],
    testcases: [
      { input: '4 11\n8 7 6 5', output: '2', is_sample: 1 },
      { input: '3 3\n9 9 9', output: '9', is_sample: 0 },
      { input: '2 100\n5 7', output: '0', is_sample: 0 },
    ],
  },
  {
    id: 1008,
    slug: 'p1008-bfs-maze',
    title: '星港迷宫',
    difficulty: '普及',
    tags: '搜索,广度优先搜索,图论',
    statement: '给定一个由 0 和 1 组成的网格，0 表示可走，1 表示障碍。求从左上角到右下角的最短步数，无法到达输出 -1。',
    input_desc: '第一行输入 n 和 m。接下来 n 行每行 m 个字符，仅包含 0 或 1。',
    output_desc: '输出最短步数。',
    data_range: '1 \\le n, m \\le 200',
    samples: [{ input: '3 3\n000\n010\n000', output: '4' }],
    testcases: [
      { input: '3 3\n000\n010\n000', output: '4', is_sample: 1 },
      { input: '2 2\n00\n00', output: '2', is_sample: 0 },
      { input: '2 2\n01\n10', output: '-1', is_sample: 0 },
    ],
  },
]

// 兼容早期版本数据库：CREATE TABLE IF NOT EXISTS 不会为已存在的旧表补字段。
// 这些字段均带有安全默认值，只补结构，不删除或覆盖已有用户数据。
const LEGACY_COLUMN_PATCHES = [
  { table: 'users', column: 'is_banned', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'users', column: 'avatar', definition: 'TEXT' },
  { table: 'users', column: 'rating', definition: 'REAL NOT NULL DEFAULT 0' },
  { table: 'users', column: 'onboarded_at', definition: 'TEXT' },
  { table: 'users', column: 'bio', definition: "TEXT DEFAULT ''" },
  { table: 'problems', column: 'slug', definition: 'TEXT' },
  { table: 'problems', column: 'tags', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'problems', column: 'input_desc', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'problems', column: 'output_desc', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'problems', column: 'data_range', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'problems', column: 'samples', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'problems', column: 'creator_id', definition: 'TEXT' },
  { table: 'problems', column: 'status', definition: "TEXT NOT NULL DEFAULT 'published'" },
  { table: 'submissions', column: 'message', definition: 'TEXT' },
  { table: 'submissions', column: 'results_json', definition: 'TEXT' },
  { table: 'submissions', column: 'score', definition: 'INTEGER DEFAULT 0' },
  { table: 'testcases', column: 'is_sample', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'testcases', column: 'time_limit_ms', definition: 'INTEGER NOT NULL DEFAULT 1500' },
]

const ensureLegacyColumns = async (db) => {
  for (const patch of LEGACY_COLUMN_PATCHES) {
    const columns = await db.all(`PRAGMA table_info(${patch.table})`)
    if (columns.length === 0 || columns.some((column) => column.name === patch.column)) continue
    await db.exec(`ALTER TABLE ${patch.table} ADD COLUMN ${patch.column} ${patch.definition}`)
    console.log(`[db] added legacy column ${patch.table}.${patch.column}`)
  }
}

const ensureBuiltinProblems = async (db) => {
  const now = new Date().toISOString()

  for (const problem of BUILTIN_PROBLEMS) {
    const existing = await db.get(
      `SELECT id FROM problems WHERE id = ? OR slug = ? LIMIT 1`,
      problem.id,
      problem.slug
    )

    if (!existing) {
      await db.run(
        `INSERT INTO problems (id, slug, title, difficulty, tags, statement, input_desc, output_desc, data_range, samples, creator_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        problem.id,
        problem.slug,
        problem.title,
        problem.difficulty,
        problem.tags,
        problem.statement,
        problem.input_desc,
        problem.output_desc,
        problem.data_range,
        JSON.stringify(problem.samples),
        'admin',
        'published',
        now
      )
    } else {
      await db.run(
        `UPDATE problems
         SET slug = ?, title = ?, difficulty = ?, tags = ?, statement = ?, input_desc = ?, output_desc = ?, data_range = ?, samples = ?, creator_id = COALESCE(creator_id, ?), status = COALESCE(status, ?)
         WHERE id = ?`,
        problem.slug,
        problem.title,
        problem.difficulty,
        problem.tags,
        problem.statement,
        problem.input_desc,
        problem.output_desc,
        problem.data_range,
        JSON.stringify(problem.samples),
        'admin',
        'published',
        existing.id
      )
    }

    const testcaseCount = await db.get(
      `SELECT COUNT(*) as count FROM testcases WHERE problem_id = ?`,
      problem.id
    )
    if (!testcaseCount || testcaseCount.count === 0) {
      await db.run(`DELETE FROM testcases WHERE problem_id = ?`, problem.id)
      for (const testcase of problem.testcases) {
        await db.run(
          `INSERT INTO testcases (problem_id, input, output, is_sample, time_limit_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          problem.id,
          testcase.input,
          testcase.output,
          testcase.is_sample,
          testcase.time_limit_ms || 1500,
          now
        )
      }
    }
  }
}

export const initDb = async () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  const db = await dbPromise
  await db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_banned INTEGER NOT NULL DEFAULT 0,
      onboarded_at TEXT,
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
      time_limit_ms INTEGER NOT NULL DEFAULT 1500,
      created_at TEXT NOT NULL,
      FOREIGN KEY (problem_id) REFERENCES problems (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions (user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions (problem_id);
    CREATE INDEX IF NOT EXISTS idx_testcases_problem ON testcases (problem_id);
  `)

  await ensureLegacyColumns(db)
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_submissions_problem_status ON submissions (problem_id, status);
    CREATE INDEX IF NOT EXISTS idx_submissions_user_created ON submissions (user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_testcases_problem_sample ON testcases (problem_id, is_sample, id);
    CREATE INDEX IF NOT EXISTS idx_problems_status_difficulty ON problems (status, difficulty, id);
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
  if (submissionColumns.length > 0 && !submissionNames.includes('score')) {
    await db.exec(`ALTER TABLE submissions ADD COLUMN score INTEGER DEFAULT 0;`)
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
    // 初始管理员密码：优先取环境变量；否则生成随机密码并打印（避免硬编码弱口令）
    const adminPassword = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url')
    const passwordHash = bcrypt.hashSync(adminPassword, 10)
    await db.run(
      `INSERT INTO users (id, name, password_hash, is_admin, is_banned, created_at)
       VALUES (?, ?, ?, 1, 0, ?)`,
      adminId,
      adminName,
      passwordHash,
      new Date().toISOString()
    )
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`[init] 已创建管理员 ${adminId}，初始密码（随机生成，请立即修改）：${adminPassword}`)
    }
  }

  await ensureBuiltinProblems(db)

  const testcaseCount = await db.get(`SELECT COUNT(*) as count FROM testcases`)
  if (testcaseCount && testcaseCount.count === 0) {
    const rows = await db.all(`SELECT id, samples FROM problems`)
    const now = new Date().toISOString()
    for (const row of rows) {
      const samples = JSON.parse(row.samples || '[]')
      for (const sample of samples) {
        if (!sample?.input || sample?.output === undefined) continue
        await db.run(
          `INSERT INTO testcases (problem_id, input, output, is_sample, time_limit_ms, created_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
          row.id,
          String(sample.input),
          String(sample.output),
          sample.timeLimitMs || 1500,
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
      xp INTEGER DEFAULT 0,
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_achievements_unique ON user_achievements (user_id, achievement_type);
    CREATE INDEX IF NOT EXISTS idx_solved_problems_user ON solved_problems (user_id);
    CREATE INDEX IF NOT EXISTS idx_solved_problems_problem ON solved_problems (problem_id);
    CREATE INDEX IF NOT EXISTS idx_solved_problems_time_user_problem ON solved_problems (first_solved_at, user_id, problem_id);
    CREATE INDEX IF NOT EXISTS idx_user_stats_rank ON user_stats (rank);
    CREATE INDEX IF NOT EXISTS idx_problem_plan_user ON problem_plan (user_id);
  `)

  // Discussion tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS discussion_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      problem_id INTEGER,
      view_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      pinned_at TEXT,
      is_solution INTEGER DEFAULT 0,
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

    CREATE INDEX IF NOT EXISTS idx_posts_user ON discussion_posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_problem ON discussion_posts(problem_id);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON discussion_posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON discussion_comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON discussion_comments(parent_id);
    CREATE INDEX IF NOT EXISTS idx_likes_target ON discussion_likes(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_likes_user ON discussion_likes(user_id);

    CREATE TABLE IF NOT EXISTS discussion_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES discussion_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_discussion_views_post ON discussion_views(post_id);

    -- Leaderboard history table for tracking rank changes
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
    CREATE INDEX IF NOT EXISTS idx_leaderboard_history_period ON leaderboard_history(period_type, period_key);
    CREATE INDEX IF NOT EXISTS idx_leaderboard_history_period_user ON leaderboard_history(period_type, period_key, user_id);
    CREATE INDEX IF NOT EXISTS idx_leaderboard_history_user ON leaderboard_history(user_id);

    -- Private messaging tables
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

    CREATE INDEX IF NOT EXISTS idx_conversations_user1 ON conversations(user1_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user2 ON conversations(user2_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender_read ON messages(conversation_id, sender_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_message_deletions_message ON message_deletions(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON message_deletions(user_id);

    -- ============================================================
    -- Chat tables (聊天中心：模块频道 / 实时聊天室 / 消息 / 回应 / 已读 / 在线状态)
    -- ============================================================

    CREATE TABLE IF NOT EXISTS chat_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chat_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'public',
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_room_members (
      room_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_key TEXT,
      room_id INTEGER,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_read_state (
      user_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, scope_type, scope_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_presence (
      user_id TEXT PRIMARY KEY,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_key, id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, id);
    CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON chat_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members(user_id);

    -- 好友系统：互相关注即成为好友
    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      followee_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower_id, followee_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (followee_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id, created_at);

    -- 通知中心（关注 / 评论 / 回复 / @提及 / 房间邀请）
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      type TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at);

    -- 黑名单（屏蔽后对方不可私信/评论/查看档案）
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id),
      FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

    -- 聊天室邀请链接（一次性 / 带过期时间）
    CREATE TABLE IF NOT EXISTS room_invite_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT,
      max_uses INTEGER DEFAULT 1,
      use_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_room_invite_links_room ON room_invite_links(room_id);

    -- 收藏（帖子 / 题目）
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, target_type, target_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created_at);

    -- Web Push 订阅（浏览器推送通知）
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      keys_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

    -- 聊天统计 / 活跃度 / 聊天成就（游戏化）
    CREATE TABLE IF NOT EXISTS chat_stats (
      user_id TEXT PRIMARY KEY,
      message_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      post_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      reaction_received INTEGER DEFAULT 0,
      activity_score INTEGER DEFAULT 0,
      last_active_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_activity_log (
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, day),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_activity_day ON chat_activity_log(day, score);

    -- 举报（帖子 / 评论 / 聊天消息 / 用户）
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);

    CREATE TABLE IF NOT EXISTS chat_achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      UNIQUE(user_id, type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 前端错误上报（基础错误监控）
    CREATE TABLE IF NOT EXISTS client_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      message TEXT NOT NULL,
      source TEXT,
      line INTEGER,
      column INTEGER,
      stack TEXT,
      url TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at);

    -- 每日签到（独立于 AC 连击）
    CREATE TABLE IF NOT EXISTS daily_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      checkin_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, checkin_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_date ON daily_checkins(user_id, checkin_date);

    -- 种子频道：杂谈 / 评测OJ / 界芽计划 / StarCode
    INSERT OR IGNORE INTO chat_channels (key, name, icon, description, sort_order) VALUES
      ('general', '杂谈', '💬', '任何话题的闲聊', 0),
      ('oj', '评测OJ', '⚡', '题目、评测与竞赛相关讨论', 1),
      ('jieya', '界芽计划', '🌱', '创造型世界沙盒 · 界芽计划', 2),
      ('starcode', 'StarCode', '⌨️', 'C++ 编辑器 StarCode 使用与反馈', 3);
  `)

  // Migration: discussion_posts.module_key（帖子所属模块，聊天广场按模块过滤）
  const postColumns = await db.all(`PRAGMA table_info(discussion_posts)`)
  if (!postColumns.some((col) => col.name === 'module_key')) {
    await db.exec(
      `ALTER TABLE discussion_posts ADD COLUMN module_key TEXT DEFAULT 'general'`
    )
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_posts_module ON discussion_posts(module_key, created_at)`
    )
  }

  // Migration: chat_messages.thread_parent_id（话题线程：回复挂在父消息下，主时间线不展示）
  const chatMessageColumns = await db.all(`PRAGMA table_info(chat_messages)`)
  if (!chatMessageColumns.some((col) => col.name === 'thread_parent_id')) {
    await db.exec(
      `ALTER TABLE chat_messages ADD COLUMN thread_parent_id INTEGER`
    )
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_parent_id, id)`
    )
  }

  // Migration: users.bio（个人简介）
  const userColumns = await db.all(`PRAGMA table_info(users)`)
  if (!userColumns.some((col) => col.name === 'bio')) {
    await db.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`)
  }
  if (!userColumns.some((col) => col.name === 'onboarded_at')) {
    await db.exec(`ALTER TABLE users ADD COLUMN onboarded_at TEXT`)
  }

  // Migration: discussion_posts.is_pinned / pinned_at（帖子置顶）
  const discussionPostColumns = await db.all(`PRAGMA table_info(discussion_posts)`)
  if (!discussionPostColumns.some((col) => col.name === 'is_pinned')) {
    await db.exec(`ALTER TABLE discussion_posts ADD COLUMN is_pinned INTEGER DEFAULT 0`)
  }
  if (!discussionPostColumns.some((col) => col.name === 'pinned_at')) {
    await db.exec(`ALTER TABLE discussion_posts ADD COLUMN pinned_at TEXT`)
  }
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_pinned ON discussion_posts(is_pinned, created_at)`
  )

  // Migration: discussion_posts.is_solution（洛谷风格题解）
  const solutionPostColumns = await db.all(`PRAGMA table_info(discussion_posts)`)
  if (!solutionPostColumns.some((col) => col.name === 'is_solution')) {
    await db.exec(`ALTER TABLE discussion_posts ADD COLUMN is_solution INTEGER DEFAULT 0`)
  }
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_solution_problem ON discussion_posts(is_solution, problem_id, created_at)`
  )

  // Migration: user_stats.xp（站内等级经验）
  const userStatsColumns = await db.all(`PRAGMA table_info(user_stats)`)
  if (!userStatsColumns.some((col) => col.name === 'xp')) {
    await db.exec(`ALTER TABLE user_stats ADD COLUMN xp INTEGER DEFAULT 0`)
  }

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

export const closeDb = async () => {
  const db = await dbPromise
  if (db.open) await db.close()
}
