// Deployment-profile-related utilities

import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import { expect, Page, TestInfo } from '@playwright/test';

import {
  createDefaultSettings, setUserProfile, startRancherDesktop, retry, teardown, reportAsset, startRancherDesktopOptions,
} from './TestUtils';
import { NavPage } from '../pages/nav-page';

import { CURRENT_SETTINGS_VERSION } from '@pkg/config/settings';
import * as childProcess from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';

export async function clearSettings(): Promise<void> {
  const fullPath = path.join(paths.config, 'settings.json');

  await fs.promises.rm(fullPath, { force: true });
}

export async function clearUserProfile(): Promise<void> {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';

  if (platform === 'win32') {
    return await verifyNoRegistrySubtree('HKCU');
  }
  const profilePaths = getDeploymentPaths(platform, paths.deploymentProfileUser);

  for (const fullPath of profilePaths) {
    await fs.promises.rm(fullPath, { force: true });
  }
}

async function fileExists(fullPath: string): Promise<boolean> {
  try {
    await fs.promises.access(fullPath);

    return true;
  } catch { }

  return false;
}

function getDeploymentBaseNames(platform: 'linux'|'darwin'): string[] {
  if (platform === 'linux') {
    return ['rancher-desktop.defaults.json', 'rancher-desktop.locked.json'];
  } else if (platform === 'darwin') {
    return ['io.rancherdesktop.profile.defaults.plist', 'io.rancherdesktop.profile.locked.plist'];
  } else {
    throw new Error(`Unexpected platform ${ platform }`);
  }
}

function getDeploymentPaths(platform: 'linux'|'darwin', profileDir: string): string[] {
  let baseNames = getDeploymentBaseNames(platform);

  if (platform === 'linux' && profileDir === paths.deploymentProfileSystem) {
    // macOS profile base-names are the same in both directories
    // linux ones change...
    baseNames = baseNames.map(s => s.replace('rancher-desktop.', ''));
  }

  return baseNames.map(baseName => path.join(profileDir, baseName));
}

async function hasSystemRegistrySubtree(): Promise<boolean> {
  for (const profileType of ['defaults', 'locked']) {
    for (const variant of ['Policies\\Rancher Desktop', 'Rancher Desktop\\Profile']) {
      try {
        const { stdout } = await childProcess.spawnFile('reg',
          ['query', `HKLM\\SOFTWARE\\${ variant }\\${ profileType }`],
          { stdio: ['ignore', 'pipe', 'pipe'] });

        if (stdout.length > 0) {
          return true;
        }
      } catch { }
    }
  }

  return false;
}

export async function verifySystemRegistrySubtree(): Promise<string[]> {
  if (await hasSystemRegistrySubtree()) {
    return [];
  } else {
    return [`Need to add registry subtree "HKLM\\SOFTWARE\\Policies\\Rancher Desktop\\<defaults or locked>"`];
  }
}

export async function verifySettings(): Promise<void> {
  const fullPath = path.join(paths.config, 'settings.json');

  if (!await fileExists(fullPath)) {
    createDefaultSettings();
  }
}

export async function verifyNoRegistrySubtree(hive: string): Promise<void> {
  for (const variant of ['Policies\\Rancher Desktop', 'Rancher Desktop\\Profile']) {
    const registryPath = `${ hive }\\SOFTWARE\\${ variant }`;

    try {
      const { stdout } = await childProcess.spawnFile('reg',
        ['query', registryPath],
        { stdio: ['ignore', 'pipe', 'pipe'] });

      if (stdout.length === 0) {
        continue;
      }
    } catch {
      continue;
    }
    try {
      await childProcess.spawnFile('reg', ['delete', registryPath, '/f'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (ex: any) {
      throw new Error(`Need to remove registry hive "${ registryPath }" (tried, got error ${ ex }`);
    }
  }
}

export async function verifyUserProfile(): Promise<void> {
  await clearUserProfile();
  await setUserProfile({ version: 10 as typeof CURRENT_SETTINGS_VERSION, containerEngine: { allowedImages: { enabled: true } } }, null);
}

export async function verifyNoSystemProfile(): Promise<string[]> {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';

  if (platform === 'win32') {
    try {
      await verifyNoRegistrySubtree('HKLM');

      return [];
    } catch (ex: any) {
      return [ex.message];
    }
  }
  const profilePaths = getDeploymentPaths(platform as 'linux'|'darwin', paths.deploymentProfileSystem);
  const existingProfiles = [];

  for (const profilePath of profilePaths) {
    if (await fileExists(profilePath)) {
      existingProfiles.push(`Need to delete system profile ${ profilePath }`);
    }
  }

  return existingProfiles;
}

export async function verifySystemProfile(): Promise<string[]> {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';

  if (platform === 'win32') {
    return await verifySystemRegistrySubtree();
  }
  const profilePaths = getDeploymentPaths(platform, paths.deploymentProfileSystem);

  for (const profilePath of profilePaths) {
    if (await fileExists(profilePath)) {
      return [];
    }
  }

  return [`Need to create system profile file ${ profilePaths.join(' and/or ') }`];
}

/**
 * Start Rancher Desktop, expecting a first run window to show up; accept it,
 * then wait for the main window to open.
 */
export async function testForFirstRunWindow(testInfo: TestInfo, options: startRancherDesktopOptions) {
  let page: Page|undefined;
  let navPage: NavPage;
  let windowCount = 0;
  let windowCountForMainPage = 0;
  const electronApp = await startRancherDesktop(testInfo, {
    ...options, mock: false, noModalDialogs: false, timeout: 60_000,
  });

  electronApp.on('window', async(openedPage: Page) => {
    windowCount += 1;
    if (windowCount === 1) {
      await retry(async() => {
        const button = openedPage.getByText('OK');

        if (button) {
          await button.click({ timeout: 10_000 });
        }
      }, { delay: 100, tries: 50 });

      return;
    }
    navPage = new NavPage(openedPage);

    try {
      await retry(async() => {
        await expect(navPage.mainTitle).toHaveText('Welcome to Rancher Desktop by SUSE');
      });
      page = openedPage;
      windowCountForMainPage = windowCount;
    } catch (ex: any) {
      console.log(`Ignoring failed title-test: ${ ex.toString().substring(0, 10000) }`);
    }
  });
  try {
    let iter = 0;
    const start = new Date().valueOf();
    const limit = 900 * 1_000 + start;

    // eslint-disable-next-line no-unmodified-loop-condition
    while (page === undefined) {
      const now = new Date().valueOf();

      iter += 1;
      if (iter % 100 === 0) {
        console.log(`waiting for main window, iter ${ iter }...`);
      }
      if (now > limit) {
        throw new Error(`timed out waiting for ${ limit / 1000 } seconds`);
      }
      await util.promisify(setTimeout)(100);
    }
    expect(windowCountForMainPage).toEqual(2);
  } finally {
    await teardown(electronApp, testInfo);
  }
}

/**
 * Start Rancher Desktop, checking that there was no first run window (and that
 * the first window to appear is the main window).
 */
export async function testForNoFirstRunWindow(testInfo: TestInfo, options: startRancherDesktopOptions) {
  let page: Page|undefined;
  let navPage: NavPage;
  let windowCount = 0;
  let windowCountForMainPage = 0;
  const electronApp = await startRancherDesktop(testInfo, {
    ...options, mock: false, noModalDialogs: false, timeout: 60_000,
  });

  electronApp.on('window', async(openedPage: Page) => {
    windowCount += 1;
    navPage = new NavPage(openedPage);

    await expect(async() => {
      await expect(navPage.mainTitle).toHaveText('Welcome to Rancher Desktop by SUSE');
    }).toPass({ timeout: 60_000 });
    page = openedPage;
    windowCountForMainPage = windowCount;
  });
  try {
    let iter = 0;
    const start = new Date().valueOf();
    const limit = 900 * 1_000 + start;

    // eslint-disable-next-line no-unmodified-loop-condition
    while (page === undefined) {
      const now = new Date().valueOf();

      iter += 1;
      if (iter % 100 === 0) {
        console.log(`waiting for main window, iter ${ iter }...`);
      }
      if (now > limit) {
        throw new Error(`timed out waiting for ${ limit / 1000 } seconds`);
      }
      await util.promisify(setTimeout)(100);
    }
    expect(windowCountForMainPage).toEqual(1);
  } finally {
    await teardown(electronApp, testInfo);
  }
}

/**
 * Start Rancher Desktop, and wait for background.log file to be populated; there
 * should be no windows visible.
 */
export async function testWaitForLogfile(testInfo: TestInfo, options: startRancherDesktopOptions) {
  let windowCount = 0;
  const electronApp = await startRancherDesktop(testInfo, {
    ...options, mock: false, noModalDialogs: true, timeout: 60_000,
  });
  const logPath = path.join(reportAsset(testInfo, 'log'), 'background.log');

  electronApp.on('window', () => {
    windowCount += 1;
    console.log('There should be no windows for this test.');
  });
  try {
    let iter = 0;
    const start = new Date().valueOf();
    const limit = 900 * 1_000 + start;

    while (true) {
      const now = new Date().valueOf();

      iter += 1;
      if (iter % 100 === 0) {
        console.log(`waiting for logs, iter ${ iter }...`);
      }
      try {
        const statInfo = await fs.promises.lstat(logPath);

        if (statInfo && statInfo.size > 160) {
          break;
        }
      } catch {}
      if (now > limit) {
        throw new Error(`timed out waiting for ${ limit / 1000 } seconds`);
      }
      if (windowCount > 0) {
        break;
      }
      await util.promisify(setTimeout)(100);
    }
  } finally {
    try {
      // Race condition: the app might have already shut down due to the fatal profile error.
      await teardown(electronApp, testInfo);
    } catch {
    }
  }

  return windowCount;
}
