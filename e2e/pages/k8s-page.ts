import { Page, Locator } from 'playwright';
import { expect } from '@playwright/test';

export class K8sPage {
    readonly page: Page;
    readonly memorySlider: Locator;
    readonly cpuSlider: Locator;
    readonly port: Locator;
    readonly resetButton: Locator;

    constructor(page: Page) {
      this.page = page;
      this.memorySlider = page.locator('[id="memoryInGBWrapper"]');
      this.cpuSlider = page.locator('[id="numCPUWrapper"]');
      this.port = page.locator('[data-test="portConfig"]');
      this.resetButton = page.locator('[data-test="k8sResetBtn"]');
    }
}
