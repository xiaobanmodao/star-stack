/**
 * 数据库补全迁移脚本
 * 用法: node server/migrate.js
 *
 * 安全地为旧数据库补全所有缺失的表、列和索引，不会影响已有数据。
 */
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'data', 'starstack.sqlite')

async function migrate() {
  console.log(`数据库路径: ${DB_PATH}`)
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database })

  // 获取所有已有表名
  const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`)
  const tableNames = new Set(tables.map(t => t.name))
  console.log(`已有表: ${[...tableNames].join(', ')}`)

  // ========== 1. 补全 users 表缺失列 ==========
  const userCols = (await db.all(`PRAGMA table_info(users)`)).map(c => c.name)
  for (const [col, ddl] of [
    ['is_banned', 'INTEGER NOT NULL DEFAULT 0'],
    ['avatar', 'TEXT'],
    ['rating', 'REAL NOT NULL DEFAULT 0'],
  ]) {
    if (!userCols.includes(col)) {
      await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${ddl}`)
      console.log(`  + users.${col}`)
    }
  }

  // ========== 2. 补全 submissions 表缺失列 ==========
  const subCols = (await db.all(`PRAGMA table_info(submissions)`)).map(c => c.name)
  for (const [col, ddl] of [
    ['results_json', 'TEXT'],
    ['score', 'INTEGER DEFAULT 0'],
  ]) {
    if (!subCols.includes(col)) {
      await db.exec(`ALTER TABLE submissions ADD COLUMN ${col} ${ddl}`)
      console.log(`  + submissions.${col}`)
    }
  }

  // ========== 3. 补全 problems 表缺失列 ==========
  const probCols = (await db.all(`PRAGMA table_info(problems)`)).map(c => c.name)
  for (const [col, ddl] of [
    ['creator_id', 'TEXT'],
    ['data_range', "TEXT NOT NULL DEFAULT ''"],
    ['status', "TEXT NOT NULL DEFAULT 'published'"],
  ]) {
    if (!probCols.includes(col)) {
      await db.exec(`ALTER TABLE problems ADD COLUMN ${col} ${ddl}`)
      console.log(`  + problems.${col}`)
    }
  }

  // ========== 4. 补全 testcases 表缺失列 ==========
  const tcCols = (await db.all(`PRAGMA table_info(testcases)`)).map(c => c.name)
  if (!tcCols.includes('is_sample')) {
    await db.exec(`ALTER TABLE testcases ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0`)
    console.log(`  + testcases.is_sample`)
  }

  // ========== 5. 补全缺失的表 ==========
  const newTables = {
    user_stats: `CREATE TABLE IF NOT EXISTS user_stats (
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
    )`,
    daily_activity: `CREATE TABLE IF NOT EXISTS daily_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      submission_count INTEGER DEFAULT 0,
      accepted_count INTEGER DEFAULT 0,
      UNIQUE(user_id, activity_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    user_achievements: `CREATE TABLE IF NOT EXISTS user_achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      achievement_type TEXT NOT NULL,
      achievement_data TEXT,
      unlocked_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    solved_problems: `CREATE TABLE IF NOT EXISTS solved_problems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      problem_id INTEGER NOT NULL,
      difficulty TEXT,
      first_solved_at TEXT NOT NULL,
      UNIQUE(user_id, problem_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
    )`,
    problem_plan: `CREATE TABLE IF NOT EXISTS problem_plan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      problem_id INTEGER NOT NULL,
      added_at TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      UNIQUE(user_id, problem_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
    )`,
    discussion_posts: `CREATE TABLE IF NOT EXISTS discussion_posts (
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
    )`,
    discussion_comments: `CREATE TABLE IF NOT EXISTS discussion_comments (
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
    )`,
    discussion_likes: `CREATE TABLE IF NOT EXISTS discussion_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, target_type, target_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    discussion_views: `CREATE TABLE IF NOT EXISTS discussion_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES discussion_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    leaderboard_history: `CREATE TABLE IF NOT EXISTS leaderboard_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      period_type TEXT NOT NULL,
      period_key TEXT NOT NULL,
      rank INTEGER NOT NULL,
      value REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      UNIQUE(user_id, period_type, period_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    conversations: `CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id TEXT NOT NULL,
      user2_id TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user1_id, user2_id),
      FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    messages: `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    message_deletions: `CREATE TABLE IF NOT EXISTS message_deletions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      UNIQUE(message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  }

  for (const [name, sql] of Object.entries(newTables)) {
    const isNew = !tableNames.has(name)
    await db.exec(sql)
    if (isNew) console.log(`  + 创建表 ${name}`)
  }

  // ========== 6. 补全所有索引 ==========
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date ON daily_activity(user_id, activity_date)',
    'CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_solved_problems_user ON solved_problems(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_solved_problems_problem ON solved_problems(problem_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_stats_rank ON user_stats(rank)',
    'CREATE INDEX IF NOT EXISTS idx_problem_plan_user ON problem_plan(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_posts_user ON discussion_posts(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_posts_problem ON discussion_posts(problem_id)',
    'CREATE INDEX IF NOT EXISTS idx_posts_created ON discussion_posts(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_comments_post ON discussion_comments(post_id)',
    'CREATE INDEX IF NOT EXISTS idx_comments_parent ON discussion_comments(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_likes_target ON discussion_likes(target_type, target_id)',
    'CREATE INDEX IF NOT EXISTS idx_likes_user ON discussion_likes(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_discussion_views_post ON discussion_views(post_id)',
    'CREATE INDEX IF NOT EXISTS idx_leaderboard_history_period ON leaderboard_history(period_type, period_key)',
    'CREATE INDEX IF NOT EXISTS idx_leaderboard_history_user ON leaderboard_history(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_user1 ON conversations(user1_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_user2 ON conversations(user2_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at)',
    'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)',
    'CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)',
    'CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_message_deletions_message ON message_deletions(message_id)',
    'CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON message_deletions(user_id)',
  ]
  for (const sql of indexes) {
    await db.exec(sql)
  }
  console.log(`  索引补全完成 (${indexes.length} 条)`)

  // ========== 7. 为已有用户初始化 user_stats ==========
  const users = await db.all(`SELECT id FROM users`)
  let statsAdded = 0
  for (const u of users) {
    const exists = await db.get(`SELECT user_id FROM user_stats WHERE user_id = ?`, u.id)
    if (!exists) {
      await db.run(
        `INSERT INTO user_stats (user_id) VALUES (?)`, u.id
      )
      statsAdded++
    }
  }
  if (statsAdded > 0) console.log(`  + 初始化 ${statsAdded} 个用户的 user_stats`)

  // ========== 完成 ==========
  // 最终验证
  const finalTables = await db.all(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  console.log(`\n迁移完成! 当前共 ${finalTables.length} 张表:`)
  console.log(finalTables.map(t => `  - ${t.name}`).join('\n'))

  await db.close()
}

migrate().catch(err => {
  console.error('迁移失败:', err)
  process.exit(1)
})
