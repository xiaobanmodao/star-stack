/**
 * 生产数据库安全迁移与校验脚本
 *
 * 用法：
 *   node server/migrate.js
 *
 * 迁移逻辑统一复用 db.js 的完整 initDb()，这样旧服务器升级时会同时补齐：
 * - 基础 OJ 表与字段
 * - 统计、题解、私信、聊天、社交、通知等新表
 * - 当前版本新增的字段和索引
 *
 * 脚本只执行 IF NOT EXISTS / ADD COLUMN / 数据补全，不会删除用户、题目、提交、帖子或消息。
 * 生产执行前仍建议先备份 server/data/starstack.sqlite。
 */

import { closeDb, getDb, initDb } from './db.js'

const REQUIRED_SCHEMA = {
  users: ['id', 'name', 'password_hash', 'email', 'email_verified_at', 'is_admin', 'is_banned', 'avatar', 'rating', 'bio', 'onboarded_at', 'created_at'],
  email_verifications: ['email', 'code_hash', 'expires_at', 'attempts', 'last_sent_at', 'created_at'],
  sessions: ['token', 'user_id', 'created_at'],
  problems: ['id', 'slug', 'title', 'difficulty', 'tags', 'statement', 'input_desc', 'output_desc', 'data_range', 'samples', 'creator_id', 'status', 'created_at'],
  submissions: ['id', 'problem_id', 'user_id', 'language', 'code', 'status', 'time_ms', 'memory_kb', 'message', 'results_json', 'score', 'created_at'],
  testcases: ['id', 'problem_id', 'input', 'output', 'is_sample', 'time_limit_ms', 'created_at'],
  user_stats: ['user_id', 'total_submissions', 'accepted_count', 'tried_problems', 'solved_problems', 'acceptance_rate', 'current_streak', 'max_streak', 'last_submission_date', 'xp', 'rank'],
  daily_activity: ['id', 'user_id', 'activity_date', 'submission_count', 'accepted_count'],
  user_achievements: ['id', 'user_id', 'achievement_type', 'achievement_data', 'unlocked_at'],
  solved_problems: ['id', 'user_id', 'problem_id', 'difficulty', 'first_solved_at'],
  problem_plan: ['id', 'user_id', 'problem_id', 'added_at', 'completed', 'completed_at'],
  discussion_posts: ['id', 'user_id', 'title', 'content', 'problem_id', 'view_count', 'like_count', 'comment_count', 'is_pinned', 'pinned_at', 'is_solution', 'module_key', 'created_at', 'updated_at'],
  discussion_comments: ['id', 'post_id', 'user_id', 'content', 'parent_id', 'like_count', 'created_at'],
  discussion_likes: ['id', 'user_id', 'target_type', 'target_id', 'created_at'],
  discussion_views: ['id', 'post_id', 'user_id', 'created_at'],
  leaderboard_history: ['id', 'user_id', 'period_type', 'period_key', 'rank', 'value', 'recorded_at'],
  conversations: ['id', 'user1_id', 'user2_id', 'last_message_at', 'created_at'],
  messages: ['id', 'conversation_id', 'sender_id', 'content', 'is_read', 'created_at'],
  message_deletions: ['id', 'message_id', 'user_id', 'deleted_at'],
  chat_channels: ['id', 'key', 'name', 'icon', 'description', 'sort_order'],
  chat_rooms: ['id', 'name', 'description', 'type', 'owner_id', 'created_at'],
  chat_room_members: ['room_id', 'user_id', 'role', 'joined_at'],
  chat_messages: ['id', 'channel_key', 'room_id', 'sender_id', 'content', 'thread_parent_id', 'created_at'],
  chat_reactions: ['id', 'message_id', 'user_id', 'emoji', 'created_at'],
  chat_read_state: ['user_id', 'scope_type', 'scope_id', 'last_read_message_id'],
  user_presence: ['user_id', 'last_seen_at'],
  follows: ['follower_id', 'followee_id', 'created_at'],
  notifications: ['id', 'user_id', 'actor_id', 'type', 'target_type', 'target_id', 'message', 'is_read', 'created_at'],
  blocks: ['blocker_id', 'blocked_id', 'created_at'],
  room_invite_links: ['id', 'room_id', 'token', 'created_by', 'expires_at', 'max_uses', 'use_count', 'created_at'],
  bookmarks: ['id', 'user_id', 'target_type', 'target_id', 'created_at'],
  push_subscriptions: ['id', 'user_id', 'endpoint', 'keys_json', 'created_at'],
  chat_stats: ['user_id', 'message_count', 'reply_count', 'post_count', 'comment_count', 'reaction_received', 'activity_score', 'last_active_at'],
  chat_activity_log: ['user_id', 'day', 'score'],
  reports: ['id', 'reporter_id', 'target_type', 'target_id', 'reason', 'status', 'resolved_by', 'resolved_at', 'resolution_note', 'created_at'],
  admin_audit_logs: ['id', 'admin_id', 'admin_name', 'action', 'target_type', 'target_id', 'detail', 'created_at'],
  chat_achievements: ['id', 'user_id', 'type', 'unlocked_at'],
  client_errors: ['id', 'user_id', 'message', 'source', 'line', 'column', 'stack', 'url', 'user_agent', 'created_at'],
  daily_checkins: ['id', 'user_id', 'checkin_date', 'created_at'],
}

const REQUIRED_INDEXES = [
  'idx_sessions_user',
  'idx_submissions_user',
  'idx_submissions_problem',
  'idx_submissions_problem_status',
  'idx_submissions_user_created',
  'idx_testcases_problem',
  'idx_testcases_problem_sample',
  'idx_problems_status_difficulty',
  'idx_email_verifications_expires',
  'idx_users_email_unique',
]

const verifySchema = async (db) => {
  const rows = await db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
  const tables = new Set(rows.map((row) => row.name))
  const missingTables = Object.keys(REQUIRED_SCHEMA).filter((table) => !tables.has(table))
  const missingColumns = []
  const indexes = new Set((await db.all(`SELECT name FROM sqlite_master WHERE type = 'index'`)).map((row) => row.name))
  const missingIndexes = REQUIRED_INDEXES.filter((index) => !indexes.has(index))

  for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
    if (!tables.has(table)) continue
    const columns = await db.all(`PRAGMA table_info(${table})`)
    const existingColumns = new Set(columns.map((column) => column.name))
    for (const column of requiredColumns) {
      if (!existingColumns.has(column)) missingColumns.push(`${table}.${column}`)
    }
  }

  if (missingTables.length || missingColumns.length) {
    const details = [
      missingTables.length ? `缺少表：${missingTables.join(', ')}` : '',
      missingColumns.length ? `缺少字段：${missingColumns.join(', ')}` : '',
      missingIndexes.length ? `缺少索引：${missingIndexes.join(', ')}` : '',
    ].filter(Boolean).join('\n')
    throw new Error(`数据库迁移后结构仍不完整\n${details}`)
  }

  const foreignKeyIssues = await db.all(`PRAGMA foreign_key_check`)
  if (foreignKeyIssues.length > 0) {
    console.warn(`数据库外键检查发现 ${foreignKeyIssues.length} 条历史问题，请运行 diagnose.js 进一步检查。`)
  }

  const integrity = await db.get(`PRAGMA integrity_check`)
  if (integrity?.integrity_check !== 'ok') {
    throw new Error(`SQLite 完整性检查失败：${integrity?.integrity_check || '未知错误'}`)
  }

  return { tableCount: tables.size }
}

const printDataSummary = async (db) => {
  const tables = ['users', 'problems', 'submissions', 'discussion_posts', 'chat_messages', 'notifications']
  const summary = []
  for (const table of tables) {
    const row = await db.get(`SELECT COUNT(*) AS count FROM ${table}`)
    summary.push(`${table}=${row.count}`)
  }
  console.log(`数据保留校验：${summary.join('，')}`)
}

const migrate = async () => {
  console.log('开始执行 StarStack 生产数据库迁移...')
  try {
    await initDb()
    const db = await getDb()
    const result = await verifySchema(db)
    await printDataSummary(db)
    console.log(`迁移完成：已确认 ${result.tableCount} 张业务表，用户数据和历史记录未删除。`)
  } finally {
    await closeDb().catch(() => {})
  }
}

migrate().catch((error) => {
  console.error('数据库迁移失败：', error)
  process.exitCode = 1
})
