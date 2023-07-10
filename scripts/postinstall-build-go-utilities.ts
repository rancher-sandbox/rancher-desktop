import buildUtils from './lib/build-utils';
import { simpleSpawn } from 'scripts/simple_process';

// The main purpose of this setTimeout is to keep the script waiting until the main async function finishes
const keepScriptAlive = setTimeout(() => { }, 24 * 3600 * 1000);

(async() => {
  let exitCode = 2;

  try {
    await simpleSpawn('node', ['scripts/ts-wrapper.js',
      'scripts/generateCliCode.ts',
      'pkg/rancher-desktop/assets/specs/command-api.yaml',
      'src/go/rdctl/pkg/options/generated/options.go'],
    { stdio: 'inherit' });
    await buildUtils.buildGoUtilities();
    exitCode = 0;
  } catch (e: any) {
    console.error('POSTINSTALL ERROR: ', e);
  } finally {
    clearTimeout(keepScriptAlive);
    process.exit(exitCode);
  }
})();
