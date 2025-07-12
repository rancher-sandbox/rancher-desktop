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
      containerEngine: {allowedImages: {enabled: false}}
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
      'alpine', 'sh', '-c', 'echo "Starting container"; for i in $(seq 1 10); do echo "Line $i: Hello world message $i"; done; echo "Container finished"');
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

    await expect(containerLogsPage.containerInfo).toBeVisible();

    await expect(containerLogsPage.terminal).toBeVisible();
    await expect(containerLogsPage.loadingIndicator).not.toBeVisible();
  });

  test('should show container information', async () => {
    const containerLogsPage = new ContainerLogsPage(page);

    await expect(containerLogsPage.containerInfo).toBeVisible();

    await expect(containerLogsPage.containerName).toContainText(testContainerName);
    await expect(containerLogsPage.containerState).not.toBeEmpty();
  });

  test('should display logs content', async () => {
    const containerLogsPage = new ContainerLogsPage(page);

    await containerLogsPage.waitForLogsToLoad();

    await expect(containerLogsPage.terminal).toContainText('Line 1: Hello world message');
  });

  test('should support log search', async () => {
    const containerLogsPage = new ContainerLogsPage(page);

    await expect(containerLogsPage.searchInput).toBeVisible();

    const searchTerm = 'Hello';
    await containerLogsPage.searchLogs(searchTerm);

    await expect(containerLogsPage.searchInput).toHaveValue(searchTerm);
    await expect(containerLogsPage.searchNextButton).toBeVisible();

    const terminalRows = page.locator('.xterm-rows');
    const line1Match = terminalRows.getByText('Line 1: Hello world message', { exact: false });
    const line2Match = terminalRows.getByText('Line 2: Hello world message', { exact: false });

    await expect(line1Match).toBeVisible();
    await expect(line2Match).toBeVisible();

    await containerLogsPage.searchNextButton.click();

    await expect(line2Match).toBeVisible();

    await containerLogsPage.searchPrevButton.click();

    await expect(line1Match).toBeVisible();

    await containerLogsPage.searchInput.press('Escape');
    await expect(containerLogsPage.searchInput).toBeEmpty();
  });

  test('should handle terminal scrolling', async () => {
    const scrollTestContainerName = `test-scroll-container-${Date.now()}`;
    let scrollTestContainerId: string;

    try {
      const output = await tool('docker', 'run', '-d', '--name', scrollTestContainerName,
        'alpine', 'sh', '-c', 'for i in $(seq 1 100); do echo "Scroll test line $i with content"; done; sleep 1');
      scrollTestContainerId = output.trim();

      const navPage = new NavPage(page);
      const containersPage = await navPage.navigateTo('Containers');
      await containersPage.waitForTableToLoad();

      await page.reload();
      await containersPage.waitForTableToLoad();

      await containersPage.waitForContainerToAppear(scrollTestContainerId);
      await containersPage.viewContainerLogs(scrollTestContainerId);

      await page.waitForURL(`**/containers/logs/${scrollTestContainerId}`, {timeout: 10_000});

      const containerLogsPage = new ContainerLogsPage(page);
      await containerLogsPage.waitForLogsToLoad();

      const terminalRows = page.locator('.xterm-rows');
      const lastLine = terminalRows.getByText('Scroll test line 100', { exact: false });
      const firstLine = terminalRows.getByText('Scroll test line 1', { exact: false });

      await expect(lastLine).toBeVisible({timeout: 10_000});

      const initialScrollPos = await containerLogsPage.getScrollPosition();
      expect(initialScrollPos).toBeGreaterThan(0);

      await containerLogsPage.scrollToTop();

      const topScrollPos = await containerLogsPage.getScrollPosition();
      expect(topScrollPos).toBe(0);
      expect(topScrollPos).not.toBe(initialScrollPos);

      await expect(firstLine).toBeVisible();

      await containerLogsPage.scrollToBottom();

      const bottomScrollPos = await containerLogsPage.getScrollPosition();
      expect(bottomScrollPos).toBeGreaterThan(topScrollPos); // Should have scrolled down significantly
      expect(bottomScrollPos).toBeGreaterThan(initialScrollPos - 100); // Should be near or at initial bottom position

      await expect(lastLine).toBeVisible();

    } finally {
      if (scrollTestContainerId) {
        try {
          await tool('docker', 'rm', '-f', scrollTestContainerId);
        } catch (cleanupError) {
        }
      }
    }
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

      const locator = page.locator('.xterm-screen');
      await expect(locator.getByText(/Log message/).nth(1)).toBeVisible();

      await expect(containerLogsPage.terminal).toContainText('Log message');

      await tool('docker', 'rm', '-f', longRunningContainerId);
    } finally {
      if (longRunningContainerId) {
        try {
          await tool('docker', 'rm', '-f', longRunningContainerId);
        } catch (cleanupError) {
        }
      }
    }
  });
});
