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

    if (await containerLogsPage.containerName.count() > 0) {
      await expect(containerLogsPage.containerName).toContainText(testContainerName);
    }

    if (await containerLogsPage.containerState.count() > 0) {
      await expect(containerLogsPage.containerState).not.toBeEmpty();
    }
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
    await expect(terminalRows.locator(':has-text("Line 1: Hello")').first()).toBeVisible();
    await expect(terminalRows.locator(':has-text("Line 2: Hello")').first()).toBeVisible();
    await page.waitForTimeout(1000);

    const line1Match = terminalRows.locator(':has-text("Line 1: Hello")').first();
    const line2Match = terminalRows.locator(':has-text("Line 2: Hello")').first();
    await expect(line1Match).toBeVisible();
    await page.waitForTimeout(1000);

    await containerLogsPage.searchNextButton.click();
    await page.waitForTimeout(1000);

    await expect(line2Match).toBeVisible();
    await page.waitForTimeout(1000);

    await containerLogsPage.searchPrevButton.click();
    await page.waitForTimeout(1000);

    await expect(line1Match).toBeVisible();
    await page.waitForTimeout(1000);

    await containerLogsPage.searchInput.press('Escape');
    await page.waitForTimeout(1000);
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
      await expect(terminalRows.locator(':has-text("Scroll test line 100")').first()).toBeVisible({timeout: 10_000});
      await page.waitForTimeout(2_000); // Give time for auto-scroll to complete

      const initialScrollPos = await containerLogsPage.getScrollPosition();
      expect(initialScrollPos).toBeGreaterThan(0);
      await page.waitForTimeout(1_000);

      await containerLogsPage.scrollToTop();
      await page.waitForTimeout(1_000);

      const topScrollPos = await containerLogsPage.getScrollPosition();
      expect(topScrollPos).toBe(0);
      expect(topScrollPos).not.toBe(initialScrollPos);

      await expect(terminalRows.locator(':has-text("Scroll test line 1")').first()).toBeVisible();

      await containerLogsPage.scrollToBottom();
      await page.waitForTimeout(1_000);

      const bottomScrollPos = await containerLogsPage.getScrollPosition();
      expect(bottomScrollPos).toBeGreaterThan(topScrollPos); // Should have scrolled down significantly
      expect(bottomScrollPos).toBeGreaterThan(initialScrollPos - 100); // Should be near or at initial bottom position

      await expect(terminalRows.locator(':has-text("Scroll test line 100")').first()).toBeVisible();

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
