import { expect } from '@playwright/test';

import type { Page, Locator } from '@playwright/test';

/**
 * CheckboxLocator handles assertions dealing with a <Checkbox> Vue component.
 */
class CheckboxLocator {
  readonly locator:  Locator;
  readonly checkbox: Locator;
  readonly name:     Locator;
  readonly error:    Locator;
  constructor(locator: Locator) {
    this.locator = locator;
    this.checkbox = locator.locator('input[type="checkbox"]');
    this.name = locator.locator('.checkbox-label');
    this.error = locator.locator('.checkbox-outer-container-description');
  }

  click(...args: Parameters<Locator['click']>) {
    // The checkbox itself is not visible, so it can't be clicked.
    return this.locator.click(...args);
  }

  async assertEnabled(options?:{ timeout?: number }) {
    const elem = await this.locator.elementHandle();

    expect(elem).toBeTruthy();
    const result = await elem?.waitForSelector('label:not([class~="disabled"])', { state: 'attached', ...options });

    expect(result).toBeTruthy();
  }

  async assertDisabled(options?:{ timeout?: number }) {
    const elem = await this.locator.elementHandle();

    expect(elem).toBeTruthy();
    const result = await elem?.waitForSelector('label[class~="disabled"]', { state: 'attached', ...options });

    expect(result).toBeTruthy();
  }
}

export class WSLIntegrationsPage {
  readonly page:         Page;
  readonly description:  Locator;
  readonly mainTitle:    Locator;
  readonly integrations: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mainTitle = page.locator('[data-test="mainTitle"]');
    this.description = page.locator('.description');
    this.integrations = page.locator('[data-test="integration-list"]');
  }

  getIntegration(distro: string): CheckboxLocator {
    const locator = this.integrations.locator(`[data-test="item-${ distro }"] .checkbox-outer-container`);

    return new CheckboxLocator(locator);
  }
}
