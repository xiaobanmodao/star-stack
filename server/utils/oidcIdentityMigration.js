const REQUIRED_TABLE_COLUMNS = Object.freeze({
  account_center_sessions: [
    'token_hash', 'user_id', 'account_subject', 'auth_generation', 'csrf_hash',
    'created_at', 'expires_at', 'last_seen_at',
  ],
  oidc_interactions: [
    'challenge_hash', 'interaction_type', 'account_session_hash', 'account_subject',
    'client_id', 'csrf_hash', 'status', 'created_at', 'expires_at', 'consumed_at',
  ],
  oidc_login_sessions: [
    'id', 'account_subject', 'client_id', 'sid', 'auth_generation',
    'consent_request_id', 'status', 'created_at', 'updated_at', 'expires_at', 'revoked_at',
  ],
  identity_outbox: [
    'id', 'event_type', 'subject', 'client_id', 'sid', 'payload_json', 'status',
    'attempts', 'next_attempt_at', 'last_error', 'dedupe_key', 'created_at',
    'updated_at', 'completed_at',
  ],
  oidc_logout_transactions: [
    'token_hash', 'account_subject', 'client_id', 'sid', 'state',
    'account_session_hash', 'browser_csrf_hash', 'status', 'created_at', 'expires_at', 'bound_at',
    'consumed_at',
  ],
})

const REQUIRED_INDEXES = Object.freeze([
  'idx_account_center_sessions_subject',
  'idx_account_center_sessions_expires',
  'idx_oidc_interactions_expires',
  'idx_oidc_login_sessions_subject_status',
  'idx_oidc_login_sessions_client_sid',
  'idx_oidc_login_sessions_status_updated',
  'idx_oidc_login_sessions_status_expires',
  'idx_identity_outbox_due',
  'idx_identity_outbox_subject',
  'idx_oidc_logout_transactions_expires',
])

const getColumns = async (db, table) => db.all(`PRAGMA table_info(${table})`)

const assertGenerationData = async (db) => {
  const invalid = await db.get(
    `SELECT id, auth_generation FROM users
     WHERE auth_generation IS NULL
        OR typeof(auth_generation) <> 'integer'
        OR auth_generation < 0
     LIMIT 1`,
  )
  if (invalid) {
    throw new Error(`Invalid or partial users.auth_generation for user ${invalid.id}`)
  }
}

const assertTableShape = async (db, table, requiredColumns) => {
  const columns = new Set((await getColumns(db, table)).map((column) => column.name))
  const missing = requiredColumns.filter((column) => !columns.has(column))
  if (missing.length > 0) {
    throw new Error(`Incompatible ${table} schema; missing columns: ${missing.join(', ')}`)
  }
}

export const verifyOidcIdentitySchema = async (db) => {
  const userColumns = new Set((await getColumns(db, 'users')).map((column) => column.name))
  if (!userColumns.has('auth_generation')) throw new Error('Missing users.auth_generation')
  await assertGenerationData(db)

  for (const [table, columns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
    await assertTableShape(db, table, columns)
  }

  const indexRows = await db.all(`SELECT name FROM sqlite_master WHERE type = 'index'`)
  const indexes = new Set(indexRows.map((row) => row.name))
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexes.has(name))
  if (missingIndexes.length > 0) {
    throw new Error(`Missing OIDC identity indexes: ${missingIndexes.join(', ')}`)
  }
  const invalidLoginSessionExpiry = await db.get(
    `SELECT id FROM oidc_login_sessions
     WHERE expires_at IS NULL OR trim(expires_at) = '' OR julianday(expires_at) IS NULL
     LIMIT 1`,
  )
  if (invalidLoginSessionExpiry) {
    throw new Error(`Invalid oidc_login_sessions.expires_at for row ${invalidLoginSessionExpiry.id}`)
  }

  const [users, accountCenterSessions, loginSessions, outboxEvents, logoutTransactions] = await Promise.all([
    db.get(`SELECT COUNT(*) AS count FROM users`),
    db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`),
    db.get(`SELECT COUNT(*) AS count FROM oidc_login_sessions`),
    db.get(`SELECT COUNT(*) AS count FROM identity_outbox`),
    db.get(`SELECT COUNT(*) AS count FROM oidc_logout_transactions`),
  ])
  return {
    users: users.count,
    accountCenterSessions: accountCenterSessions.count,
    loginSessions: loginSessions.count,
    outboxEvents: outboxEvents.count,
    logoutTransactions: logoutTransactions.count,
  }
}

const createSchema = async (db) => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS account_center_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_subject TEXT NOT NULL,
      auth_generation INTEGER NOT NULL CHECK (auth_generation >= 0),
      csrf_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS oidc_interactions (
      challenge_hash TEXT PRIMARY KEY,
      interaction_type TEXT NOT NULL CHECK (interaction_type IN ('login', 'consent')),
      account_session_hash TEXT,
      account_subject TEXT,
      client_id TEXT NOT NULL,
      csrf_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'bound', 'processing', 'accepted', 'rejected', 'expired')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      FOREIGN KEY (account_session_hash) REFERENCES account_center_sessions(token_hash) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS oidc_login_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_subject TEXT NOT NULL,
      client_id TEXT NOT NULL,
      sid TEXT NOT NULL,
      auth_generation INTEGER NOT NULL CHECK (auth_generation >= 0),
      consent_request_id TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('authorization_pending', 'active', 'revocation_pending', 'revoked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      UNIQUE(client_id, sid)
    );

    CREATE TABLE IF NOT EXISTS identity_outbox (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      client_id TEXT,
      sid TEXT,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'dead')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      dedupe_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS oidc_logout_transactions (
      token_hash TEXT PRIMARY KEY,
      account_subject TEXT NOT NULL,
      client_id TEXT NOT NULL,
      sid TEXT NOT NULL,
      state TEXT NOT NULL,
      account_session_hash TEXT,
      browser_csrf_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'bound', 'processing', 'consumed', 'expired')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      bound_at TEXT,
      consumed_at TEXT,
      UNIQUE(client_id, state),
      FOREIGN KEY (account_session_hash) REFERENCES account_center_sessions(token_hash) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_account_center_sessions_subject
      ON account_center_sessions(account_subject, auth_generation);
    CREATE INDEX IF NOT EXISTS idx_account_center_sessions_expires
      ON account_center_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_oidc_interactions_expires
      ON oidc_interactions(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_oidc_login_sessions_subject_status
      ON oidc_login_sessions(account_subject, status);
    CREATE INDEX IF NOT EXISTS idx_oidc_login_sessions_client_sid
      ON oidc_login_sessions(client_id, sid);
    CREATE INDEX IF NOT EXISTS idx_oidc_login_sessions_status_updated
      ON oidc_login_sessions(status, updated_at, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_identity_outbox_due
      ON identity_outbox(status, next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_identity_outbox_subject
      ON identity_outbox(subject, status);
    CREATE INDEX IF NOT EXISTS idx_oidc_logout_transactions_expires
      ON oidc_logout_transactions(status, expires_at);

    CREATE TRIGGER IF NOT EXISTS trg_users_auth_generation_valid_insert
    BEFORE INSERT ON users
    WHEN NEW.auth_generation IS NULL
      OR typeof(NEW.auth_generation) <> 'integer'
      OR NEW.auth_generation < 0
    BEGIN
      SELECT RAISE(ABORT, 'auth_generation must be a non-negative integer');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_users_auth_generation_monotonic
    BEFORE UPDATE OF auth_generation ON users
    WHEN NEW.auth_generation IS NULL
      OR typeof(NEW.auth_generation) <> 'integer'
      OR NEW.auth_generation < OLD.auth_generation
    BEGIN
      SELECT RAISE(ABORT, 'auth_generation must be monotonic');
    END;
  `)
}

const addKnownCompatibilityColumns = async (db) => {
  const upgrades = [
    ['oidc_interactions', 'csrf_hash', 'TEXT'],
    ['oidc_logout_transactions', 'browser_csrf_hash', 'TEXT'],
    ['oidc_login_sessions', 'expires_at', 'TEXT'],
  ]
  for (const [table, column, type] of upgrades) {
    const columns = new Set((await getColumns(db, table)).map((item) => item.name))
    if (!columns.has(column)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

export const ensureOidcIdentitySchema = async (db) => {
  await db.exec('BEGIN IMMEDIATE')
  try {
    const userColumns = new Set((await getColumns(db, 'users')).map((column) => column.name))
    if (!userColumns.has('account_subject') || !userColumns.has('account_status')) {
      throw new Error('OIDC identity migration requires the account identity migration first')
    }

    if (!userColumns.has('auth_generation')) {
      await db.exec(`ALTER TABLE users ADD COLUMN auth_generation INTEGER NOT NULL DEFAULT 0`)
    } else {
      await assertGenerationData(db)
    }

    await createSchema(db)
    await addKnownCompatibilityColumns(db)
    await db.run(
      `UPDATE oidc_login_sessions
       SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+30 days')
       WHERE expires_at IS NULL OR trim(expires_at) = ''`,
    )
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_oidc_login_sessions_status_expires
        ON oidc_login_sessions(status, expires_at);
    `)
    await verifyOidcIdentitySchema(db)
    await db.exec('COMMIT')
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    throw error
  }
}
