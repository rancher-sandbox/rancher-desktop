/**
 * Set specific jest.Timeout based on the environment
 */
export function setupJestTimeout() {
  const jestCiTimeout = 60000;
  const jestDevTimeout = 30000;

  if (process.env.CI) {
    jest.setTimeout(jestCiTimeout);
  } else {
    jest.setTimeout(jestDevTimeout);
  }
}
