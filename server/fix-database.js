#!/usr/bin/env node
/**
 * 数据库完整修复工具
 * 用于修复服务器上数据库结构不完整的问题
 */

import { initDb, getDb } from './db.js'

async function fix() {
  console.log('='.repeat(60))
  console.log('数据库完整修复工具')
  console.log('='.repeat(60))
  console.log()

  try {
    console.log('步骤 1: 初始化数据库结构')
    console.log('-'.repeat(60))
    console.log('正在运行 initDb()...')

    await initDb()

    console.log('✓ 数据库初始化完成')
    console.log()

    console.log('步骤 2: 验证数据库结构')
    console.log('-'.repeat(60))

    const db = await getDb()

    // 检查所有必需的表
    const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    const tableNames = tables.map(t => t.name)

    console.log('数据库表:')
    tableNames.forEach(name => {
      console.log(`  ✓ ${name}`)
    })
    console.log()

    const requiredTables = ['users', 'sessions', 'problems', 'submissions', 'testcases', 'user_stats', 'daily_activity', 'user_achievements', 'solved_problems', 'problem_plan']
    const missingTables = requiredTables.filter(t => !tableNames.includes(t))

    if (missingTables.length > 0) {
      console.log('✗ 缺少以下表:')
      missingTables.forEach(t => console.log(`  - ${t}`))
      console.log()
      console.log('请检查 db.js 文件是否正确')
      process.exit(1)
    }

    // 检查 submissions 表的 score 字段
    console.log('步骤 3: 检查 submissions 表结构')
    console.log('-'.repeat(60))
    const submissionColumns = await db.all(`PRAGMA table_info(submissions)`)
    console.log('submissions 表字段:')
    submissionColumns.forEach(col => {
      console.log(`  - ${col.name} (${col.type})`)
    })

    const hasScore = submissionColumns.some(col => col.name === 'score')
    if (hasScore) {
      console.log('✓ score 字段存在')
    } else {
      console.log('✗ score 字段不存在')
    }
    console.log()

    // 检查索引
    console.log('步骤 4: 检查索引')
    console.log('-'.repeat(60))
    const indexes = await db.all(`SELECT name, tbl_name FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name`)
    console.log('数据库索引:')
    indexes.forEach(idx => {
      console.log(`  - ${idx.name} (${idx.tbl_name})`)
    })
    console.log()

    // 添加额外的优化索引
    console.log('步骤 5: 添加优化索引')
    console.log('-'.repeat(60))

    const optimizationIndexes = [
      { name: 'idx_submissions_problem_user', sql: 'CREATE INDEX IF NOT EXISTS idx_submissions_problem_user ON submissions (problem_id, user_id)' },
      { name: 'idx_submissions_problem_user_score', sql: 'CREATE INDEX IF NOT EXISTS idx_submissions_problem_user_score ON submissions (problem_id, user_id, score DESC)' }
    ]

    for (const idx of optimizationIndexes) {
      try {
        await db.exec(idx.sql)
        console.log(`✓ 添加索引 ${idx.name}`)
      } catch (err) {
        console.log(`  索引 ${idx.name} 可能已存在`)
      }
    }
    console.log()

    // 测试关键查询
    console.log('步骤 6: 测试关键查询')
    console.log('-'.repeat(60))

    const userCount = await db.get(`SELECT COUNT(*) as count FROM users`)
    console.log(`✓ users 表: ${userCount.count} 条记录`)

    const sessionCount = await db.get(`SELECT COUNT(*) as count FROM sessions`)
    console.log(`✓ sessions 表: ${sessionCount.count} 条记录`)

    const problemCount = await db.get(`SELECT COUNT(*) as count FROM problems`)
    console.log(`✓ problems 表: ${problemCount.count} 条记录`)

    const submissionCount = await db.get(`SELECT COUNT(*) as count FROM submissions`)
    console.log(`✓ submissions 表: ${submissionCount.count} 条记录`)

    if (hasScore && submissionCount.count > 0) {
      try {
        const scoreTest = await db.get(`SELECT MAX(score) as max_score FROM submissions LIMIT 1`)
        console.log(`✓ score 字段查询测试通过`)
      } catch (err) {
        console.log(`✗ score 字段查询失败: ${err.message}`)
      }
    }
    console.log()

    console.log('='.repeat(60))
    console.log('✓ 数据库修复完成！')
    console.log('='.repeat(60))
    console.log()
    console.log('下一步操作:')
    console.log('  1. 重启后端服务: pm2 restart star-stack-api')
    console.log('  2. 查看日志: pm2 logs star-stack-api')
    console.log('  3. 清除浏览器缓存并重新登录测试')
    console.log()

  } catch (err) {
    console.error('✗ 修复过程中出错:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

fix()
