import type {Locator, Page} from '@playwright/test';

export class ContainersPage {
  readonly page: Page;
  readonly table: Locator;
  readonly namespaceSelector: Locator;

  constructor(page: Page) {
    this.page = page;
    this.table = page.locator('.sortable-table');
    this.namespaceSelector = page.locator('.select-namespace');
  }

  getContainerRow(containerId: string) {
    return this.page.locator(`tr.main-row[data-node-id="${containerId}"]`);
  }

  async waitForContainerToAppear(containerId: string, timeout = 30000) {
    const containerRow = this.getContainerRow(containerId);
    await containerRow.waitFor({state: 'visible', timeout});
  }

  async clickContainerAction(containerId: string, action: string) {
    const containerRow = this.getContainerRow(containerId);
    // The action button is in the actions column with class 'btn role-multi-action'
    await containerRow.locator('.btn.role-multi-action').click();

    // Wait for the action menu to appear and click the action by text
    const actionText = action === 'logs' ? 'Logs' :
      action === 'stop' ? 'Stop' :
        action === 'start' ? 'Start' :
          action === 'delete' ? 'Delete' : action;

    const actionLocator = this.page.getByText(actionText, {exact: true});
    await actionLocator.waitFor({state: 'visible', timeout: 5000});
    await actionLocator.click();
  }

  async viewContainerLogs(containerId: string) {
    await this.clickContainerAction(containerId, 'logs');
  }

  async stopContainer(containerId: string) {
    await this.clickContainerAction(containerId, 'stop');
  }

  async startContainer(containerId: string) {
    await this.clickContainerAction(containerId, 'start');
  }

  async deleteContainer(containerId: string) {
    await this.clickContainerAction(containerId, 'delete');
  }

  async getContainerCount(): Promise<number> {
    const rows = this.page.locator('tr.main-row');
    return await rows.count();
  }

  async waitForTableToLoad() {
    await this.table.waitFor({state: 'visible'});
  }

  async isContainerPresent(containerId: string): Promise<boolean> {
    const row = this.getContainerRow(containerId);
    return await row.count() > 0;
  }
}
