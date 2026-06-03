import { Locator, Page } from '@playwright/test';

import { ContainerInspectPage } from './container-inspect-page';
import { ContainerLogsPage } from './container-logs-page';
import { ContainerShellPage } from './container-shell-page';

type tabNames = 'info' | 'logs' | 'shell';

export class ContainerInfoPage {
  readonly page: Page;
  readonly tab:  Locator;

  constructor(page: Page) {
    this.page = page;
    this.tab = page.getByTestId('tab-info');
  }

  navigateToTab(tabName: 'info'): Promise<ContainerInspectPage>;
  navigateToTab(tabName: 'logs'): Promise<ContainerLogsPage>;
  navigateToTab(tabName: 'shell'): Promise<ContainerShellPage>;
  async navigateToTab(tabName: tabNames) {
    await this.page.getByTestId(`tab-${ tabName }`).click();
    return new ({
      info:  ContainerInspectPage,
      logs:    ContainerLogsPage,
      shell:   ContainerShellPage,
    }[tabName])(this.page);
  }
}
