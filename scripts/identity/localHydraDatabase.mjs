import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { assertLocalHydraTestDsn } from './localHydraDsn.mjs'

export const LOCAL_HYDRA_RESET_SQL = `
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'hydra_test has another active database connection';
  END IF;
END
$$;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
COMMIT;
`

const executableName = (name) => process.platform === 'win32' ? `${name}.exe` : name

export const resolveLocalPostgresTool = async ({ hydraBinary, name, override }) => {
  if (override) {
    const resolved = path.resolve(override)
    await access(resolved, constants.X_OK)
    return resolved
  }
  const bundled = path.resolve(
    path.dirname(hydraBinary),
    '..',
    'postgres-prefix',
    'bin',
    executableName(name),
  )
  try {
    await access(bundled, constants.X_OK)
    return bundled
  } catch {
    return executableName(name)
  }
}

export const resetLocalHydraTestDatabase = async ({
  dsn,
  hydraBinary,
  run,
  env = process.env,
}) => {
  assertLocalHydraTestDsn(dsn)
  const psql = await resolveLocalPostgresTool({
    hydraBinary,
    name: 'psql',
    override: env.HYDRA_TEST_PSQL_BINARY,
  })
  const version = await run(psql, ['--version'])
  if (!/\b16\.15\b/.test(version)) {
    throw new Error('Local Hydra protocol gate requires exactly PostgreSQL client 16.15')
  }
  await run(psql, [
    dsn,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    LOCAL_HYDRA_RESET_SQL,
  ])
}
