import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

export class ContainerShellPage {
  readonly page:    Page;
  readonly tab:     Locator;
  readonly terminal: Locator;
  readonly notRunningBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tab              = page.getByTestId('tab-shell');
    this.terminal         = page.getByTestId('terminal');
    this.notRunningBanner = page.getByTestId('shell-not-running');
  }

  async clickTab() {
    await this.tab.click();
  }

  async waitForTerminal() {
    await expect(this.terminal).toBeVisible({ timeout: 15_000 });
  }

  /** Type a command and press Enter, using the hidden xterm textarea. */
  async runCommand(command: string) {
    // xterm.js captures keyboard events through a hidden textarea; clicking
    // the terminal container first ensures it is focused.
    await this.terminal.click();
    await this.page.keyboard.type(command);
    await this.page.keyboard.press('Enter');
  }

  /**
   * Read terminal content via the xterm.js buffer API.
   * The DOM `.xterm-rows` layer is empty when Canvas renderer is used, so we
   * read directly from the terminal buffer exposed via __xtermTerminal.
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
   * Wait for the shell to emit its first prompt before sending commands.
   * The shell prompt must appear before execId is set in ContainerShell.vue,
   * so any runCommand() call before this returns will silently drop input.
   */
  async waitForShellReady(timeout = 20_000) {
    await expect.poll(
      async() => (await this.getTerminalText()).trim().length > 0,
      { timeout },
    ).toBe(true);
  }
}
