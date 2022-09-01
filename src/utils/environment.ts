/**
 * Checks if Rancher Desktop is running in a development or test environment
 * @returns True if Rancher Desktop is running in a development or test
 * environment
 */
export const isDevEnv = /^(?:dev|test)/i.test(process.env.NODE_ENV || '');
