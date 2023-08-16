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

export async function clearUserProfile(): Promise<string[]> {
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
  return getDeploymentBaseNames(platform).map(basename => path.join(profileDir, basename));
}

export async function hasRegistryHive(hive: string): Promise<boolean> {
  for (const profileType of ['defaults', 'locked']) {
    try {
      const { stdout } = await childProcess.spawnFile('reg',
        ['query', `${ hive }\\SOFTWARE\\Policies\\Rancher Desktop\\${ profileType }`],
        { stdio: ['ignore', 'pipe', 'pipe'] });

      if (stdout.length > 0) {
        return true;
      }
    } catch { }
  }

  return false;
}

export async function hasUserProfile(): Promise<boolean> {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';

  if (platform === 'win32') {
    return await hasRegistryHive('HKCU');
  }

  for (const profilePath of getDeploymentPaths(platform, paths.deploymentProfileUser)) {
    try {
      await fs.promises.access(profilePath);

      return true;
    } catch { }
  }

  return false;
}

export async function verifyRegistryHive(hive: string): Promise<string[]> {
  let hasProfile = false;

  for (const profileType of ['defaults', 'locked']) {
    try {
      const { stdout } = await childProcess.spawnFile('reg',
        ['query', `${ hive }\\SOFTWARE\\Policies\\Rancher Desktop\\${ profileType }`],
        { stdio: ['ignore', 'pipe', 'pipe'] });

      if (stdout.length > 0) {
        hasProfile = true;
        break;
      }
    } catch { }
  }

  return hasProfile ? [] : [`Need to add registry hive "${ hive }\\SOFTWARE\\Policies\\Rancher Desktop\\<defaults or locked>"`];
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

export async function verifyNoRegistryHive(hive: string): Promise<string[]> {
  const skipReasons: string[] = [];

  for (const profileType of ['defaults', 'locked']) {
    try {
      const { stdout } = await childProcess.spawnFile('reg',
        ['query', `${ hive }\\SOFTWARE\\Policies\\Rancher Desktop\\${ profileType }`],
        { stdio: ['ignore', 'pipe', 'pipe'] });

      if (stdout.length === 0) {
        continue;
      }
    } catch { }
    skipReasons.push(`Need to remove registry hive "${ hive }\\SOFTWARE\\Policies\\Rancher Desktop\\${ profileType }"`);
  }

  return skipReasons;
}

export async function verifyUserProfile(): Promise<string[]> {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';
  // console.log('check settings');
  // await util.promisify(setTimeout)(2 * 60_000);

  if (platform === 'win32') {
    return verifyRegistryHive('HKCU');
  }
  for (const profilePath of getDeploymentPaths(platform, paths.deploymentProfileUser)) {
    try {
      await fs.promises.access(profilePath);

      return [];
    } catch { }
  }
  await createUserProfile(
    { containerEngine: { allowedImages: { enabled: true } } },
    { containerEngine: { allowedImages: { enabled: true, patterns: [__filename] } }, kubernetes: { version: 'chaff' } },
  );

  return [];
}

export async function verifyNoSystemProfile(): Promise<string[]> {
  const platform = os.platform() as 'win32' | 'darwin' | 'linux';

  if (platform === 'win32') {
    return await verifyNoRegistryHive('HKLM');
  }
  const profilePaths = getDeploymentPaths(platform, paths.deploymentProfileSystem);
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
  // console.log('check settings');
  // await util.promisify(setTimeout)(2 * 60_000);

  if (platform === 'win32') {
    return await verifyRegistryHive('HKLM');
  }
  const profilePaths = getDeploymentPaths(platform, paths.deploymentProfileSystem);

  for (const profilePath of profilePaths) {
    if (await fileExists(profilePath)) {
      return [];
    }
  }

  return [`Need to create system profile file ${ profilePaths.join(' and/or ') }`];
}

// And the test runners.
// There are only three kinds of tests, so each of the main test files can invoke the kind it needs:
// 1. Verify there's a first-run window
// 2. Verify the main window is the first window
// 3. Verify we get a fatal error and it's captured in a log file.

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

export async function runWaitForLogfile(testPath: string, logPath: string) {
  let windowCount = 0;
  const electronApp = await startRancherDesktop(testPath, { mock: false, noModalDialogs: true });

  electronApp.on('window', () => {
    windowCount += 1;
    console.log('There should be no windows for this test.');
  });

  let iter = 0;
  const start = new Date().valueOf();
  const limit = 300 * 1_000 + start;

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
    await util.promisify(setTimeout)(100);
  }

  return windowCount;
}