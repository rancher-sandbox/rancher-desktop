/**
 * This script handles linting for go-related files.
 *
 * If any argument is `--fix`, then changes are automatically applied.
 */
import fs from 'fs';
import path from 'path';

import { glob } from 'glob';
import yaml from 'yaml';

import { readDependencyVersions } from './lib/dependencies';

import { spawnFile } from '@pkg/utils/childProcess';

const fix = process.argv.includes('--fix');

async function format(fix: boolean): Promise<boolean> {
  if (fix) {
    await spawnFile('gofmt', ['-w', ...await getModules()]);
  } else {
    // `gofmt -d` never exits with an error; we need to check if the output is
    // empty instead.
    const { stdout } = await spawnFile('gofmt', ['-d', ...await getModules()], { stdio: 'pipe' });

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
  const commandLine = ['go', ...args, ...modules.map(m => `${ m }/...`)];

  try {
    console.log(commandLine.join(' '));
    await spawnFile(commandLine[0], commandLine.slice(1), { stdio: 'inherit' });
  } catch (ex) {
    success = false;
  }

  return success;
}

type dependabotConfig = {
  version: 2,
  updates: {
    'package-ecosystem': string;
    directory: string;
    directories: string[];
    schedule: { interval: 'daily' };
    'open-pull-requests-limit': number;
    labels: string[];
    ignore?: {'dependency-name': string; 'update-types'?: string[]; version?: string[] }[];
    reviewers?: string[];
  }[];
};

async function checkDependabot(fix: boolean): Promise<boolean> {
  const configs: dependabotConfig = yaml.parse(await fs.promises.readFile('.github/dependabot.yml', 'utf8'));
  const modules = await getModules();
  const dependabotDirs = configs.updates.filter(x => x['package-ecosystem'] === 'gomod').flatMap(x => x.directories || x.directory);
  const globInputs = dependabotDirs.map(d => `${ d.replace(/^\//, '') }/go.mod`);
  const globOutputs = await glob(globInputs);
  const dependabotModules = globOutputs.map(f => path.dirname(f.replaceAll(path.sep, '/')));
  const missing = modules.filter(x => !dependabotModules.includes(x));

  if (missing.length > 0) {
    const message = ['\x1B[0;1;31m Go modules not listed in dependabot:\x1B[0m'].concat(missing);

    console.error(message.join('\n   '));

    return false;
  }

  return true;
}

Promise.all([format, syncModules, goLangCILint, checkDependabot].map(fn => fn(fix))).then((successes) => {
  if (!successes.every(x => x)) {
    process.exit(1);
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
