/**
 * This script launches ESLint.
 * This is only needed because cross-env does not portably support setting
 * environment variables with spaces in the value.
 */

import { simpleSpawn } from './simple_process';

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const command = [
  process.execPath,
  ...process.execArgv,
  '--max_old_space_size=8192',
  '--experimental-strip-types',
  'node_modules/eslint/bin/eslint.js',
  '--flag', 'unstable_native_nodejs_ts_config',
  '--report-unused-disable-directives',
  '--max-warnings=0',
  ...process.argv.slice(2),
];

console.log(command.join(' '));
simpleSpawn(command[0], command.slice(1)).catch(e => {
  console.error(e);
  process.exit(1);
});
