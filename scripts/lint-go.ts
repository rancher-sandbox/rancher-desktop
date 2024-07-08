/**
 * This script handles linting for go-related files.
 *
 * If any argument is `--fix`, then changes are automatically applied.
 */
import path from 'path';

import { readDependencyVersions } from './lib/dependencies';

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

async function listFiles(...globs: string[]): Promise<string[]> {
  const { stdout } = await spawnFile('git', ['ls-files', ...globs], { stdio: 'pipe' });

  return stdout.split(/\r?\n/).filter(x => x);
}

async function getModules(): Promise<string[]> {
  return (await listFiles('**/go.mod')).map(mod => path.dirname(mod));
}

async function syncModules(fix: boolean): Promise<boolean> {
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
  await Promise.all((await getModules()).map(cwd => spawnFile('go', ['mod', 'tidy'], { stdio: 'inherit', cwd })));
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

async function goLangCILint(fix: boolean): Promise<boolean> {
  const depVersionsPath = path.join('pkg', 'rancher-desktop', 'assets', 'dependencies.yaml');
  const dependencyVersions = await readDependencyVersions(depVersionsPath);

  const args = [
    'run', `github.com/golangci/golangci-lint/cmd/golangci-lint@v${ dependencyVersions['golangci-lint'] }`,
    'run', '--config=.github/workflows/config/.golangci.yaml',
    '--timeout=10m', '--verbose',
  ];
  let success = true;

  if (fix) {
    args.push('--fix');
  }
  if (process.env.GITHUB_ACTIONS) {
    args.push('--out-format=colored-line-number');
  }
  // golangci-lint blocks running in parallel by default (and it's unclear _why_
  // this is necessary).  To be safe, just pass in all of the modules at once
  // and let it go at its own pace.
  const modules = await getModules();

  try {
    await spawnFile('go', [...args, ...modules.map(m => `${ m }/...`)], { stdio: 'inherit' });
  } catch (ex) {
    success = false;
  }

  return success;
}

Promise.all([format(fix), syncModules(fix), goLangCILint(fix)]).then((successes) => {
  if (!successes.every(x => x)) {
    process.exit(1);
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
