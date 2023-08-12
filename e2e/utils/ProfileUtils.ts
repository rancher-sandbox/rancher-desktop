// Deployment-profile-related utilities

import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import { expect, Page } from '@playwright/test';

import { createDefaultSettings, createUserProfile, startRancherDesktop, tool } from './TestUtils';
import { NavPage } from '../pages/nav-page';

import * as childProcess from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';

function fileExistsSync(fullPath: string): boolean {
  try {
    fs.accessSync(fullPath);

    return true;
  } catch {
    return false;
  }
}

export async function verifySettings(): Promise<string[]> {
  const fullPath = path.join(paths.config, 'settings.json');

  try {
    await fs.promises.access(fullPath);
  } catch {
    createDefaultSettings();
  }

  return [];
}

export async function clearSettings(): Promise<string[]> {
  const fullPath = path.join(paths.config, 'settings.json');

  try {
    await fs.promises.access(fullPath);
    try {
      await fs.promises.rm(fullPath, { force: true });

      return [];
    } catch (ex: any) {
      return [`Failed to delete ${ fullPath } : ${ ex }`];
    }
  } catch {
    return [];
  }
}

export function verifyRegistryHive(hive: string): string[] {
  const haveProfile = ['defaults', 'locked'].some(async(profileType) => {
    try {
      const { stdout } = await childProcess.spawnFile('reg',
        ['query', `${ hive }\\SOFTWARE\\Policies\\Rancher Desktop\\${ profileType }`],
        { stdio: ['ignore', 'pipe', 'pipe'] });

      if (stdout.length > 0) {
        return true;
      }
    } catch { }

    return false;
  });

  return haveProfile ? [] : [`Need to add registry hive "${ hive }\\SOFTWARE\\Policies\\Rancher Desktop\\<defaults or locked>"`];
}

export async function verifyNoRegistryHive(hive: string): Promise<string[]> {
  const skipReasons: string[] = [];

  for (const type of ['defaults', 'locked']) {
    try {
      const { stdout } = await childProcess.spawnFile('reg',
        ['query', `${ hive }\\SOFTWARE\\Policies\\Rancher Desktop\\${ type }`],
        { stdio: ['ignore', 'pipe', 'pipe'] });

      if (stdout.length === 0) {
        continue;
      }
    } catch { }
    skipReasons.push(`Need to remove registry hive "${ hive }\\SOFTWARE\\Policies\\Rancher Desktop\\${ type }"`);
  }

  return skipReasons;
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
  return getDeploymentBaseNames(platform).map(basename => path.join(profileDir, basename));
}

export async function clearUserProfiles(): Promise<string[]> {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';
  const skipReasons: string[] = [];

  if (platform === 'win32') {
    return await verifyNoRegistryHive('HKCU');
  }
  const profilePaths = getDeploymentPaths(platform, paths.deploymentProfileUser);

  for (const fullPath of profilePaths) {
    try {
      await fs.promises.rm(fullPath, { force: true });
    } catch (ex: any) {
      skipReasons.push(`Failed to delete file ${ fullPath }: ${ ex }`);
    }
  }

  return skipReasons;
}

export async function verifyUserProfiles(): Promise<string[]> {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';
  // console.log('check settings');
  // await util.promisify(setTimeout)(2 * 60_000);

  if (platform === 'win32') {
    return verifyRegistryHive('HKCU');
  }
  const profilePaths = getDeploymentPaths(platform, paths.deploymentProfileUser);
  const haveProfileFile = profilePaths.some(async(fullPath) => {
    try {
      await fs.promises.access(fullPath);

      return true;
    } catch {
      return false;
    }
  });

  if (!haveProfileFile) {
    await createUserProfile(
      { containerEngine: { allowedImages: { enabled: true } } },
      { containerEngine: { allowedImages: { enabled: true, patterns: [__filename] } }, kubernetes: { version: 'chaff' } },
    );
  }

  return [];
}

export async function verifyNoSystemProfiles(): Promise<string[]> {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';

  if (platform === 'win32') {
    return await verifyNoRegistryHive('HKLM');
  }
  const profilePaths = getDeploymentPaths(platform, paths.deploymentProfileSystem);

  return profilePaths.filter(fileExistsSync);
}

export function verifySystemProfiles(): string[] {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';
  // console.log('check settings');
  // await util.promisify(setTimeout)(2 * 60_000);

  if (platform === 'win32') {
    return verifyRegistryHive('HKLM');
  }
  const fullPaths = getDeploymentPaths(platform, paths.deploymentProfileSystem);
  const haveProfileFile = fullPaths.some(fileExistsSync);

  return haveProfileFile ? [] : [`Need to create system profile file ${ fullPaths.join(' and/or ') }`];
}

// And the test runners
export async function testForFirstRunWindow() {
  let page: Page|undefined;
  let navPage: NavPage;
  let windowCount = 0;
  let windowCountForMainPage = 0;
  const electronApp = await startRancherDesktop(__filename, { mock: false, noModalDialogs: false });

  electronApp.on('window', async(openedPage: Page) => {
    windowCount += 1;
    if (windowCount === 1) {
      try {
        const button = openedPage.getByText('OK');

        if (button) {
          await button.click({ timeout: 10_000 });
        }

        return;
      } catch (e: any) {
        console.log(`Attempt to press the OK button failed: ${ e }`);
      }
    }
    navPage = new NavPage(openedPage);

    try {
      await expect(navPage.mainTitle).toHaveText('Welcome to Rancher Desktop');
      page = openedPage;
      windowCountForMainPage = windowCount;

      return;
    } catch (ex: any) {
      console.log(`Ignoring failed title-test: ${ ex.toString().substring(0, 10000) }`);
    }
  });

  let iter = 0;
  const start = new Date().valueOf();
  const limit = 300 * 1_000 + start;

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
  console.log(`Shutting down now because this test is finished...`);
  await tool('rdctl', 'shutdown', '--verbose');
}

export async function testForNoFirstRunWindow() {
  let page: Page|undefined;
  let navPage: NavPage;
  let windowCount = 0;
  let windowCountForMainPage = 0;
  const electronApp = await startRancherDesktop(__filename, { mock: false, noModalDialogs: false });

  electronApp.on('window', async(openedPage: Page) => {
    windowCount += 1;
    navPage = new NavPage(openedPage);

    try {
      await expect(navPage.mainTitle).toHaveText('Welcome to Rancher Desktop');
      page = openedPage;
      windowCountForMainPage = windowCount;

      return;
    } catch (ex: any) {
      console.log(`Ignoring failed title-test: ${ ex.toString().substring(0, 2000) }`);
    }
    try {
      const button = openedPage.getByText('OK');

      await button.click( { timeout: 1000 });
      expect("Didn't expect to see a first-run window").toEqual('saw the first-run window');
    } catch (e) {
      console.error(`Expecting to get an error when clicking on a non-button: ${ e }`, e);
    }
  });

  let iter = 0;
  const start = new Date().valueOf();
  const limit = 300 * 1_000 + start;

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
  console.log(`Shutting down now because this test is finished...`);
  await tool('rdctl', 'shutdown', '--verbose');
}
