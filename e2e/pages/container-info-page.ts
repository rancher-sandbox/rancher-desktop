import { Locator, Page } from '@playwright/test';

import { ContainerInspectPage } from './container-inspect-page';
import { ContainerLogsPage } from './container-logs-page';
import { ContainerShellPage } from './container-shell-page';
import { ContainerStatsPage } from './container-stats-page';

type tabNames = 'info' | 'logs' | 'shell' | 'stats';

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
  navigateToTab(tabName: 'stats'): Promise<ContainerStatsPage>;
  async navigateToTab(tabName: tabNames) {
    await this.page.getByTestId(`tab-${ tabName }`).click();
    return new ({
      info:  ContainerInspectPage,
      logs:  ContainerLogsPage,
      shell: ContainerShellPage,
      stats: ContainerStatsPage,
    }[tabName])(this.page);
  }
}
