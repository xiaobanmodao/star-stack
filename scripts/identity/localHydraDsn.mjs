export const LOCAL_HYDRA_TEST_DSN = 'postgres://hydra_test@127.0.0.1:55432/hydra_test?sslmode=disable'

export const assertLocalHydraTestDsn = (value) => {
  if (value !== LOCAL_HYDRA_TEST_DSN) {
    throw new Error(
      'HYDRA_TEST_DSN must exactly match the isolated local hydra_test database '
      + '(127.0.0.1:55432, passwordless hydra_test user/database, sslmode=disable)',
    )
  }
  return value
}
