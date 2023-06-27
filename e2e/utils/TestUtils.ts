/**
 * TestUtils exports functions required for the E2E test specs.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import { expect, _electron, ElectronApplication } from '@playwright/test';
import _, { GetFieldType } from 'lodash';
import plist from 'plist';

import { defaultSettings, LockedSettingsType, Settings } from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import * as childProcess from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';
import { RecursivePartial, RecursiveTypes } from '@pkg/utils/typeUtils';

let testInfo: undefined | {
  testPath: string;
  startTime: number;
};

export async function createUserProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';

  if (platform === 'win32') {
    throw new Error(`Not doing win32 profiles yet`);
  } else if (platform === 'linux') {
    return await createLinuxUserProfile(userProfile, lockedFields);
  } else {
    return await createDarwinUserProfile(userProfile, lockedFields);
  }
}

async function createLinuxUserProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
  const userProfilePath = path.join(paths.deploymentProfileUser, 'rancher-desktop.defaults.json');
  const userLocksPath = path.join(paths.deploymentProfileUser, 'rancher-desktop.locked.json');

  if (userProfile && Object.keys(userProfile).length > 0) {
    await fs.promises.writeFile(userProfilePath, JSON.stringify(userProfile, undefined, 2));
  } else {
    await fs.promises.rm(userProfilePath, { force: true });
  }
  if (lockedFields && Object.keys(lockedFields).length > 0) {
    await fs.promises.writeFile(userLocksPath, JSON.stringify(lockedFields, undefined, 2));
  } else {
    await fs.promises.rm(userLocksPath, { force: true });
  }
}

async function createDarwinUserProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
  const userProfilePath = path.join(paths.deploymentProfileUser, 'io.rancherdesktop.profile.defaults.plist');
  const userLocksPath = path.join(paths.deploymentProfileUser, 'io.rancherdesktop.profile.locked.plist');

  if (userProfile && Object.keys(userProfile).length > 0) {
    // plist.build() seems to have issues with RecursivePartial<Record<string, string>>, hence cast.
    await fs.promises.writeFile(userProfilePath, plist.build(userProfile as any));
  } else {
    await fs.promises.rm(userProfilePath, { force: true });
  }
  if (lockedFields && Object.keys(lockedFields).length > 0) {
    await fs.promises.writeFile(userLocksPath, plist.build(lockedFields));
  } else {
    await fs.promises.rm(userLocksPath, { force: true });
  }
}

/**
 * Create empty default settings to bypass gracefully
 * FirstPage window.
 */
export function createDefaultSettings(overrides: RecursivePartial<Settings> = {}) {
  const defaultOverrides: RecursivePartial<Settings> = {
    kubernetes:  { enabled: true },
    application: {
      debug:                  true,
      pathManagementStrategy: PathManagementStrategy.Manual,
      startInBackground:      false,
    },
  };
  const settingsData: Settings = _.merge({}, defaultSettings, defaultOverrides, overrides);

  const settingsJson = JSON.stringify(settingsData);
  const fileSettingsName = 'settings.json';
  const settingsFullPath = path.join(paths.config, fileSettingsName);

  if (!fs.existsSync(settingsFullPath)) {
    fs.mkdirSync(paths.config, { recursive: true });
    fs.writeFileSync(path.join(paths.config, fileSettingsName), settingsJson);
    console.log(`Default settings file successfully created at ${ paths.config }/${ fileSettingsName }`);
  } else {
    try {
      const contents = fs.readFileSync(settingsFullPath, { encoding: 'utf-8' });
      const settings: Settings = JSON.parse(contents.toString());
      const desiredSettings: Settings = _.merge({}, settings, defaultOverrides, overrides);

      if (!_.eq(settings, desiredSettings)) {
        fs.writeFileSync(settingsFullPath, JSON.stringify(desiredSettings), { encoding: 'utf-8' });
      }
    } catch (err) {
      console.log(`Failed to process ${ settingsFullPath }: ${ err }`);
    }
  }
}

/**
 * getAlternateSetting returns the setting that isn't the same as the existing setting.
 */
export function getAlternateSetting<K extends keyof RecursiveTypes<Settings>>(currentSettings: Settings, setting: K, altOne: GetFieldType<Settings, K>, altTwo: GetFieldType<Settings, K>) {
  return _.get(currentSettings, setting) === altOne ? altTwo : altOne;
}

/**
 * Calculate the path of an asset that should be attached to a test run.
 * @param testPath The path to the test file.
 * @param type What kind of asset this is.
 */
export function reportAsset(testPath: string, type: 'trace' | 'log' = 'trace') {
  const name = {
    trace: 'pw-trace.zip',
    log:   'logs',
  }[type];

  // Note that CirrusCI doesn't upload folders...
  return path.join(__dirname, '..', 'reports', `${ path.basename(testPath) }-${ name }`);
}

export async function packageLogs(testPath: string) {
  if (!process.env.CIRRUS_CI) {
    console.log('Skipping packaging logs, not running in Cirrus CI');

    return;
  }
  const logDir = reportAsset(testPath, 'log');
  const outputPath = path.join(__dirname, '..', 'reports', `${ path.basename(testPath) }-logs.tar`);

  console.log(`Packaging logs to ${ outputPath }...`);
  await childProcess.spawnFile('tar', ['cfh', outputPath, '.'], { cwd: logDir, stdio: 'inherit' });
}

/**
 * Tear down the application, without managing logging.  This should only be
 * used when doing atypical tests that need to restart the application within
 * the test.  This is normally used instead of `app.close()`.
 *
 * @note teardown() should be used where possible.
 */
export async function teardownApp(app: ElectronApplication) {
  const proc = app.process();
  const pid = proc.pid;

  try {
    // Allow one minute for shutdown
    await Promise.race([
      app.close(),
      util.promisify(setTimeout)(60 * 1000),
    ]);
    await tool('rdctl', 'shutdown');
  } finally {
    if (proc.kill('SIGTERM') || proc.kill('SIGKILL')) {
      console.log(`Manually stopped process ${ pid }`);
    }
    // Try to do platform-specific killing based on process groups
    if (process.platform === 'darwin' || process.platform === 'linux') {
      for (const signal of ['TERM', 'TERM', 'TERM', 'KILL']) {
        let pids = '';

        try {
          const args = ['-o', 'pid=', process.platform === 'darwin' ? '-g' : '--sid', `${ pid }`];

          pids = (await childProcess.spawnFile('ps', args, { stdio: ['ignore', 'pipe', 'inherit'] })).stdout;
        } catch (ex) {
          console.log(`Did not find processes in process group, ignoring.`);
          break;
        }

        try {
          if (pids.trim()) {
            console.log(`Manually killing group processes ${ pids.replace(/\r?\n/g, ' ').trim() }`);
            await childProcess.spawnFile('kill', ['-s', signal].concat(...pids.split(/\s+/).filter(p => p)));
          }
        } catch (ex) {
          console.log(`Failed to process group: ${ ex } (retrying)`);
        }
        await util.promisify(setTimeout)(1_000);
      }
    }
  }
}

export async function teardown(app: ElectronApplication, filename: string) {
  const context = app.context();

  await context.tracing.stop({ path: reportAsset(filename) });
  await packageLogs(filename);
  await teardownApp(app);

  if (testInfo?.testPath === filename) {
    const delta = (Date.now() - testInfo.startTime) / 1_000;
    const min = Math.floor(delta / 60);
    const sec = Math.round(delta % 60);
    const string = min ? `${ min } min ${ sec } sec` : `${ sec } seconds`;

    console.log(`Test ${ path.basename(filename) } took ${ string }.`);
  } else {
    console.log(`Test ${ path.basename(filename) } did not have a start time.`);
  }
}

/**
 * helm teardown
 * it ensure that all helm test installation contents will be deleted.
 */
export async function tearDownHelm() {
  await helm('repo', 'remove', 'bitnami');
  await kubectl('delete', 'deploy', 'nginx-sample', '--namespace', 'default');
}

export function getResourceBinDir(): string {
  const srcDir = path.dirname(__dirname);

  return path.join(srcDir, '..', 'resources', os.platform(), 'bin');
}

export function getFullPathForTool(tool: string): string {
  const filename = os.platform().startsWith('win') ? `${ tool }.exe` : tool;

  return path.join(getResourceBinDir(), filename);
}

/**
 * Run the given tool with the given arguments, returning its standard output.
 */
export async function tool(tool: string, ...args: string[]): Promise<string> {
  const exe = getFullPathForTool(tool);

  try {
    const { stdout } = await childProcess.spawnFile(exe, args, {
      env: {
        ...process.env,
        PATH: `${ process.env.PATH }${ path.delimiter }${ getResourceBinDir() }`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return stdout;
  } catch (ex:any) {
    console.error(`Error running ${ tool } ${ args.join(' ') }`);
    console.error(`stdout: ${ ex.stdout }`);
    console.error(`stderr: ${ ex.stderr }`);
    // This expect(...).toBeUndefined() will always fail; we just want to make
    // playwright print out the stdout and stderr along with the message.
    // Normally, it would just print out `ex.toString()`, which mostly just says
    // "<command> exited with code 1" and doesn't explain _why_ that happened.
    expect({
      stdout: ex.stdout, stderr: ex.stderr, message: ex.toString(),
    }).toBeUndefined();
    throw ex;
  }
}

/**
 * Run `kubectl` with given arguments.
 * @returns standard output of the command.
 * @example await kubectl('version')
 */
export async function kubectl(...args: string[] ): Promise<string> {
  return await tool('kubectl', '--context', 'rancher-desktop', ...args);
}

/**
 * Run `helm` with given arguments.
 * @returns standard output of the command.
 * @example await helm('version')
 */
export async function helm(...args: string[] ): Promise<string> {
  return await tool('helm', '--kube-context', 'rancher-desktop', ...args);
}

export async function retry<T>(proc: () => Promise<T>, options?: { delay?: number, tries?: number }): Promise<T> {
  const delay = options?.delay ?? 500;
  const tries = options?.tries ?? 30;

  for (let i = 1; ; ++i) {
    try {
      return await proc();
    } catch (ex) {
      if (i >= tries) {
        console.log(`${ tries } tries exceeding, failing.`);
        throw ex;
      }
      console.error(`${ ex }, retrying... (${ i }/${ tries })`);
      await util.promisify(setTimeout)(delay);
    }
  }
}

/**
 * Run Rancher Desktop; return promise that resolves to commonly-used
 * playwright objects when it has started.
 * @param testPath The path to the test file.
 * @param options.tracing Whether to start tracing (defaults to true).
 * @param options.mock Whether to use the mock backend (defaults to true).
 */
export async function startRancherDesktop(testPath: string, options?: { tracing?: boolean, mock?: boolean, env?: Record<string, string> }): Promise<ElectronApplication> {
  testInfo = { testPath, startTime: Date.now() };

  const electronApp = await _electron.launch({
    args: [
      path.join(__dirname, '../../'),
      '--disable-gpu',
      '--whitelisted-ips=',
      // See pkg/rancher-desktop/utils/commandLine.ts before changing the next item as the final option.
      '--disable-dev-shm-usage',
      '--no-modal-dialogs',
    ],
    env: {
      ...process.env,
      ...options?.env ?? {},
      RD_LOGS_DIR: reportAsset(testPath, 'log'),
      ...options?.mock ?? true ? { RD_MOCK_BACKEND: '1' } : {},
    },
  });

  if (options?.tracing ?? true) {
    await electronApp.context().tracing.start({ screenshots: true, snapshots: true });
  }

  return electronApp;
}
