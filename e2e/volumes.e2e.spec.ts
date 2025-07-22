import { ElectronApplication, Page, expect, test } from '@playwright/test';

import { NavPage } from './pages/nav-page';
import { VolumesPage } from './pages/volumes-page';
import { startSlowerDesktop, teardown, tool } from './utils/TestUtils';

let page: Page;

test.describe.serial('Volumes Tests', () => {
  let electronApp: ElectronApplication;
  let testVolumeName: string;

  test.beforeAll(async({ colorScheme }, testInfo) => {
    [electronApp, page] = await startSlowerDesktop(testInfo, {
      kubernetes:      { enabled: false },
      containerEngine: { allowedImages: { enabled: false } },
    });

    const navPage = new NavPage(page);
    await navPage.progressBecomesReady();
  });

  test.afterAll(async({ colorScheme }, testInfo) => {
    if (testVolumeName) {
      try {
        await tool('docker', 'volume', 'rm', testVolumeName);
      } catch (error) {
      }
    }
    await teardown(electronApp, testInfo);
  });

  test('should navigate to volumes page', async() => {
    const navPage = new NavPage(page);
    const volumesPage = await navPage.navigateTo('Volumes');

    await expect(navPage.mainTitle).toHaveText('Volumes');
    await volumesPage.waitForTableToLoad();
  });

  test('should display volume in the list', async() => {
    const volumesPage = new VolumesPage(page);

    testVolumeName = `test-volume-${ Date.now() }`;

    try {
      await tool('docker', 'volume', 'create', testVolumeName);
    } catch (error) {
      console.error('Failed to create test volume:', error);
      throw error;
    }

    await page.reload();
    await volumesPage.waitForTableToLoad();

    await volumesPage.waitForVolumeToAppear(testVolumeName);
  });

  test('should show volume information', async() => {
    const volumesPage = new VolumesPage(page);

    await volumesPage.waitForVolumeToAppear(testVolumeName);

    const volumeInfo = volumesPage.getVolumeInfo(testVolumeName);

    await expect(volumeInfo.name).not.toBeEmpty();
    await expect(volumeInfo.driver).not.toBeEmpty();
    await expect(volumeInfo.mountpoint).not.toBeEmpty();
  });

  test('should browse volume files', async() => {
    const volumesPage = new VolumesPage(page);

    await volumesPage.browseVolumeFiles(testVolumeName);

    await page.waitForURL(`**/volumes/files/${ testVolumeName }`, { timeout: 10_000 });

    await page.goBack();
    await volumesPage.waitForTableToLoad();
  });

  test('should delete volume', async() => {
    const volumesPage = new VolumesPage(page);

    await volumesPage.waitForVolumeToAppear(testVolumeName);

    await volumesPage.deleteVolume(testVolumeName);

    await expect(volumesPage.getVolumeRow(testVolumeName)).toBeHidden({ timeout: 10_000 });

    testVolumeName = '';
  });

  test('should create multiple volumes for bulk operations', async() => {
    const volumeNames = [
      `test-bulk-volume-1-${ Date.now() }`,
      `test-bulk-volume-2-${ Date.now() }`,
      `test-bulk-volume-3-${ Date.now() }`,
    ];

    try {
      for (const volumeName of volumeNames) {
        await tool('docker', 'volume', 'create', volumeName);
      }

      await page.reload();
      const volumesPage = new VolumesPage(page);
      await volumesPage.waitForTableToLoad();

      for (const volumeName of volumeNames) {
        await volumesPage.waitForVolumeToAppear(volumeName);
      }

      await volumesPage.deleteBulkVolumes(volumeNames);

      for (const volumeName of volumeNames) {
        await expect(volumesPage.getVolumeRow(volumeName)).toBeHidden({ timeout: 10_000 });
      }

      await page.reload();
      await volumesPage.waitForTableToLoad();

      for (const volumeName of volumeNames) {
        const isPresent = await volumesPage.isVolumePresent(volumeName);
        expect(isPresent).toBe(false);
      }
    } catch (error) {
      for (const volumeName of volumeNames) {
        try {
          await tool('docker', 'volume', 'rm', volumeName);
        } catch (cleanupError) {
        }
      }
      throw error;
    }
  });

  test('should handle search functionality', async() => {
    const volumesPage = new VolumesPage(page);

    const searchVolumeName = `search-test-volume-${ Date.now() }`;

    try {
      await tool('docker', 'volume', 'create', searchVolumeName);

      await page.reload();
      await volumesPage.waitForTableToLoad();
      await volumesPage.waitForVolumeToAppear(searchVolumeName);

      await volumesPage.searchVolumes('search-test');

      await expect(volumesPage.getVolumeRow(searchVolumeName)).toBeVisible();

      const isPresent = await volumesPage.isVolumePresent(searchVolumeName);
      expect(isPresent).toBe(true);

      await volumesPage.searchVolumes('');
    } finally {
      try {
        await tool('docker', 'volume', 'rm', searchVolumeName);
      } catch (cleanupError) {
      }
    }
  });

  test('should display error message in banner', async() => {
    const volumesPage = new VolumesPage(page);
    const volumeName = `test-volume-in-use-${ Date.now() }`;
    const containerName = `test-container-${ Date.now() }`;

    try {
      await tool('docker', 'volume', 'create', volumeName);

      // Create container that uses volume above
      await tool('docker', 'run', '--detach', '--name', containerName,
        '-v', `${ volumeName }:/data`, 'alpine', 'sleep', '300');

      await page.reload();
      await volumesPage.waitForTableToLoad();
      await volumesPage.waitForVolumeToAppear(volumeName);

      // Try to delete volume, results in error
      await volumesPage.deleteVolume(volumeName);

      await expect(volumesPage.errorBanner).toBeVisible();

      await expect(volumesPage.errorBanner).toContainText(/volume is in use/i);

      await expect(volumesPage.getVolumeRow(volumeName)).toBeVisible();
    } finally {
      try {
        await tool('docker', 'rm', '-f', containerName);
        await tool('docker', 'volume', 'rm', volumeName);
      } catch (cleanupError) {
      }
    }
  });

  test('should auto-refresh volumes list', async() => {
    const volumesPage = new VolumesPage(page);
    const autoRefreshVolumeName = `auto-refresh-test-${ Date.now() }`;

    await volumesPage.waitForTableToLoad();

    await tool('docker', 'volume', 'create', autoRefreshVolumeName);

    await volumesPage.waitForVolumeToAppear(autoRefreshVolumeName);

    const volumeInfo = volumesPage.getVolumeInfo(autoRefreshVolumeName);
    await expect(volumeInfo.name).not.toBeEmpty();
    await expect(volumeInfo.driver).not.toBeEmpty();

    await tool('docker', 'volume', 'rm', autoRefreshVolumeName);

    await expect(volumesPage.getVolumeRow(autoRefreshVolumeName)).toBeHidden();
  });
});
