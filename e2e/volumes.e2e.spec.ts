import type {ElectronApplication, Page} from '@playwright/test';
import {expect, test} from '@playwright/test';

import {NavPage} from './pages/nav-page';
import {VolumesPage} from './pages/volumes-page';
import {startSlowerDesktop, teardown, tool} from './utils/TestUtils';

let page: Page;

test.describe.serial('Volumes Tests', () => {
  let electronApp: ElectronApplication;
  let testVolumeName: string;

  test.beforeAll(async ({}, testInfo) => {
    [electronApp, page] = await startSlowerDesktop(testInfo, {
      kubernetes: {enabled: false},
      containerEngine: {allowedImages: {enabled: false}}
    });

    const navPage = new NavPage(page);
    await navPage.progressBecomesReady();
  });

  test.afterAll(async ({}, testInfo) => {
    if (testVolumeName) {
      try {
        await tool('docker', 'volume', 'rm', testVolumeName);
      } catch (error) {
      }
    }
    await teardown(electronApp, testInfo);
  });

  test('should navigate to volumes page', async () => {
    const navPage = new NavPage(page);
    const volumesPage = await navPage.navigateTo('Volumes');

    await expect(navPage.mainTitle).toHaveText('Volumes');
    await volumesPage.waitForTableToLoad();
  });

  test('should display volume in the list', async () => {
    const volumesPage = new VolumesPage(page);

    testVolumeName = `test-volume-${Date.now()}`;

    try {
      await tool('docker', 'volume', 'create', testVolumeName);
    } catch (error) {
      console.error('Failed to create test volume:', error);
      throw error;
    }

    await page.reload();
    await volumesPage.waitForTableToLoad();

    await volumesPage.waitForVolumeToAppear(testVolumeName);

    const isPresent = await volumesPage.isVolumePresent(testVolumeName);
    expect(isPresent).toBe(true);
  });

  test('should show volume information', async () => {
    const volumesPage = new VolumesPage(page);

    await volumesPage.waitForVolumeToAppear(testVolumeName);

    console.log(`Getting info for volume: ${testVolumeName}`);
    const volumeInfo = await volumesPage.getVolumeInfo(testVolumeName);
    console.log('Volume info:', volumeInfo);

    expect(volumeInfo.name).toBeTruthy();
    expect(volumeInfo.driver).toBeTruthy();
    expect(volumeInfo.mountpoint).toBeTruthy();
  });

  test('should browse volume files', async () => {
    const volumesPage = new VolumesPage(page);

    await volumesPage.browseVolumeFiles(testVolumeName);

    await page.waitForURL(`**/volumes/files/${testVolumeName}`, {timeout: 10000});

    await page.goBack();
    await volumesPage.waitForTableToLoad();
  });

  test('should delete volume', async () => {
    const volumesPage = new VolumesPage(page);

    const initialCount = await volumesPage.getVolumeCount();

    await volumesPage.deleteVolume(testVolumeName);

    await page.waitForFunction(
      (volumeName) => {
        const rows = document.querySelectorAll('tr.main-row');
        return ![...rows].some(row => row.textContent?.includes(volumeName));
      },
      testVolumeName,
      {timeout: 10000}
    );

    const isPresent = await volumesPage.isVolumePresent(testVolumeName);
    expect(isPresent).toBe(false);

    const finalCount = await volumesPage.getVolumeCount();
    expect(finalCount).toBe(initialCount - 1);

    testVolumeName = '';
  });

  test('should create multiple volumes for bulk operations', async () => {
    const volumeNames = [
      `test-bulk-volume-1-${Date.now()}`,
      `test-bulk-volume-2-${Date.now()}`,
      `test-bulk-volume-3-${Date.now()}`
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

      await page.waitForFunction(
        (volumeNames) => {
          const rows = document.querySelectorAll('tr.main-row');
          return !volumeNames.some(name =>
            [...rows].some(row => row.textContent?.includes(name))
          );
        },
        volumeNames,
        {timeout: 10000}
      );

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

  test('should handle search functionality', async () => {
    const volumesPage = new VolumesPage(page);

    const searchVolumeName = `search-test-volume-${Date.now()}`;

    try {
      await tool('docker', 'volume', 'create', searchVolumeName);

      await page.reload();
      await volumesPage.waitForTableToLoad();
      await volumesPage.waitForVolumeToAppear(searchVolumeName);

      await volumesPage.searchVolumes('search-test');

      await page.waitForFunction(
        () => {
          const rows = document.querySelectorAll('tr.main-row');
          return rows.length > 0;
        },
        {timeout: 5000}
      );

      const isPresent = await volumesPage.isVolumePresent(searchVolumeName);
      expect(isPresent).toBe(true);

      await volumesPage.searchVolumes('');

      await tool('docker', 'volume', 'rm', searchVolumeName);
    } catch (error) {
      try {
        await tool('docker', 'volume', 'rm', searchVolumeName);
      } catch (cleanupError) {
      }
      throw error;
    }
  });


  test('should handle error scenarios gracefully', async () => {
    const volumesPage = new VolumesPage(page);

    const hasError = await volumesPage.isErrorDisplayed();

    if (hasError) {
      const errorMessage = await volumesPage.getErrorMessage();
      expect(errorMessage).toBeTruthy();

      const hasError = await volumesPage.isErrorDisplayed();
      expect(hasError).toBe(true);
    }
  });
});
