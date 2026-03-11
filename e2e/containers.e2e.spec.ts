import { expect, test, ElectronApplication, Page } from '@playwright/test';

import { ContainerLogsPage } from './pages/container-logs-page';
import { ContainerShellPage } from './pages/container-shell-page';
import { ContainersPage } from './pages/containers-page';
import { NavPage } from './pages/nav-page';
import { startSlowerDesktop, teardown, tool } from './utils/TestUtils';

import { ContainerEngine } from '@pkg/config/settings';

let page: Page;

test.describe.serial('Containers Tests', () => {
  let electronApp: ElectronApplication;
  let testContainerId: string;
  let testContainerName: string;

  test.beforeAll(async({ colorScheme }, testInfo) => {
    [electronApp, page] = await startSlowerDesktop(testInfo, {
      kubernetes:      { enabled: false },
      containerEngine: { name: ContainerEngine.MOBY, allowedImages: { enabled: false } },
    });

    const navPage = new NavPage(page);
    await navPage.progressBecomesReady();
  });

  test.afterAll(async({ colorScheme }, testInfo) => {
    if (testContainerId) {
      try {
        await tool('docker', 'rm', '-f', testContainerId);
      } catch (error) {}
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

    const output = await tool(
      'docker',
      'run',
      '--detach',
      '--name',
      testContainerName,
      'alpine',
      'sh',
      '-c',
      'echo "Starting"; for i in $(seq 1 10); do echo "L$i: msg$i"; done; echo "Finished"',
    );
    testContainerId = output.trim();

    expect(testContainerId).toMatch(/^[a-f0-9]{64}$/);

    await page.reload();

    const navPage = new NavPage(page);
    const containersPage = await navPage.navigateTo('Containers');
    await containersPage.waitForTableToLoad();

    await containersPage.waitForContainerToAppear(testContainerId);
    await containersPage.viewContainerInfo(testContainerId);

    await page.waitForURL(`**/containers/info/${ testContainerId }**`, {
      timeout: 10_000,
    });
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

    await expect(containerLogsPage.containerName).toContainText(
      testContainerName,
    );
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

    const highlightedRow = containerLogsPage.terminal.locator(
      '.xterm-rows div',
      {
        has: page.locator('.xterm-decoration-top'),
      },
    );

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
      const output = await tool(
        'docker',
        'run',
        '--detach',
        '--name',
        scrollTestContainerName,
        'alpine',
        'sh',
        '-c',
        'for i in $(seq 1 100); do echo "Line $i:"; done; sleep 1',
      );
      scrollTestContainerId = output.trim();

      const navPage = new NavPage(page);
      const containersPage = await navPage.navigateTo('Containers');

      await page.reload();
      await containersPage.waitForTableToLoad();

      await containersPage.waitForContainerToAppear(scrollTestContainerId);
      await containersPage.viewContainerInfo(scrollTestContainerId);

      await page.waitForURL(`**/containers/info/${ scrollTestContainerId }**`, {
        timeout: 10_000,
      });

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
        } catch (cleanupError) {}
      }
    }
  });

  test('should output logs if container not exited', async() => {
    const longRunningContainerName = `test-not-exited-logs-${ Date.now() }`;
    let longRunningContainerId: string;

    try {
      const output = await tool(
        'docker',
        'run',
        '--detach',
        '--name',
        longRunningContainerName,
        'alpine',
        'sh',
        '-c',
        'while true; do echo "Log $(date +%s)"; sleep 2; done',
      );
      longRunningContainerId = output.trim();

      const navPage = new NavPage(page);
      const containersPage = await navPage.navigateTo('Containers');

      await page.reload();
      await containersPage.waitForTableToLoad();

      await containersPage.waitForContainerToAppear(longRunningContainerId);
      await containersPage.viewContainerInfo(longRunningContainerId);

      await page.waitForURL(`**/containers/info/${ longRunningContainerId }**`, {
        timeout: 10000,
      });

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
        } catch (cleanupError) {}
      }
    }
  });

  test('should auto-refresh containers list', async() => {
    const containersPage = new ContainersPage(page);
    const autoRefreshContainerName = `auto-refresh-test-${ Date.now() }`;
    let autoRefreshContainerId = '';

    try {
      const navPage = new NavPage(page);
      await navPage.navigateTo('Containers');
      await containersPage.waitForTableToLoad();

      // Remove all existing containers to ensure clean state
      try {
        const existingContainers = await tool('docker', 'ps', '--all', '--quiet');
        const containerIds = existingContainers.trim().split(/\s+/);

        if (containerIds.length > 0) {
          await tool('docker', 'rm', '--force', ...containerIds);
        }
      } catch {}

      await expect(containersPage.containers).toHaveCount(0);

      const output = await tool(
        'docker',
        'run',
        '--detach',
        '--name',
        autoRefreshContainerName,
        'alpine',
        'sleep',
        'infinity',
      );
      autoRefreshContainerId = output.trim();

      await expect(
        containersPage.getContainerRow(autoRefreshContainerId),
      ).toBeVisible();

      await tool('docker', 'rm', '--force', autoRefreshContainerId);

      await expect(
        containersPage.getContainerRow(autoRefreshContainerId),
      ).toBeHidden();
    } finally {
      if (autoRefreshContainerId) {
        try {
          await tool('docker', 'rm', '-f', autoRefreshContainerId);
        } catch {}
      }
    }
  });
});

test.describe.serial('Container Shell Tab', () => {
  let electronApp: ElectronApplication;
  let shellContainerId: string;
  let unsupportedContainerId: string;

  test.beforeAll(async({ colorScheme }, testInfo) => {
    [electronApp, page] = await startSlowerDesktop(testInfo, {
      kubernetes:      { enabled: false },
      containerEngine: { name: ContainerEngine.MOBY, allowedImages: { enabled: false } },
    });

    const navPage = new NavPage(page);
    await navPage.progressBecomesReady();

    // Start a long-running container for the shell tests.
    // Ubuntu is used because the base Alpine image does not include `script`
    // (util-linux), which is required for the interactive shell session.
    const output = await tool('docker', 'run', '--detach', 'ubuntu', 'sleep', 'infinity');
    shellContainerId = output.trim();

    // Alpine container for the "unsupported" test — Alpine's base image has no
    // `script` command, so the shell tab should show the unsupported banner.
    const alpineOutput = await tool('docker', 'run', '--detach', 'alpine', 'sleep', 'infinity');
    unsupportedContainerId = alpineOutput.trim();
  });

  test.afterAll(async({ colorScheme }, testInfo) => {
    if (shellContainerId) {
      try {
        await tool('docker', 'rm', '-f', shellContainerId);
      } catch {}
    }
    if (unsupportedContainerId) {
      try {
        await tool('docker', 'rm', '-f', unsupportedContainerId);
      } catch {}
    }
    await teardown(electronApp, testInfo);
  });

  async function navigateToShellTab() {
    const navPage = new NavPage(page);
    await navPage.navigateTo('Containers');
    const containersPage = new ContainersPage(page);
    await containersPage.waitForTableToLoad();
    await containersPage.waitForContainerToAppear(shellContainerId);
    await containersPage.clickContainerAction(shellContainerId, 'info');
    await page.waitForURL(`**/containers/info/${ shellContainerId }**`, { timeout: 10_000 });
    const shellPage = new ContainerShellPage(page);
    await shellPage.clickTab();
    await shellPage.waitForTerminal();
    await shellPage.waitForShellReady();

    return shellPage;
  }

  test('should show the Shell tab on a running container', async() => {
    const shellPage = await navigateToShellTab();
    await expect(shellPage.tab).toBeVisible();
    await expect(shellPage.terminal).toBeVisible();
    await expect(shellPage.notRunningBanner).not.toBeVisible();
  });

  test('should execute a command and display its output', async() => {
    const shellPage = new ContainerShellPage(page);
    // Unique marker avoids false positives from any earlier terminal history.
    const marker = `RDTEST_${ Date.now() }`;
    await shellPage.runCommand(`echo ${ marker }`);
    await shellPage.waitForOutput(marker);
  });

  test('should preserve the session when switching between Logs and Shell tabs', async() => {
    const shellPage = new ContainerShellPage(page);
    const logsTab = page.getByTestId('tab-logs');
    // A unique marker is required: we must distinguish "this exact output is
    // still in the buffer" from "the shell printed something similar".
    const marker = `RDTEST_PERSIST_${ Date.now() }`;

    await shellPage.runCommand(`echo ${ marker }`);
    await shellPage.waitForOutput(marker);

    // Switch to Logs and back.
    await logsTab.click();
    await shellPage.clickTab();

    // History must still be visible — session was preserved.
    await shellPage.waitForOutput(marker);
  });

  test('should show the unsupported banner for containers without script', async() => {
    // Navigate to the Alpine container — it has no `script`, so the backend
    // will send container-exec/unsupported instead of starting a session.
    const navPage = new NavPage(page);
    await navPage.navigateTo('Containers');
    const containersPage = new ContainersPage(page);
    await containersPage.waitForTableToLoad();
    await containersPage.waitForContainerToAppear(unsupportedContainerId);
    await containersPage.clickContainerAction(unsupportedContainerId, 'info');
    await page.waitForURL(`**/containers/info/${ unsupportedContainerId }**`, { timeout: 10_000 });

    const shellPage = new ContainerShellPage(page);
    await shellPage.clickTab();

    // The unsupported banner must appear and the terminal must not be rendered.
    await expect(shellPage.unsupportedBanner).toBeVisible({ timeout: 15_000 });
    await expect(shellPage.terminal).not.toBeVisible();
  });
});
