/**
 * This script handles linting for go-related files.
 *
 * If any argument is `--fix`, then changes are automatically applied.
 */
import path from 'path';

import { spawnFile } from '@pkg/utils/childProcess';

const fix = process.argv.includes('--fix');

async function format(fix: boolean): Promise<boolean> {
  if (fix) {
    await spawnFile('gofmt', ['-w', 'src/go']);
  } else {
    // `gofmt -d` never exits with an error; we need to check if the output is
    // empty instead.
    const { stdout } = await spawnFile('gofmt', ['-d', 'src/go'], { stdio: 'pipe' });

    if (stdout.trim()) {
      console.log(stdout.trim());

      return false;
    }
  }

  return true;
}

async function syncModules(fix: boolean): Promise<boolean> {
  const listFiles = async(...globs: string[]) => {
    const { stdout } = await spawnFile('git', ['ls-files', ...globs], { stdio: 'pipe' });

    return stdout.split(/\r?\n/).filter(x => x);
  };
  const modFiles = await listFiles('**/go.mod');
  const files = ['go.work', ...modFiles, ...await listFiles('**/go.sum')];
  const getChanges = async() => {
    const { stdout } = await spawnFile('git', ['status', '--porcelain=1', '--', ...files], { stdio: 'pipe' });

    return stdout.replace(/^\s+/, '').replace(/\s+$/, '');
  };

  if (!fix) {
    const changes = await getChanges();

    if (changes) {
      console.log('Cannot run lint without fix with local changes');
      console.log(changes);

      return false;
    }
  }

  await spawnFile('go', ['work', 'sync']);
  await Promise.all(modFiles.map(modFile => spawnFile('go', ['mod', 'tidy'], { stdio: 'inherit', cwd: path.dirname(modFile) })));
  if (!fix) {
    const changes = await getChanges();

    if (changes) {
      const { stdout } = await spawnFile('git', ['diff', '--', ...files], { stdio: 'pipe' });

      console.log('Had to make modifications');
      console.log(changes);
      console.log(stdout);

      return false;
    }
  }

  return true;
}

Promise.all([format(fix), syncModules(fix)]).then((successes) => {
  if (!successes.every(x => x)) {
    process.exit(1);
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
