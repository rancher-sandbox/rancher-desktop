import { expect, test, ElectronApplication, Page } from '@playwright/test';

import {NavPage} from './pages/nav-page';
import {ContainerLogsPage} from './pages/container-logs-page';
import {ContainersPage} from './pages/containers-page';
import {startSlowerDesktop, teardown, tool} from './utils/TestUtils';

let page: Page;

test.describe.serial('Containers Tests', () => {
  let electronApp: ElectronApplication;
  let testContainerId: string;
  let testContainerName: string;

  test.beforeAll(async({ colorScheme }, testInfo) => {
    [electronApp, page] = await startSlowerDesktop(testInfo, {
      kubernetes:      { enabled: false },
      containerEngine: { allowedImages: { enabled: false } },
    });

    const navPage = new NavPage(page);
    await navPage.progressBecomesReady();
  });

  test.afterAll(async({ colorScheme }, testInfo) => {
    if (testContainerId) {
      try {
        await tool('docker', 'rm', '-f', testContainerId);
      } catch (error) {
      }
    }
    await teardown(electronApp, testInfo);
  });

  test('should navigate to containers page', async() => {
    const navPage = new NavPage(page);
    const containersPage = await navPage.navigateTo('Containers');

    await expect(navPage.mainTitle).toHaveText('Containers');
    await containersPage.waitForTableToLoad();
  });

  test('should create and display test container', async() => {
    testContainerName = `test-logs-container-${ Date.now() }`;

    const output = await tool('docker', 'run', '--detach', '--name', testContainerName,
      'alpine', 'sh', '-c', 'echo "Starting"; for i in $(seq 1 10); do echo "L$i: msg$i"; done; echo "Finished"'); testContainerId = output.trim();

    expect(testContainerId).toMatch(/^[a-f0-9]{64}$/);

    await page.reload();

    const navPage = new NavPage(page);
    const containersPage = await navPage.navigateTo('Containers');
    await containersPage.waitForTableToLoad();

    await containersPage.waitForContainerToAppear(testContainerId);
    await containersPage.viewContainerLogs(testContainerId);

    await page.waitForURL(`**/containers/logs/${ testContainerId }`, { timeout: 10_000 });
  });

  test('should display container logs page', async() => {
    const containerLogsPage = new ContainerLogsPage(page);

    await expect(containerLogsPage.containerInfo).toBeVisible();

    await expect(containerLogsPage.terminal).toBeVisible();
    await expect(containerLogsPage.loadingIndicator).not.toBeVisible();
  });

  test('should show container information', async() => {
    const containerLogsPage = new ContainerLogsPage(page);

    await expect(containerLogsPage.containerInfo).toBeVisible();

    await expect(containerLogsPage.containerName).toContainText(testContainerName);
    await expect(containerLogsPage.containerState).not.toBeEmpty();
  });

  test('should display logs content', async() => {
    const containerLogsPage = new ContainerLogsPage(page);

    await containerLogsPage.waitForLogsToLoad();

    await expect(containerLogsPage.terminal).toContainText('L1: msg1');
  });

  test('should support log search', async() => {
    const containerLogsPage = new ContainerLogsPage(page);

    await expect(containerLogsPage.searchInput).toBeVisible();

    const searchTerm = 'msg';
    await containerLogsPage.searchLogs(searchTerm);

    const searchHighlight = page.locator('span.xterm-decoration-top');
    await expect(searchHighlight).toBeVisible();

    const highlightedRow = containerLogsPage.terminal.locator('.xterm-rows div', {
      has: page.locator('.xterm-decoration-top'),
    });

    await expect(highlightedRow).toContainText('L1: msg1');

    await containerLogsPage.searchNextButton.click();

    await expect(searchHighlight).toBeVisible();
    await expect(highlightedRow).toContainText('L2: msg2');

    await containerLogsPage.searchPrevButton.click();

    await expect(searchHighlight).toBeVisible();
    await expect(highlightedRow).toContainText('L1: msg1');

    await containerLogsPage.searchClearButton.click();
    await expect(containerLogsPage.searchInput).toBeEmpty();

    await containerLogsPage.terminal.click();

    await expect(searchHighlight).not.toBeVisible();
  });

  test('should handle terminal scrolling', async() => {
    const scrollTestContainerName = `test-scroll-container-${ Date.now() }`;
    let scrollTestContainerId: string;

    try {
      const output = await tool('docker', 'run', '--detach', '--name', scrollTestContainerName,
        'alpine', 'sh', '-c', 'for i in $(seq 1 100); do echo "Line $i:"; done; sleep 1');
      scrollTestContainerId = output.trim();

      const navPage = new NavPage(page);
      const containersPage = await navPage.navigateTo('Containers');

      await page.reload();
      await containersPage.waitForTableToLoad();

      await containersPage.waitForContainerToAppear(scrollTestContainerId);
      await containersPage.viewContainerLogs(scrollTestContainerId);

      await page.waitForURL(`**/containers/logs/${ scrollTestContainerId }`, { timeout: 10_000 });

      const containerLogsPage = new ContainerLogsPage(page);
      await containerLogsPage.waitForLogsToLoad();

      const terminalRows = containerLogsPage.terminal.locator('.xterm-rows');
      const lastLine = terminalRows.getByText('Line 100:', { exact: false });
      const firstLine = terminalRows.getByText('Line 1:', { exact: false });

      await expect(lastLine).toBeVisible();
      await expect(firstLine).not.toBeVisible();

      await containerLogsPage.scrollToTop();

      await expect(firstLine).toBeVisible();
      await expect(lastLine).not.toBeVisible();

      await containerLogsPage.scrollToBottom();

      await expect(lastLine).toBeVisible();
      await expect(firstLine).not.toBeVisible();
    } finally {
      if (scrollTestContainerId) {
        try {
          await tool('docker', 'rm', '-f', scrollTestContainerId);
        } catch (cleanupError) {
        }
      }
    }
  });

  test('should output logs if container not exited', async() => {
    const longRunningContainerName = `test-not-exited-logs-${ Date.now() }`;
    let longRunningContainerId: string;

    try {
      const output = await tool('docker', 'run', '--detach', '--name', longRunningContainerName,
        'alpine', 'sh', '-c', 'while true; do echo "Log $(date +%s)"; sleep 2; done');
      longRunningContainerId = output.trim();

      const navPage = new NavPage(page);
      const containersPage = await navPage.navigateTo('Containers');

      await page.reload();
      await containersPage.waitForTableToLoad();

      await containersPage.waitForContainerToAppear(longRunningContainerId);
      await containersPage.viewContainerLogs(longRunningContainerId);

      await page.waitForURL(`**/containers/logs/${ longRunningContainerId }`, { timeout: 10000 });

      const containerLogsPage = new ContainerLogsPage(page);
      await containerLogsPage.waitForLogsToLoad();

      const locator = containerLogsPage.terminal.locator('.xterm-screen');
      await expect(locator.getByText(/Log \d+/).nth(1)).toBeVisible();

      await expect(containerLogsPage.terminal).toContainText('Log ');

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

  test('should auto-refresh containers list', async () => {
    const containersPage = new ContainersPage(page);
    const autoRefreshContainerName = `auto-refresh-test-${Date.now()}`;
    let autoRefreshContainerId: string;

    const navPage = new NavPage(page);
    await navPage.navigateTo('Containers');
    await containersPage.waitForTableToLoad();

    const output = await tool('docker', 'run', '--detach', '--name', autoRefreshContainerName,
      'alpine', 'sleep', '30');
    autoRefreshContainerId = output.trim();

    await containersPage.waitForContainerToAppear(autoRefreshContainerId);

    await tool('docker', 'rm', '--force', autoRefreshContainerId);

    await expect(containersPage.getContainerRow(autoRefreshContainerId)).toBeHidden();
  });
});
