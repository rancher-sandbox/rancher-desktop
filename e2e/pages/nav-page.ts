import util from 'util';

import { ContainersPage } from './containers-page';
import { DiagnosticsPage } from './diagnostics-page';
import { ExtensionsPage } from './extensions-page';
import { ImagesPage } from './images-page';
import { K8sPage } from './k8s-page';
import { PortForwardPage } from './portforward-page';
import { SnapshotsPage } from './snapshots-page';
import { TroubleshootingPage } from './troubleshooting-page';
import { VolumesPage } from './volumes-page';
import { WSLIntegrationsPage } from './wsl-integrations-page';
import { tool } from '../utils/TestUtils';

import type { Locator, Page } from '@playwright/test';

const pageConstructors = {
  General:         (page: Page) => page,
  K8s:             (page: Page) => new K8sPage(page),
  WSLIntegrations: (page: Page) => new WSLIntegrationsPage(page),
  Containers:      (page: Page) => new ContainersPage(page),
  PortForwarding:  (page: Page) => new PortForwardPage(page),
  Images:          (page: Page) => new ImagesPage(page),
  Troubleshooting: (page: Page) => new TroubleshootingPage(page),
  Snapshots:       (page: Page) => new SnapshotsPage(page),
  Diagnostics:     (page: Page) => new DiagnosticsPage(page),
  Extensions:      (page: Page) => new ExtensionsPage(page),
  Volumes:         (page: Page) => new VolumesPage(page),
};

export class NavPage {
  readonly page:              Page;
  readonly progressBar:       Locator;
  readonly mainTitle:         Locator;
  readonly preferencesButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mainTitle = page.locator('[data-test="mainTitle"]');
    this.progressBar = page.locator('.progress');
    this.preferencesButton = page.getByTestId('preferences-button');
  }

  protected async getBackendState(): Promise<string> {
    try {
      return JSON.parse(await tool('rdctl', 'api', '/v1/backend_state')).vmState;
    } catch {
      return 'NOT_READY';
    }
  }

  protected async moveToNextState(currentState: string, timeout: number): Promise<string> {
    const start = new Date().valueOf();
    const expired = start + timeout;
    const delay = 500; // msec

    while (true) {
      try {
        const nextState = JSON.parse(await tool('rdctl', 'api', '/v1/backend_state')).vmState;

        if (nextState !== currentState) {
          return nextState;
        }
      } catch (e: any) {
        console.log(`Error trying to get backend state: ${ e }`);
      }
      const now = new Date().valueOf();

      if (now >= expired) {
        throw new Error(`app watcher timed out at state ${ currentState } waiting for state change after ${ timeout / 1000 } seconds`);
      }
      await util.promisify(setTimeout)(delay);
    }
  }

  /**
   * This process wait the progress bar to be visible and then
   * waits until the progress bar be detached/hidden.
   * This is a workaround until we implement:
   * https://github.com/rancher-sandbox/rancher-desktop/issues/1217
   */
  /*
    STOPPED = 'STOPPED', // The engine is not running.
    STARTING = 'STARTING', // The engine is attempting to start.
    STARTED = 'STARTED', // The engine is started; the dashboard is not yet ready.
    STOPPING = 'STOPPING', // The engine is attempting to stop.
    ERROR = 'ERROR', // There is an error and we cannot recover automatically.
    DISABLED = 'DISABLED', // The container backend is ready but the Kubernetes engine is disabled.
    NOT_READY = 'NOT_READY', // call to `rdctl api /v1/backend_state` failed, so assume the server isn't ready
   */

  // Implement a state-machine based on the backend states until we hit STOPPED, DISABLED, or ERROR, or timeout
  // Then verify the progress bar is gone
  async progressBecomesReady() {
    const timeout = 900_000;
    const maxAllowedStateChanges = 20;
    let i;
    let backendState = await this.getBackendState();
    const finalStates = ['STARTED', 'ERROR', 'DISABLED'];

    for (i = 0; i < maxAllowedStateChanges && !finalStates.includes(backendState); i++) {
      if (backendState !== 'STARTING') {
        console.log(`Backend is currently at state ${ backendState }, waiting for a change...`);
      }
      backendState = await this.moveToNextState(backendState, timeout);
    }
    if (i === maxAllowedStateChanges && !finalStates.includes(backendState)) {
      throw new Error(`The backend is stuck in state ${ backendState }; doesn't look good`);
    }

    // Wait until progress bar be detached. With that we can make sure the services were started
    // This seems to sometimes return too early; actually check the result.
    while (await this.progressBar.count() > 0) {
      await this.progressBar.waitFor({ state: 'detached', timeout: Math.round(timeout * 0.6) });
    }
  }

  /**
   * Navigate to a given tab, returning the page object model appropriate for
   * the destination tab.
   */
  async navigateTo<pageName extends keyof typeof pageConstructors>(tab: pageName):
  Promise<ReturnType<typeof pageConstructors[pageName]>>;

  async navigateTo(tab: keyof typeof pageConstructors) {
    await this.page.click(`.nav li[item="/${ tab }"] a`);
    await this.page.waitForURL(`**/${ tab }`, { timeout: 60_000 });

    return pageConstructors[tab](this.page);
  }
}
