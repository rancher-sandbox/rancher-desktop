import { Page, Locator } from 'playwright';
import { expect } from '@playwright/test';

export class K8sPage {
    readonly page: Page;
    readonly k8sMemorySliderSelector: Locator;
    readonly k8sCpuSliderSelector: Locator;
    readonly k8sPortSelector: Locator;
    readonly k8sResetBtn: Locator;

    constructor(page: Page) {
      this.page = page;
      this.k8sMemorySliderSelector = page.locator('[id="memoryInGBWrapper"]');
      this.k8sCpuSliderSelector = page.locator('[id="numCPUWrapper"]');
      this.k8sPortSelector = page.locator('[data-test="portConfig"]');
      this.k8sResetBtn = page.locator('[data-test="k8sResetBtn"]');
    }

    async getK8sMemorySlider() {
      await expect(this.k8sMemorySliderSelector).toBeVisible();
    }

    async getK8sCpuSlider() {
      await expect(this.k8sCpuSliderSelector).toBeVisible();
    }

    async getK8sPort() {
      await expect(this.k8sPortSelector).toBeVisible();
    }

    async getK8sResetButton() {
      await expect(this.k8sResetBtn).toBeVisible();
    }
}
