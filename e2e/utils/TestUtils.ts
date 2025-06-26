/**
 * TestUtils exports functions required for the E2E test specs.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import { expect, _electron, ElectronApplication, TestInfo } from '@playwright/test';
import _, { GetFieldType } from 'lodash';
import { Page } from 'playwright-core';
import plist from 'plist';

import { defaultSettings, LockedSettingsType, Settings } from '@pkg/config/settings';
import { getDefaultMemory } from '@pkg/config/settingsImpl';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import * as childProcess from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';
import { RecursivePartial, RecursiveTypes } from '@pkg/utils/typeUtils';

let currentTest: undefined | {
  file: string,
  startTime: number,
  options: startRancherDesktopOptions,
};

/**
 * Remove any existing user profiles, and set it to the given settings.  If
 * either is `null`, then it is not re-added.
 */
export async function setUserProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';

  if (platform === 'win32') {
    return await setWindowsUserLegacyProfile(userProfile, lockedFields);
  } else if (platform === 'linux') {
    return await setLinuxUserProfile(userProfile, lockedFields);
  } else {
    return await setDarwinUserProfile(userProfile, lockedFields);
  }
}

async function setLinuxUserProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
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

function convertToRegistryLegacy(s: string) {
  return s.replace(/Policies\\Rancher Desktop/g, 'Rancher Desktop\\Profile')
    .replace('SOFTWARE\\Policies]', 'SOFTWARE\\Rancher Desktop]');
}

async function setWindowsUserLegacyProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
  const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-test-profiles'));

  try {
    for (const [registryType, settings] of [['defaults', userProfile], ['locked', lockedFields]] as const) {
      // Always remove existing profiles, since we never want to merge any
      // existing profiles with the new ones.
      try {
        const keyPath = `HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\${ registryType }`;

        await childProcess.spawnFile('reg.exe', ['DELETE', keyPath, '/f'], { stdio: 'pipe' });
      } catch (ex: any) {
        if (!/unable to find/.test(Object(ex).stderr ?? '')) {
          throw new Error(`Error trying to delete a user registry hive: ${ ex }`);
        }
      }

      if (settings && Object.keys(settings).length > 0) {
        const genResult = convertToRegistryLegacy(await tool('rdctl', 'create-profile', '--body', JSON.stringify(settings),
          '--output=reg', '--hive=hkcu', `--type=${ registryType }`));
        const regFile = path.join(workdir, 'test.reg');

        try {
          await fs.promises.writeFile(regFile, genResult);
          await childProcess.spawnFile('reg.exe', ['IMPORT', regFile], { stdio: 'ignore' });
        } catch (ex: any) {
          throw new Error(`Error trying to create a user registry hive: ${ ex }`);
        }
      }
    }
  } finally {
    await fs.promises.rm(workdir, { recursive: true, force: true });
  }
}

async function setDarwinUserProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
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
    virtualMachine: { memoryInGB: getDefaultMemory() },
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
 * @param type What kind of asset this is; defaults to `trace`.
 */
export function reportAsset(testInfo: TestInfo, type: 'trace' | 'log' = 'trace') {
  const testName = testInfo.file;
  let name = `${ path.basename(testName).replace(/(?:\.e2e)(?:\.spec)(?:\.ts)$/, '') }-`;

  if (currentTest?.options?.logVariant) {
    name += `${ currentTest.options.logVariant }-`;
  }
  if (testInfo.retry) {
    name += `try-${ testInfo.retry }-`;
  }
  name += {
    trace: 'pw-trace.zip',
    log:   'logs',
  }[type];

  return path.join(import.meta.dirname, '..', 'reports', name);
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
      // Send SIGTERM to the process group, wait three seconds, then send
      // SIGKILL and wait for one more second.
      for (const [signal, timeout] of [['TERM', 3_000], ['KILL', 1_000]] as const) {
        let pids: string[] = [];

        try {
          const args = ['-o', 'pid=', process.platform === 'darwin' ? '-g' : '--sid', `${ pid }`];
          const { stdout } = await childProcess.spawnFile('ps', args, { stdio: ['ignore', 'pipe', 'inherit'] });

          pids = stdout.trim().split(/\s+/);
        } catch (ex) {
          console.log(`Did not find processes in process group ${ pid }, ignoring.`);
          break;
        }

        try {
          if (pids.length > 0) {
            console.log(`Manually killing group processes ${ pids.join(' ') }`);
            await childProcess.spawnFile('kill', ['-s', signal, ...pids]);
          }
        } catch (ex) {
          console.log(`Failed to process group: ${ ex } (retrying)`);
        }
        await util.promisify(setTimeout)(timeout);
      }
    }
  }
}

export async function teardown(app: ElectronApplication, testInfo: TestInfo) {
  const context = app.context();
  const { file: filename } = testInfo;

  await context.tracing.stop({ path: reportAsset(testInfo) });
  await teardownApp(app);

  if (currentTest?.file === filename) {
    const delta = (Date.now() - currentTest.startTime) / 1_000;
    const min = Math.floor(delta / 60);
    const sec = Math.round(delta % 60);
    const string = min ? `${ min } min ${ sec } sec` : `${ sec } seconds`;

    console.log(`Test ${ path.basename(filename) } took ${ string }.`);
  } else {
    console.log(`Test ${ path.basename(filename) } did not have a start time.`);
  }
}

export function getResourceBinDir(): string {
  const srcDir = path.dirname(import.meta.dirname);

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

export interface startRancherDesktopOptions {
  /** Whether to use the mock backend; defaults to true. */
  mock?: boolean;
  /** The environment to use. */
  env?: Record<string, string>;
  /** Set to false if we want to see the first-run dialog (defaults to true). */
  noModalDialogs?: boolean;
  /** Maximum time in milliseconds to wait for the app to launch. */
  timeout?: number;
  /** A suffix to be added to the log file, for variants. */
  logVariant?: string;
}

/**
 * Run Rancher Desktop; return promise that resolves to commonly-used
 * playwright objects when it has started.
 * @param testPath The path to the test file.
 * @param options Additional options; see type definition for details.
 */
export async function startRancherDesktop(testInfo: TestInfo, options: startRancherDesktopOptions = {}): Promise<ElectronApplication> {
  currentTest = {
    file: testInfo.file, options, startTime: Date.now(),
  };
  const { default: packageMeta } = await import('../../package.json', { with: { type: 'json' } });
  const args = [
    path.join(import.meta.dirname, '../..', packageMeta.main),
    '--disable-gpu',
    '--whitelisted-ips=',
    // See pkg/rancher-desktop/utils/commandLine.ts before changing the next item as the final option.
    '--disable-dev-shm-usage',
  ];
  const logsDir = reportAsset(testInfo, 'log');

  await fs.promises.rm(logsDir, {
    recursive: true, force: true, maxRetries: 3,
  });
  const launchOptions: Parameters<typeof _electron.launch>[0] = {
    args,
    env: {
      ...process.env,
      ...options?.env ?? {},
      RD_LOGS_DIR: logsDir,
      ...options?.mock ?? true ? { RD_MOCK_BACKEND: '1' } : {},
    },
  };

  if (options?.noModalDialogs ?? true) {
    args.push('--no-modal-dialogs');
  }
  if (options?.timeout) {
    launchOptions.timeout = options?.timeout;
  }
  const electronApp = await _electron.launch(launchOptions);

  await electronApp.context().tracing.start({ screenshots: true, snapshots: true });

  return electronApp;
}

export async function startSlowerDesktop(testInfo: TestInfo, defaultSettings: RecursivePartial<Settings> = {}): Promise<[ElectronApplication, Page]> {
  const launchOptions: startRancherDesktopOptions = { mock: false };

  createDefaultSettings(defaultSettings);
  if (process.env.CI) {
    launchOptions.timeout = 120_000; // default is 30_000 msec but the CI is very slow
  }
  const electronApp = await startRancherDesktop(testInfo, launchOptions);
  const page = await electronApp.firstWindow();

  return [electronApp, page];
}
