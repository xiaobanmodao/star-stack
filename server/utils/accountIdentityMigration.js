import { randomUUID } from 'node:crypto'

export const ACCOUNT_STATUSES = Object.freeze(['active', 'suspended', 'deleted'])
const ACCOUNT_STATUS_SET = new Set(ACCOUNT_STATUSES)
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UUID_V4_GLOB = [
  '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]',
  '[0-9a-f][0-9a-f][0-9a-f][0-9a-f]',
  '4[0-9a-f][0-9a-f][0-9a-f]',
  '[89ab][0-9a-f][0-9a-f][0-9a-f]',
  '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]',
].join('-')

export const createAccountSubject = () => randomUUID()
export const isAccountSubject = (value) => typeof value === 'string' && UUID_V4_PATTERN.test(value)

const getUserColumns = async (db) => db.all(`PRAGMA table_info(users)`)

const assertRowsAreValid = (rows) => {
  const seen = new Set()
  const counts = { active: 0, suspended: 0, deleted: 0 }
  for (const row of rows) {
    if (!isAccountSubject(row.account_subject)) {
      throw new Error(`Invalid account_subject UUID for user ${row.id}`)
    }
    if (seen.has(row.account_subject)) {
      throw new Error(`Duplicate account_subject conflict for user ${row.id}`)
    }
    seen.add(row.account_subject)
    if (!ACCOUNT_STATUS_SET.has(row.account_status)) {
      throw new Error(`Invalid account_status for user ${row.id}`)
    }
    const banned = Number(row.is_banned) === 1
    if ((row.account_status === 'active' && banned)
      || (row.account_status !== 'active' && !banned)) {
      throw new Error(`Account status and legacy ban flag conflict for user ${row.id}`)
    }
    const tombstonedAt = typeof row.account_tombstoned_at === 'string'
      ? row.account_tombstoned_at.trim()
      : ''
    if (row.account_status === 'deleted' && !tombstonedAt) {
      throw new Error(`Deleted account ${row.id} is missing its tombstone timestamp`)
    }
    if (row.account_status !== 'deleted' && tombstonedAt) {
      throw new Error(`Non-deleted account ${row.id} has an invalid tombstone timestamp`)
    }
    counts[row.account_status] += 1
  }
  return { users: rows.length, ...counts }
}

export const verifyAccountIdentityData = async (db) => {
  const columns = new Set((await getUserColumns(db)).map((column) => column.name))
  for (const required of ['account_subject', 'account_status', 'account_tombstoned_at']) {
    if (!columns.has(required)) throw new Error(`Missing users.${required}`)
  }
  const rows = await db.all(
    `SELECT id, account_subject, account_status, account_tombstoned_at, is_banned
     FROM users ORDER BY id`,
  )
  return assertRowsAreValid(rows)
}

const createProtectionIndexesAndTriggers = async (db) => {
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account_subject_unique
    ON users(account_subject);

    CREATE TRIGGER IF NOT EXISTS trg_users_account_subject_required_insert
    BEFORE INSERT ON users
    WHEN NEW.account_subject IS NULL
      OR NEW.account_subject NOT GLOB '${UUID_V4_GLOB}'
    BEGIN
      SELECT RAISE(ABORT, 'account subject identity is required and must be a canonical UUID v4');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_users_account_subject_immutable
    BEFORE UPDATE OF account_subject ON users
    WHEN OLD.account_subject IS NOT NEW.account_subject
    BEGIN
      SELECT RAISE(ABORT, 'account_subject is immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_users_account_lifecycle_consistency_insert
    BEFORE INSERT ON users
    WHEN NEW.account_status NOT IN ('active', 'suspended', 'deleted')
      OR (NEW.account_status = 'active' AND NEW.is_banned <> 0)
      OR (NEW.account_status IN ('suspended', 'deleted') AND NEW.is_banned <> 1)
      OR (NEW.account_status = 'deleted' AND (NEW.account_tombstoned_at IS NULL OR trim(NEW.account_tombstoned_at) = ''))
      OR (NEW.account_status <> 'deleted' AND NEW.account_tombstoned_at IS NOT NULL)
      OR (NEW.account_status = 'deleted' AND (
        NEW.is_admin <> 0
        OR NEW.name <> '已注销用户'
        OR NEW.password_hash <> '!tombstoned-account'
        OR NEW.email IS NOT NULL
        OR NEW.email_verified_at IS NOT NULL
        OR NEW.avatar IS NOT NULL
        OR COALESCE(NEW.bio, '') <> ''
        OR NEW.avatar_frame <> 'none'
        OR NEW.avatar_overlay <> 'none'
        OR NEW.equipped_title IS NOT NULL
      ))
    BEGIN
      SELECT RAISE(ABORT, 'account lifecycle fields are inconsistent');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_users_account_lifecycle_consistency_update
    BEFORE UPDATE OF account_status, account_tombstoned_at, is_banned ON users
    WHEN NEW.account_status NOT IN ('active', 'suspended', 'deleted')
      OR (OLD.account_status = 'deleted' AND NEW.account_status <> 'deleted')
      OR (NEW.account_status = 'active' AND NEW.is_banned <> 0)
      OR (NEW.account_status IN ('suspended', 'deleted') AND NEW.is_banned <> 1)
      OR (NEW.account_status = 'deleted' AND (NEW.account_tombstoned_at IS NULL OR trim(NEW.account_tombstoned_at) = ''))
      OR (NEW.account_status <> 'deleted' AND NEW.account_tombstoned_at IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'account lifecycle transition is invalid');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_users_account_tombstone_immutable
    BEFORE UPDATE ON users
    WHEN OLD.account_status = 'deleted' AND (
      NEW.account_status <> 'deleted'
      OR NEW.account_tombstoned_at IS NOT OLD.account_tombstoned_at
      OR NEW.is_admin <> 0
      OR NEW.is_banned <> 1
      OR NEW.name <> '已注销用户'
      OR NEW.password_hash <> '!tombstoned-account'
      OR NEW.email IS NOT NULL
      OR NEW.email_verified_at IS NOT NULL
      OR NEW.avatar IS NOT NULL
      OR COALESCE(NEW.bio, '') <> ''
      OR NEW.avatar_frame <> 'none'
      OR NEW.avatar_overlay <> 'none'
      OR NEW.equipped_title IS NOT NULL
    )
    BEGIN
      SELECT RAISE(ABORT, 'account tombstone is immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_users_physical_delete_forbidden
    BEFORE DELETE ON users
    BEGIN
      SELECT RAISE(ABORT, 'physical user deletion is forbidden; use an account tombstone');
    END;
  `)
}

export const ensureAccountIdentitySchema = async (
  db,
  { generateSubject = createAccountSubject } = {},
) => {
  await db.exec('BEGIN IMMEDIATE')
  try {
    const initialColumns = new Set((await getUserColumns(db)).map((column) => column.name))
    if (!initialColumns.has('id') || !initialColumns.has('is_banned')) {
      throw new Error('users table is missing the legacy identity columns')
    }
    const subjectColumnExisted = initialColumns.has('account_subject')
    const statusColumnExisted = initialColumns.has('account_status')

    if (!subjectColumnExisted) {
      await db.exec(`ALTER TABLE users ADD COLUMN account_subject TEXT`)
    }
    if (!statusColumnExisted) {
      await db.exec(`ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'`)
    }
    if (!initialColumns.has('account_tombstoned_at')) {
      await db.exec(`ALTER TABLE users ADD COLUMN account_tombstoned_at TEXT`)
    }

    if (subjectColumnExisted) {
      const partial = await db.get(
        `SELECT id FROM users
         WHERE account_subject IS NULL OR trim(account_subject) = ''
         LIMIT 1`,
      )
      if (partial) {
        throw new Error(`Partial account identity migration has an empty subject for user ${partial.id}`)
      }
    } else {
      const users = await db.all(`SELECT id FROM users ORDER BY id`)
      const generated = new Set()
      for (const user of users) {
        const subject = generateSubject()
        if (!isAccountSubject(subject)) {
          throw new Error(`Generated account_subject is not a canonical UUID v4 for user ${user.id}`)
        }
        if (generated.has(subject)) {
          throw new Error(`Generated duplicate account_subject conflict for user ${user.id}`)
        }
        generated.add(subject)
        const result = await db.run(
          `UPDATE users SET account_subject = ?
           WHERE id = ? AND account_subject IS NULL`,
          subject,
          user.id,
        )
        if (result.changes !== 1) {
          throw new Error(`Failed to atomically backfill account_subject for user ${user.id}`)
        }
      }
    }

    if (!statusColumnExisted) {
      await db.run(
        `UPDATE users
         SET account_status = CASE WHEN is_banned = 1 THEN 'suspended' ELSE 'active' END,
             account_tombstoned_at = NULL`,
      )
    }

    await verifyAccountIdentityData(db)
    await createProtectionIndexesAndTriggers(db)
    await db.exec('COMMIT')
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    throw error
  }
}
