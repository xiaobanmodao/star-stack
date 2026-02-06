#!/usr/bin/env node
/**
 * 数据库诊断和修复工具
 * 用于排查和修复登录后无法加载题目的问题
 */

import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DB_PATH = join(__dirname, 'data', 'oj.sqlite')

async function openDb() {
  return open({
    filename: DB_PATH,
    driver: sqlite3.Database
  })
}

async function diagnose() {
  console.log('='.repeat(60))
  console.log('数据库诊断工具')
  console.log('='.repeat(60))
  console.log()

  let db
  try {
    db = await openDb()
    console.log('✓ 成功连接到数据库:', DB_PATH)
    console.log()

    // 1. 检查 submissions 表结构
    console.log('1. 检查 submissions 表结构')
    console.log('-'.repeat(60))
    const submissionColumns = await db.all(`PRAGMA table_info(submissions)`)
    console.log('submissions 表字段:')
    submissionColumns.forEach(col => {
      console.log(`  - ${col.name} (${col.type})${col.notnull ? ' NOT NULL' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`)
    })

    const hasScore = submissionColumns.some(col => col.name === 'score')
    if (hasScore) {
      console.log('✓ score 字段存在')
    } else {
      console.log('✗ score 字段不存在 - 这是问题所在！')
    }
    console.log()

    // 2. 检查索引
    console.log('2. 检查数据库索引')
    console.log('-'.repeat(60))
    const indexes = await db.all(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND tbl_name='submissions'`)
    if (indexes.length > 0) {
      console.log('submissions 表索引:')
      indexes.forEach(idx => {
        console.log(`  - ${idx.name}`)
      })
    } else {
      console.log('✗ 没有找到索引')
    }
    console.log()

    // 3. 检查 sessions 表
    console.log('3. 检查 sessions 表')
    console.log('-'.repeat(60))
    const sessionCount = await db.get(`SELECT COUNT(*) as count FROM sessions`)
    console.log(`sessions 表记录数: ${sessionCount.count}`)

    if (sessionCount.count > 0) {
      const recentSessions = await db.all(`SELECT token, user_id, created_at FROM sessions ORDER BY created_at DESC LIMIT 3`)
      console.log('最近的 sessions:')
      recentSessions.forEach(s => {
        console.log(`  - user_id: ${s.user_id}, token: ${s.token.substring(0, 20)}..., created_at: ${s.created_at}`)
      })
    }
    console.log()

    // 4. 检查 problems 表
    console.log('4. 检查 problems 表')
    console.log('-'.repeat(60))
    const problemCount = await db.get(`SELECT COUNT(*) as count FROM problems`)
    console.log(`problems 表记录数: ${problemCount.count}`)
    console.log()

    // 5. 检查 submissions 表数据
    console.log('5. 检查 submissions 表')
    console.log('-'.repeat(60))
    const submissionCount = await db.get(`SELECT COUNT(*) as count FROM submissions`)
    console.log(`submissions 表记录数: ${submissionCount.count}`)

    if (hasScore && submissionCount.count > 0) {
      const scoreStats = await db.get(`SELECT COUNT(*) as total, COUNT(score) as with_score, AVG(score) as avg_score FROM submissions`)
      console.log(`  - 总记录数: ${scoreStats.total}`)
      console.log(`  - 有分数的记录: ${scoreStats.with_score}`)
      console.log(`  - 平均分数: ${scoreStats.avg_score || 0}`)
    }
    console.log()

    // 6. 测试查询
    console.log('6. 测试关键查询')
    console.log('-'.repeat(60))

    if (sessionCount.count > 0 && problemCount.count > 0) {
      const testSession = await db.get(`SELECT user_id FROM sessions LIMIT 1`)
      const testProblem = await db.get(`SELECT id FROM problems LIMIT 1`)

      if (testSession && testProblem) {
        console.log(`测试用户: ${testSession.user_id}`)
        console.log(`测试题目: ${testProblem.id}`)

        try {
          if (hasScore) {
            const result = await db.get(
              `SELECT MAX(score) as max_score FROM submissions WHERE problem_id = ? AND user_id = ?`,
              testProblem.id,
              testSession.user_id
            )
            console.log('✓ 查询成功:', result)
          } else {
            console.log('✗ 无法测试查询 - score 字段不存在')
          }
        } catch (err) {
          console.log('✗ 查询失败:', err.message)
        }
      }
    } else {
      console.log('跳过测试 - 没有足够的数据')
    }
    console.log()

    // 7. 诊断结果
    console.log('='.repeat(60))
    console.log('诊断结果')
    console.log('='.repeat(60))

    const issues = []

    if (!hasScore) {
      issues.push('submissions 表缺少 score 字段')
    }

    if (indexes.length === 0) {
      issues.push('submissions 表缺少索引，可能导致查询缓慢')
    }

    if (issues.length > 0) {
      console.log('发现以下问题:')
      issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`)
      })
      console.log()
      console.log('建议运行修复程序: node diagnose.js --fix')
    } else {
      console.log('✓ 未发现明显问题')
      console.log()
      console.log('如果问题仍然存在，请检查:')
      console.log('  1. 后端服务日志: pm2 logs star-stack-api')
      console.log('  2. Nginx 配置是否正确代理 /api 请求')
      console.log('  3. 浏览器控制台的网络请求错误')
    }
    console.log()

  } catch (err) {
    console.error('✗ 诊断过程中出错:', err.message)
    console.error(err.stack)
  } finally {
    if (db) {
      await db.close()
    }
  }
}

async function fix() {
  console.log('='.repeat(60))
  console.log('数据库修复工具')
  console.log('='.repeat(60))
  console.log()

  let db
  try {
    db = await openDb()
    console.log('✓ 成功连接到数据库:', DB_PATH)
    console.log()

    // 1. 检查并添加 score 字段
    console.log('1. 检查 score 字段')
    console.log('-'.repeat(60))
    const submissionColumns = await db.all(`PRAGMA table_info(submissions)`)
    const hasScore = submissionColumns.some(col => col.name === 'score')

    if (!hasScore) {
      console.log('添加 score 字段...')
      await db.exec(`ALTER TABLE submissions ADD COLUMN score INTEGER DEFAULT 0`)
      console.log('✓ 成功添加 score 字段')
    } else {
      console.log('✓ score 字段已存在')
    }
    console.log()

    // 2. 检查并添加索引
    console.log('2. 检查索引')
    console.log('-'.repeat(60))
    const indexes = await db.all(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='submissions'`)
    const indexNames = indexes.map(idx => idx.name)

    const requiredIndexes = [
      { name: 'idx_submissions_user', sql: 'CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions (user_id)' },
      { name: 'idx_submissions_problem', sql: 'CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions (problem_id)' },
      { name: 'idx_submissions_problem_user', sql: 'CREATE INDEX IF NOT EXISTS idx_submissions_problem_user ON submissions (problem_id, user_id)' },
      { name: 'idx_submissions_problem_user_score', sql: 'CREATE INDEX IF NOT EXISTS idx_submissions_problem_user_score ON submissions (problem_id, user_id, score DESC)' }
    ]

    for (const idx of requiredIndexes) {
      if (!indexNames.includes(idx.name)) {
        console.log(`添加索引 ${idx.name}...`)
        await db.exec(idx.sql)
        console.log(`✓ 成功添加索引 ${idx.name}`)
      } else {
        console.log(`✓ 索引 ${idx.name} 已存在`)
      }
    }
    console.log()

    // 3. 验证修复
    console.log('3. 验证修复')
    console.log('-'.repeat(60))

    const updatedColumns = await db.all(`PRAGMA table_info(submissions)`)
    const hasScoreNow = updatedColumns.some(col => col.name === 'score')

    if (hasScoreNow) {
      console.log('✓ score 字段验证通过')

      // 测试查询
      try {
        const testResult = await db.get(`SELECT MAX(score) as max_score FROM submissions LIMIT 1`)
        console.log('✓ 查询测试通过')
      } catch (err) {
        console.log('✗ 查询测试失败:', err.message)
      }
    } else {
      console.log('✗ score 字段验证失败')
    }
    console.log()

    console.log('='.repeat(60))
    console.log('修复完成！')
    console.log('='.repeat(60))
    console.log()
    console.log('请重启后端服务:')
    console.log('  pm2 restart star-stack-api')
    console.log()

  } catch (err) {
    console.error('✗ 修复过程中出错:', err.message)
    console.error(err.stack)
  } finally {
    if (db) {
      await db.close()
    }
  }
}

// 主程序
const args = process.argv.slice(2)

if (args.includes('--fix')) {
  fix()
} else if (args.includes('--help') || args.includes('-h')) {
  console.log('用法:')
  console.log('  node diagnose.js          # 诊断数据库问题')
  console.log('  node diagnose.js --fix    # 修复数据库问题')
  console.log('  node diagnose.js --help   # 显示帮助')
} else {
  diagnose()
}
