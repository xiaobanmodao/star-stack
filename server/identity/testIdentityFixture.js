import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { ensureAccountIdentitySchema } from '../utils/accountIdentityMigration.js'
import { ensureOidcIdentitySchema } from '../utils/oidcIdentityMigration.js'

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/legacy-account-identity.sql',
)

export const TEST_SUBJECTS = Object.freeze({
  alice: '11111111-1111-4111-8111-111111111111',
  banned: '22222222-2222-4222-8222-222222222222',
})

export const openIdentityFixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starstack-identity-test-'))
  const filename = path.join(directory, 'fixture.sqlite')
  const db = await open({ filename, driver: sqlite3.Database })
  const connections = [db]
  await db.exec(await readFile(fixturePath, 'utf8'))
  const generated = [TEST_SUBJECTS.alice, TEST_SUBJECTS.banned]
  await ensureAccountIdentitySchema(db, { generateSubject: () => generated.shift() })
  await ensureOidcIdentitySchema(db)
  return {
    db,
    filename,
    openConnection: async () => {
      const connection = await open({ filename, driver: sqlite3.Database })
      connection.configure('busyTimeout', 5000)
      await connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
      connections.push(connection)
      return connection
    },
    close: async () => {
      for (const connection of connections.reverse()) {
        await connection.close().catch(() => undefined)
      }
      await rm(directory, { recursive: true, force: true })
    },
  }
}
