import { Page, Locator } from 'playwright';

export class KubernetesNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly kubernetesToggle: Locator;
  readonly kubernetesVersion: Locator;
  readonly kubernetesPort: Locator;
  readonly traefikToggle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-kubernetes"]');
    this.kubernetesToggle = page.locator('[data-test="kubernetesToggle"]');
    this.kubernetesVersion = page.locator('[data-test="kubernetesVersion"]');
    this.kubernetesPort = page.locator('[data-test="kubernetesPort"]');
    this.traefikToggle = page.locator('[data-test="traefikToggle"]');
  }
}
