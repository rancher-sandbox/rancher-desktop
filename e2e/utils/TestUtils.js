/**
 * Set specific jest.Timeout based on the environment
 */
export function setupJestTimeout() {
  if (process.env.CI) {
    jest.setTimeout(60000);
  } else {
    jest.setTimeout(30000);
  }
}
