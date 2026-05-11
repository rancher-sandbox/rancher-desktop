import { ElectronApplication, Page, expect, test } from '@playwright/test';

import { NavPage } from '@/e2e/pages/nav-page';
import { kubectl, retry, startSlowerDesktop, teardown } from '@/e2e/utils/TestUtils';

test.describe.serial('Dashboard', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let dashboardPage: Page;

  test.beforeAll(async({ colorScheme }, testInfo) => {
    [electronApp, page] = await startSlowerDesktop(testInfo, {
      kubernetes: {
        enabled: true,
      },
    });
  });

  test.afterAll(({ colorScheme }, testInfo) => teardown(electronApp, testInfo));

  test('should allow opening the dashboard', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await navPage.dashboardButton.click();

    dashboardPage = await electronApp.waitForEvent('window', page => page.url().includes('/c/local/explorer'));
  });

  test('kubernetes should be available', async() => {
    expect(await retry(() => kubectl('cluster-info'))).toContain('is running at');
  });

  test('should be able to run nginx', async() => {
    // Remove previous instances
    await retry(() => kubectl('delete', 'pod', 'e2e-nginx', '--ignore-not-found'));
    await retry(() => kubectl('run', 'e2e-nginx', '--image=nginx'));
    const output = await retry(() => kubectl('get', 'pods', '--output=name'));
    expect(output.split(/\r?\n/)).toContain('pod/e2e-nginx');
    await retry(() => kubectl('wait', 'pod/e2e-nginx', '--for=condition=Ready', '--timeout=120s'));
  });

  test('should navigate to pods', async() => {
    const nav = dashboardPage.getByRole('navigation');
    await nav.getByLabel('Workloads', { exact: true }).click();
    await nav.getByLabel('Pods', { exact: true }).click();
  });

  test('should show nginx pod', async() => {
    const layout = dashboardPage.getByLabel('default layout', { exact: true });
    await layout.getByText('e2e-nginx', { exact: true }).click();
    // spell-checker:disable-next-line
    const details = layout.locator('div[componenttestid="resource-details"]');
    await expect(details).toBeVisible();
    const table = details.locator('section#containers');
    await expect(table).toBeVisible();
    await expect(table.getByTestId('sortable-cell-0-2')).toHaveText('e2e-nginx');
  });

  test('should allow viewing logs', async() => {
    const layout = dashboardPage.getByLabel('default layout', { exact: true });
    // spell-checker:disable-next-line
    const table = layout.locator('div[componenttestid="resource-details"] section#containers');
    await table.getByTestId('sortable-table-0-action-button').click();
    const menuItem = layout.getByTestId('action-menu-1-item');
    await expect(menuItem).toHaveText('View Logs');
    await menuItem.click();

    // spell-checker:disable-next-line
    const windowManager = dashboardPage.getByTestId('windowmanager');
    const logs = windowManager.locator('*[id="panel-default/e2e-nginx-logs"] .logs-container');
    await expect(logs).toContainText('docker-entrypoint.sh');
  });

  test('cleanup', async() => {
    await dashboardPage.close();
    await kubectl('delete', 'pod', 'e2e-nginx');
  });
});
