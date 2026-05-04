import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

export class ContainerShellPage {
  readonly page:              Page;
  readonly tab:               Locator;
  readonly terminal:          Locator;
  readonly notRunningBanner:  Locator;
  readonly unsupportedBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tab = page.getByTestId('tab-shell');
    this.terminal = page.getByTestId('terminal');
    this.notRunningBanner = page.getByTestId('shell-not-running');
    this.unsupportedBanner = page.getByTestId('shell-unsupported');
  }

  async clickTab() {
    // Wait until the Shell tab is enabled (not disabled).
    // The tab is disabled when isRunning is false, which can happen briefly
    // after navigating to the container info page: the previous page's
    // beforeUnmount calls container-engine/unsubscribe (clearing the Vuex
    // containers store) before the new page's subscription has re-populated
    // it.  Clicking a disabled tab does nothing and the test would time out.
    await expect(this.tab).not.toHaveClass(/\bdisabled\b/, { timeout: 30_000 });
    await this.tab.click();
  }

  async waitForTerminal() {
    await expect(this.terminal).toBeVisible({ timeout: 30_000 });
  }

  /** Type a command and press Enter, using the hidden xterm textarea. */
  async runCommand(command: string) {
    // ContainerShell auto-focuses the terminal when the shell tab becomes
    // active for real users, but Playwright's keyboard routing requires an
    // explicit click to track the focused element correctly.
    await this.terminal.click();
    await this.page.keyboard.type(command);
    await this.page.keyboard.press('Enter');
  }

  /**
   * Read terminal content via the xterm.js buffer API.
   * ContainerShell.vue deliberately exposes the terminal instance as
   * __xtermTerminal on the container element for e2e testing.  We use the
   * buffer API rather than .xterm-rows textContent for two reasons:
   *   1. It avoids coupling to xterm's internal DOM structure, which can
   *      change between versions.
   *   2. .xterm-rows textContent concatenates all rows without line
   *      separators, so multiline patterns would never match even when the
   *      text is present across consecutive rows.
   */
  async getTerminalText(): Promise<string> {
    return this.page.evaluate(() => {
      const el = document.querySelector('[data-testid="terminal"]');
      const term = (el as any)?.__xtermTerminal;

      if (!term) return '';
      const buf = term.buffer.active;
      const lines: string[] = [];

      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);

        if (line) {
          lines.push(line.translateToString(true));
        }
      }

      return lines.join('\n');
    });
  }

  /** Wait for a text string to appear anywhere in the terminal. */
  async waitForOutput(text: string, timeout = 15_000) {
    await expect.poll(
      () => this.getTerminalText(),
      { timeout },
    ).toContain(text);
  }

  /**
   * Wait until the shell session is ready to accept input.
   * ContainerShell.vue sets data-session-active="true" on the terminal element
   * when the container-exec/ready IPC event fires (which is also when
   * sessionActive becomes true and keyboard input starts being forwarded).
   * Using an HTML attribute rather than the xterm buffer means this assertion
   * works regardless of JS evaluation world boundaries in Playwright/Electron.
   */
  async waitForShellReady(timeout = 20_000) {
    await expect(this.terminal).toHaveAttribute('data-session-active', 'true', { timeout });
  }
}
