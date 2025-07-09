import type {ElectronApplication, Page} from '@playwright/test';
import {expect, test} from '@playwright/test';

import {NavPage} from './pages/nav-page';
import {ContainerLogsPage} from './pages/container-logs-page';
import {startSlowerDesktop, teardown, tool} from './utils/TestUtils';

let page: Page;

test.describe.serial('Container Logs Tests', () => {
  let electronApp: ElectronApplication;
  let testContainerId: string;
  let testContainerName: string;

  test.beforeAll(async ({}, testInfo) => {
    [electronApp, page] = await startSlowerDesktop(testInfo, {
      kubernetes: {enabled: false},
      application: {security: {allowedImages: {enabled: false}}}
    });

    const navPage = new NavPage(page);
    await navPage.progressBecomesReady();
  });

  test.afterAll(async ({}, testInfo) => {
    if (testContainerId) {
      try {
        await tool('docker', 'rm', '-f', testContainerId);
      } catch (error) {
      }
    }
    await teardown(electronApp, testInfo);
  });

  test('should navigate to containers page', async () => {
    const navPage = new NavPage(page);
    const containersPage = await navPage.navigateTo('Containers');

    await expect(navPage.mainTitle).toHaveText('Containers');
    await containersPage.waitForTableToLoad();
  });

  test('should create and display test container', async () => {
    testContainerName = `test-logs-container-${Date.now()}`;

    const output = await tool('docker', 'run', '-d', '--name', testContainerName,
      'alpine', 'sh', '-c', 'echo "Starting container"; echo "Hello from container logs"; sleep 5; echo "Container finished"');
    testContainerId = output.trim();

    expect(testContainerId).toMatch(/^[a-f0-9]{64}$/);

    await page.reload();

    const navPage = new NavPage(page);
    const containersPage = await navPage.navigateTo('Containers');
    await containersPage.waitForTableToLoad();

    await containersPage.waitForContainerToAppear(testContainerId);
    await containersPage.viewContainerLogs(testContainerId);

    await page.waitForURL(`**/containers/logs/${testContainerId}`, {timeout: 10000});
  });

  test('should display container logs page', async () => {
    const containerLogsPage = new ContainerLogsPage(page);

    await containerLogsPage.waitForContainerInfo();
    await expect(containerLogsPage.containerInfo).toBeVisible();

    await containerLogsPage.waitForLogsToLoad();
    await expect(containerLogsPage.terminal).toBeVisible();
  });

  test('should show container information', async () => {
    const containerLogsPage = new ContainerLogsPage(page);

    await expect(containerLogsPage.containerInfo).toBeVisible();

    if (await containerLogsPage.containerName.count() > 0) {
      const containerName = await containerLogsPage.getContainerName();
      expect(containerName).toContain(testContainerName);
    }

    if (await containerLogsPage.containerState.count() > 0) {
      const containerState = await containerLogsPage.getContainerState();
      expect(containerState).toBeTruthy();
    }
  });

  test('should display logs content', async () => {
    const containerLogsPage = new ContainerLogsPage(page);

    await containerLogsPage.waitForLogsToLoad();

    const hasContent = await containerLogsPage.hasLogsContent();
    expect(hasContent).toBe(true);

    const terminalContent = await containerLogsPage.getTerminalContent();
    expect(terminalContent).toContain('Hello from container logs');
  });

  test('should support log search', async () => {
    const containerLogsPage = new ContainerLogsPage(page);

    if (await containerLogsPage.searchInput.count() > 0) {
      const searchTerm = 'Hello';
      await containerLogsPage.searchLogs(searchTerm);

      await page.waitForFunction(
        () => {
          const searchInput = document.querySelector('input[type="search"], input.search-input') as HTMLInputElement;
          return searchInput && searchInput.value === 'Hello';
        },
        {timeout: 5000}
      );

      const inputValue = await containerLogsPage.searchInput.inputValue();
      expect(inputValue).toBe(searchTerm);

      if (await containerLogsPage.searchNextButton.count() > 0) {
        await containerLogsPage.navigateSearchNext();
      }

      if (await containerLogsPage.searchPrevButton.count() > 0) {
        await containerLogsPage.navigateSearchPrevious();
      }

      await containerLogsPage.clearSearch();

      await page.waitForFunction(
        () => {
          const searchInput = document.querySelector('input[type="search"], input.search-input') as HTMLInputElement;
          return searchInput && searchInput.value === '';
        },
        {timeout: 5000}
      );

      const clearedValue = await containerLogsPage.searchInput.inputValue();
      expect(clearedValue).toBe('');
    }
  });

  test('should handle terminal scrolling', async () => {
    const containerLogsPage = new ContainerLogsPage(page);

    await containerLogsPage.scrollToTop();
    await containerLogsPage.scrollToBottom();

    await expect(containerLogsPage.terminal).toBeVisible();
  });

  test('should display real-time logs', async () => {
    const longRunningContainerName = `test-realtime-logs-${Date.now()}`;
    let longRunningContainerId: string;

    try {
      const output = await tool('docker', 'run', '-d', '--name', longRunningContainerName,
        'alpine', 'sh', '-c', 'while true; do echo "Log message $(date)"; sleep 2; done');
      longRunningContainerId = output.trim();

      const navPage = new NavPage(page);
      const containersPage = await navPage.navigateTo('Containers');
      await containersPage.waitForTableToLoad();

      await page.reload();
      await containersPage.waitForTableToLoad();

      await containersPage.waitForContainerToAppear(longRunningContainerId);
      await containersPage.viewContainerLogs(longRunningContainerId);

      await page.waitForURL(`**/containers/logs/${longRunningContainerId}`, {timeout: 10000});

      const containerLogsPage = new ContainerLogsPage(page);
      await containerLogsPage.waitForLogsToLoad();

      await page.waitForFunction(
        () => {
          const terminal = document.querySelector('.xterm-screen');
          const content = terminal?.textContent || '';
          return (content.match(/Log message/g) || []).length >= 2;
        },
        {timeout: 10000}
      );

      const hasContent = await containerLogsPage.hasLogsContent();
      expect(hasContent).toBe(true);

      const terminalContent = await containerLogsPage.getTerminalContent();
      expect(terminalContent).toContain('Log message');

      await tool('docker', 'rm', '-f', longRunningContainerId);
    } catch (error) {
      if (longRunningContainerId) {
        try {
          await tool('docker', 'rm', '-f', longRunningContainerId);
        } catch (cleanupError) {
        }
      }
      throw error;
    }
  });
});
