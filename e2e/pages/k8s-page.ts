import type { Page, Locator } from '@playwright/test';
export class K8sPage {
  readonly page:             Page;
  readonly engineRuntime:    Locator;
  readonly memorySlider:     Locator;
  readonly resetButton:      Locator;
  readonly cpuSlider:        Locator;
  readonly port:             Locator;
  readonly enableKubernetes: Locator;

  constructor(page: Page) {
    this.page = page;
    this.memorySlider = page.locator('[id="memoryInGBWrapper"]');
    this.resetButton = page.locator('[data-test="k8sResetBtn"]');
    this.cpuSlider = page.locator('[id="numCPUWrapper"]');
    this.engineRuntime = page.locator('.engine-selector');
    this.port = page.locator('[data-test="portConfig"]');
    this.enableKubernetes = page.locator('[data-test="enableKubernetes"]');
  }
}
