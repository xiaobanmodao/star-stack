const parseSamples = (raw) => {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const tagsFromValue = (value) => Array.isArray(value)
  ? value.map((tag) => String(tag).trim()).filter(Boolean)
  : String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean)

export const buildProblemSnapshot = ({ problem = {}, testcases = [], samples } = {}) => ({
  title: String(problem.title || '').trim(),
  difficulty: problem.difficulty || '入门',
  tags: tagsFromValue(problem.tags),
  statement: problem.statement || '',
  inputDesc: problem.inputDesc ?? problem.input_desc ?? '',
  outputDesc: problem.outputDesc ?? problem.output_desc ?? '',
  dataRange: problem.dataRange ?? problem.data_range ?? '',
  samples: (samples || testcases.filter((item) => Number(item.is_sample) === 1).map((item) => ({
    input: item.input,
    output: item.output,
    timeLimitMs: item.timeLimitMs ?? item.time_limit_ms,
  }))).map((sample) => ({
    input: String(sample.input ?? ''),
    output: String(sample.output ?? ''),
    timeLimitMs: Number(sample.timeLimitMs) || 1500,
  })),
  testData: testcases.filter((item) => Number(item.is_sample) === 0).map((item) => ({
    input: String(item.input ?? ''),
    output: String(item.output ?? ''),
    timeLimitMs: Number(item.timeLimitMs ?? item.time_limit_ms) || 1500,
  })),
})

export const getProblemSnapshot = async (db, problemId) => {
  const problem = await db.get(`SELECT * FROM problems WHERE id = ?`, problemId)
  if (!problem) return null
  const testcases = await db.all(
    `SELECT input, output, is_sample, time_limit_ms FROM testcases WHERE problem_id = ? ORDER BY id ASC`,
    problemId,
  )
  return buildProblemSnapshot({ problem, testcases })
}

export const recordProblemRevision = async (db, { problemId, status, changedBy, snapshot, note = '' }) => {
  const latest = await db.get(`SELECT MAX(version) AS version FROM problem_revisions WHERE problem_id = ?`, problemId)
  const version = Number(latest?.version || 0) + 1
  await db.run(
    `INSERT INTO problem_revisions (problem_id, version, snapshot_json, status, changed_by, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    problemId, version, JSON.stringify(snapshot), status || 'draft', changedBy || null,
    String(note || '').slice(0, 500), new Date().toISOString(),
  )
  return version
}

export const recordProblemStatusChange = async (db, { problemId, fromStatus, toStatus, changedBy, note = '' }) => {
  if (fromStatus === toStatus) return
  await db.run(
    `INSERT INTO problem_status_history (problem_id, from_status, to_status, changed_by, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    problemId, fromStatus || null, toStatus, changedBy || null,
    String(note || '').slice(0, 500), new Date().toISOString(),
  )
}

export const parseRevisionSnapshot = (raw) => {
  try {
    const snapshot = JSON.parse(raw || '{}')
    if (!snapshot || typeof snapshot !== 'object') return null
    return {
      ...snapshot,
      tags: tagsFromValue(snapshot.tags),
      samples: Array.isArray(snapshot.samples) ? snapshot.samples : parseSamples(snapshot.samples),
      testData: Array.isArray(snapshot.testData) ? snapshot.testData : [],
    }
  } catch {
    return null
  }
}
