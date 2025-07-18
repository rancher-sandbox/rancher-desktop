import type { Page, Locator } from '@playwright/test';

export class KubernetesNav {
  readonly page:                          Page;
  readonly nav:                           Locator;
  readonly kubernetesToggle:              Locator;
  readonly kubernetesVersion:             Locator;
  readonly kubernetesPort:                Locator;
  readonly kubernetesOptions:             Locator;
  readonly kubernetesVersionLockedFields: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-kubernetes"]');
    this.kubernetesToggle = page.locator('[data-test="kubernetesToggle"]');
    this.kubernetesVersion = page.locator('[data-test="kubernetesVersion"]');
    this.kubernetesPort = page.locator('[data-test="kubernetesPort"]');
    this.kubernetesOptions = page.locator('[data-test="kubernetesOptions"]');
    this.kubernetesVersionLockedFields = page.locator('[data-test="kubernetesVersion"] > .select-k8s-version > .icon-lock');
  }
}
