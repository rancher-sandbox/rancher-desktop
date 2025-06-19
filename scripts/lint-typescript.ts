/**
 * This script launches ESLint.
 * This is only needed because cross-env does not portably support setting
 * environment variables with spaces in the value.
 */

import { spawnSync } from 'node:child_process';

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';
process.env.NODE_OPTIONS = '--max_old_space_size=8192 --experimental-strip-types';

spawnSync('eslint', [
  '--flag', 'unstable_native_nodejs_ts_config',
  '--report-unused-disable-directives',
  '--max-warnings=0',
  ...process.argv.slice(2)]);
