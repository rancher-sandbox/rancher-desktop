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

type SupportedPlatform = Extract<NodeJS.Platform, 'darwin' | 'linux' | 'win32'>;

const fix = process.argv.includes('--fix');

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

// Run golangci-lint with the given arguments for the given OS, and return
// whether the command succeeded.
async function runGoLangCILint(platform: SupportedPlatform, ...args: string[]): Promise<boolean> {
  const depVersionsPath = path.join('pkg', 'rancher-desktop', 'assets', 'dependencies.yaml');
  const dependencyVersions = await readDependencyVersions(depVersionsPath);
  const commandLine = ['go', 'run'];

  if (process.platform !== platform) {
    // We are emulating a different platform.
    const os = ({
      darwin: 'darwin',
      linux:  'linux',
      win32:  'windows',
    } as const)[platform];

    commandLine.push('-exec', `/usr/bin/env GOOS=${ os }`);
  }
  commandLine.push(
    `github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v${ dependencyVersions['golangci-lint'] }`,
    ...args,
    ...(await getModules()).map(m => `${ m }/...`));

  try {
    console.log(commandLine.join(' '));
    await spawnFile(commandLine[0], commandLine.slice(1), { stdio: 'inherit' });

    return true;
  } catch (ex) {
    return false;
  }
}

function getGoLangCISupportedPlatforms(): SupportedPlatform[] {
  // On Windows, we can't pretend to be other platforms (due to a lack of
  // /usr/bin/env).  Also don't do that in CI, because we run all platforms
  // natively.
  if (!process.env.CI && process.platform !== 'win32') {
    return ['darwin', 'linux', 'win32'];
  }

  return [process.platform] as SupportedPlatform[];
}

function goLangCIFormat(fix: boolean): Promise<boolean> {
  const args = ['fmt', '--verbose'];

  if (!fix) {
    // When not fixing, provide `--diff`; this causes the process to exit with
    // and error when a fix is required.
    args.push('--diff');
  }

  // We don't need to run fmt for all platforms, since it seems to format files
  // whether they would be built.
  return runGoLangCILint(process.platform as SupportedPlatform, ...args);
}

async function goLangCILint(fix: boolean): Promise<boolean> {
  const args = ['run', '--timeout=10m', '--allow-serial-runners', '--verbose'];

  if (fix) {
    args.push('--fix');
  }

  for (const platform of getGoLangCISupportedPlatforms()) {
    if (!(await runGoLangCILint(platform, ...args))) {
      return false;
    }
  }

  return true;
}

interface dependabotConfig {
  version: 2,
  updates: {
    'package-ecosystem':        string;
    directory:                  string;
    directories:                string[];
    schedule:                   { interval: 'daily' };
    'open-pull-requests-limit': number;
    labels:                     string[];
    ignore?:                    { 'dependency-name': string; 'update-types'?: string[]; version?: string[] }[];
    reviewers?:                 string[];
  }[];
}

// Run lint and format in series, for better output.
async function lintAndFormat(fix: boolean): Promise<boolean> {
  return await goLangCIFormat(fix) && await goLangCILint(fix);
}

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

Promise.all([syncModules, lintAndFormat, checkDependabot].map(fn => fn(fix))).then((successes) => {
  if (!successes.every(x => x)) {
    process.exit(1);
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
