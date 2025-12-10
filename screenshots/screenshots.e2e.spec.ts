import os from 'os';
import path from 'path';

import { test, expect, _electron } from '@playwright/test';

import { MainWindowScreenshots, PreferencesScreenshots } from './Screenshots';
import { containersList } from './test-data/containers';
import { imagesList } from './test-data/images';
import { lockedSettings } from './test-data/preferences';
import { snapshotsList } from './test-data/snapshots';
import { volumesList } from './test-data/volumes';
import { NavPage } from '../e2e/pages/nav-page';
import { PreferencesPage } from '../e2e/pages/preferences';
import { clearUserProfile } from '../e2e/utils/ProfileUtils';
import {
  createDefaultSettings, setUserProfile, retry, teardown, tool, startRancherDesktop, reportAsset,
} from '../e2e/utils/TestUtils';

import { ContainerEngine, CURRENT_SETTINGS_VERSION } from '@pkg/config/settings';
import { Log } from '@pkg/utils/logging';
import { ContainerLogsPage } from 'e2e/pages/container-logs-page';

import type { ElectronApplication, Page } from '@playwright/test';

const isWin = os.platform() === 'win32';
const isMac = os.platform() === 'darwin';
let console: Log;

test.describe.serial('Main App Test', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let navPage: NavPage;
  let screenshot: MainWindowScreenshots;
  const afterCheckedTimeout = 200;

  test.beforeAll(async({ colorScheme }, testInfo) => {
    createDefaultSettings({
      application:     { updater: { enabled: false } },
      containerEngine: {
        allowedImages: { enabled: false, patterns: ['rancher/example'] },
        name:          ContainerEngine.CONTAINERD,
      },
      diagnostics: { showMuted: true, mutedChecks: { MOCK_CHECKER: true } },
    });

    await setUserProfile(
      { version: 11 as typeof CURRENT_SETTINGS_VERSION, containerEngine: { allowedImages: { enabled: true, patterns: [] } } },
      {},
    );

    electronApp = await startRancherDesktop(testInfo, { mock: false });
    console = new Log(path.basename(import.meta.filename, '.ts'), reportAsset(testInfo, 'log'));

    page = await electronApp.firstWindow();
    navPage = new NavPage(page);
    screenshot = new MainWindowScreenshots(page, { directory: `${ colorScheme }/main`, log: console });

    await page.emulateMedia({ colorScheme });
    await (await electronApp.browserWindow(page)).evaluate(browserWindow => {
      // Ensure the window is of the correct size, and near the top left corner
      // in case the screen is too small.  But it needs to be lower than the
      // macOS menu bar.
      browserWindow.setBounds({ x: 64, y: 64, width: 1024, height: 768 });
    });

    await navPage.progressBecomesReady();

    await page.waitForTimeout(2500);

    await retry(async() => {
      await tool('rdctl', 'extension', 'install', 'splatform/epinio-docker-desktop');
    }, { tries: 5 });
    await retry(async() => {
      await tool('rdctl', 'extension', 'install', 'docker/logs-explorer-extension');
    }, { tries: 5 });

    const navExtension = page.locator('[data-test="extension-nav-epinio"]');

    await expect(navExtension).toBeVisible({ timeout: 30000 });
  });

  test.afterAll(async({ colorScheme }, testInfo) => {
    await clearUserProfile();
    await tool('rdctl', 'extension', 'uninstall', 'splatform/epinio-docker-desktop');
    await tool('rdctl', 'extension', 'uninstall', 'docker/logs-explorer-extension');

    return teardown(electronApp, testInfo);
  });

  test.describe('Main Page', () => {
    test('General Page', async({ colorScheme }) => {
      await screenshot.take('General', navPage);
    });

    test('Containers Page', async() => {
      // Override the containers before the Vuex state is loaded.
      await navPage.page.exposeFunction('listContainersMock', (options?: any) => {
        return Promise.resolve(containersList);
      });
      await navPage.page.evaluate(() => {
        const { ddClient, listContainersMock } = window as any;
        ddClient.docker._listContainers = ddClient.docker.listContainers;
        ddClient.docker.listContainers = listContainersMock;
      });

      try {
        const containersPage = await navPage.navigateTo('Containers');

        await expect(containersPage.page.getByRole('row')).toHaveCount(11);
        await screenshot.take('Containers');
      } finally {
        await navPage.page.evaluate(() => {
          const { ddClient } = window as any;
          ddClient.docker.listContainers = ddClient.docker._listContainers;
          delete ddClient.docker._listContainers;
        });
      }
    });

    test('Container Logs Page', async({ colorScheme }) => {
      const containersPage = await navPage.navigateTo('Containers');

      await containersPage.waitForTableToLoad();
      await expect(containersPage.page.getByRole('row')).toHaveCount(11);

      await containersPage.page.evaluate(() => {
        const { ddClient } = window as any;
        ddClient.docker.cli._exec = ddClient.docker.cli.exec;
        ddClient.docker.cli.exec = (command, args, options) => {
          if (command === 'logs') {
            setTimeout(() => {
              const sampleLogs = [
                '2025-01-15T10:30:15.123456789Z PostgreSQL Database directory appears to contain a database; Skipping initialization',
                '2025-01-15T10:30:15.234567890Z LOG:  starting PostgreSQL 15.5 on x86_64-pc-linux-gnu',
                '2025-01-15T10:30:15.345678901Z LOG:  listening on IPv4 address "0.0.0.0", port 5432',
                '2025-01-15T10:30:15.456789012Z LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"',
                '2025-01-15T10:30:15.567890123Z LOG:  database system was shut down at 2025-01-15 10:28:45 UTC',
                '2025-01-15T10:30:15.678901234Z LOG:  database system is ready to accept connections',
                '2025-01-15T10:31:20.789012345Z LOG:  checkpoint starting: time',
                '2025-01-15T10:32:25.890123456Z LOG:  checkpoint complete: wrote 42 buffers (0.3%); 0 WAL file(s) added, 0 removed, 0 recycled',
                '2025-01-15T10:35:30.901234567Z LOG:  received smart shutdown request',
                '2025-01-15T10:35:30.912345678Z LOG:  database system is shut down',
              ];

              for (const log of sampleLogs) {
                options.stream.onOutput({ stdout: log + '\r\n' });
              }
            }, 100);

            return { close: () => {} };
          }
          return ddClient.docker.cli._exec(command, args, options);
        };
      });

      try {
        const containerId = containersList[0].Id;

        await containersPage.waitForContainerToAppear(containerId);
        await containersPage.viewContainerInfo(containerId);

        await containersPage.page.waitForURL('**/containers/info/**');

        const containerLogsPage = new ContainerLogsPage(containersPage.page);
        await containerLogsPage.waitForLogsToLoad();
        await expect(containerLogsPage.containerInfo).toBeVisible();
        await expect(containerLogsPage.terminal).toBeVisible();
        await expect(containerLogsPage.loadingIndicator).not.toBeVisible();

        await screenshot.take('Container-Logs');
      } finally {
        await containersPage.page.evaluate(() => {
          const { ddClient } = window as any;
          if (ddClient.docker.cli._exec) {
            ddClient.docker.cli.exec = ddClient.docker.cli._exec;
            delete ddClient.docker.cli._exec;
          }
        });
      }
    });

    test('PortForwarding Page', async({ colorScheme }) => {
      const portForwardingPage = await navPage.navigateTo('PortForwarding');

      await expect(portForwardingPage.page.getByRole('row')).toHaveCount(4);
      await screenshot.take('PortForwarding', navPage);
    });

    test('Images Page', async({ colorScheme }) => {
      await navPage.page.exposeFunction('imagesListMock', () => {
        return imagesList;
      });

      const imagesPage = await navPage.navigateTo('Images');

      await expect(imagesPage.rows).toBeVisible();
      await screenshot.take('Images');
    });

    test('Volumes Page', async({ colorScheme }) => {
      // Override the volumes before Vuex state is loaded.
      await navPage.page.exposeFunction('listVolumesMock', (options?: any) => {
        return volumesList;
      });
      await navPage.page.evaluate(() => {
        const { ddClient, listVolumesMock } = window as any;
        ddClient.docker._rdListVolumes = ddClient.docker.rdListVolumes;
        ddClient.docker.rdListVolumes = listVolumesMock;
      });

      try {
        const volumesPage = await navPage.navigateTo('Volumes');

        await expect(volumesPage.page.locator('.volumesTable')).toBeVisible();
        await expect(volumesPage.page.getByRole('row')).toHaveCount(7);
        await screenshot.take('Volumes');
      } finally {
        await navPage.page.evaluate(() => {
          const { ddClient } = window as any;
          ddClient.docker.rdListVolumes = ddClient.docker._rdListVolumes;
          delete ddClient.docker._rdListVolumes;
        });
      }
    });

    test('Troubleshooting Page', async({ colorScheme }) => {
      await screenshot.take('Troubleshooting', navPage);
    });

    test('Diagnostics Page', async({ colorScheme }) => {
      const diagnosticsPage = await navPage.navigateTo('Diagnostics');

      // show diagnostics badge
      await expect(diagnosticsPage.diagnostics).toBeVisible();
      await diagnosticsPage.checkerRows('MOCK_CHECKER').muteButton.click();
      // wait for the red bullet to appear on the Diagnostics page label
      await page.waitForTimeout(1000);

      await screenshot.take('Diagnostics');
    });

    test('Snapshots Page', async({ colorScheme }) => {
      const snapshotsPage = await navPage.navigateTo('Snapshots');

      await expect(snapshotsPage.snapshotsPage).toBeVisible();
      // Wait for create button to be actively visible
      await expect(snapshotsPage.createSnapshotButton).toBeVisible();
      await screenshot.take('Snapshots-Empty');

      await snapshotsPage.createSnapshotButton.click();
      // Wait for create button to disappear
      await expect(snapshotsPage.createSnapshotButton).not.toBeVisible();
      await expect(snapshotsPage.createSnapshotNameInput).toBeVisible();
      await expect(snapshotsPage.createSnapshotDescInput).toBeVisible();
      await snapshotsPage.createSnapshotNameInput.fill('Snapshot 1');
      await snapshotsPage.createSnapshotDescInput.fill('Snapshot 1 description');
      await screenshot.take('Snapshot-Create');

      await page.route(/^.*\/snapshots/, async(route) => {
        await route.fulfill(snapshotsList);
      });
      await navPage.navigateTo('Snapshots');
      await expect(snapshotsPage.snapshotsPage).toBeVisible();
      await screenshot.take('Snapshots-List');
    });

    test('Extensions Page', async({ colorScheme }) => {
      const extensionsPage = await navPage.navigateTo('Extensions');

      await expect(extensionsPage.cardEpinio).toBeVisible({ timeout: 30_000 });
      await screenshot.take('Extensions');

      await extensionsPage.tabInstalled.click();

      // Should have the heading, Epinio, and Logs Explorer.
      await expect(extensionsPage.page.getByRole('row')).toHaveCount(3);
      await screenshot.take('Extensions-Installed');

      await extensionsPage.tabCatalog.click();
    });
  });

  test.describe('Preferences Page', () => {
    let prefScreenshot: PreferencesScreenshots;
    let preferencesPage: Page;
    let e2ePreferences: PreferencesPage;

    test.beforeAll(async({ colorScheme }) => {
      await navPage.preferencesButton.click();
      await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));
      preferencesPage = electronApp.windows()[1];
      await preferencesPage.emulateMedia({ colorScheme });
      e2ePreferences = new PreferencesPage(preferencesPage);
      prefScreenshot = new PreferencesScreenshots(preferencesPage, e2ePreferences, { directory: `${ colorScheme }/preferences`, log: console });
    });

    test.afterAll(async({ colorScheme }) => {
      await preferencesPage.close({ runBeforeUnload: true });
    });

    test.describe('Application Page', () => {
      test('General Tab', async({ colorScheme }) => {
        // enable Apply button
        await e2ePreferences.application.automaticUpdatesCheckbox.click();
        await preferencesPage.waitForTimeout(200);

        await prefScreenshot.take('application', 'tabGeneral');
      });

      test('Behavior Tab', async() => {
        await e2ePreferences.application.nav.click();
        await e2ePreferences.application.tabBehavior.click();
        await expect(e2ePreferences.application.autoStart).toBeVisible();
        await prefScreenshot.take('application', 'tabBehavior');
      });

      test('Environment Tab', async() => {
        test.skip( isWin, 'Linux & Mac only test');

        await e2ePreferences.application.nav.click();
        await e2ePreferences.application.tabEnvironment.click();
        await expect(e2ePreferences.application.pathManagement).toBeVisible();
        await prefScreenshot.take('application', 'tabEnvironment');
      });
    });

    test.describe('WSL Page', () => {
      test.skip( !isWin, 'Windows only test');

      test('Network Tab', async() => {
        await e2ePreferences.wsl.nav.click();
        await prefScreenshot.take('wsl', 'tabNetwork');
      });

      test('Integrations Tab', async() => {
        await e2ePreferences.wsl.tabIntegrations.click();
        await expect(e2ePreferences.wsl.wslIntegrations).toBeVisible();
        await prefScreenshot.take('wsl', 'tabIntegrations');
      });

      test('Proxy Tab', async() => {
        await e2ePreferences.wsl.tabProxy.click();
        await expect(e2ePreferences.wsl.addressTitle).toBeVisible();
        await prefScreenshot.take('wsl', 'tabProxy');
      });
    });

    test.describe('Virtual Machine Page', () => {
      test.skip(isWin, 'Linux & Mac only tests');

      test('Hardware Tab', async() => {
        await e2ePreferences.virtualMachine.nav.click();
        await expect(e2ePreferences.virtualMachine.memory).toBeVisible();
        await prefScreenshot.take('virtualMachine', 'tabHardware');
      });

      test('VolumesTab', async() => {
        await e2ePreferences.virtualMachine.tabVolumes.click();
        await expect(e2ePreferences.virtualMachine.mountType).toBeVisible();
        await prefScreenshot.take('virtualMachine', 'tabVolumes');

        await e2ePreferences.virtualMachine.ninep.click();
        await expect(e2ePreferences.virtualMachine.ninep).toBeChecked();
        await page.waitForTimeout(afterCheckedTimeout);
        await prefScreenshot.take('virtualMachine', 'tabVolumes_9P');
      });

      test.describe('Mac only tests', () => {
        test.skip(!isMac, 'Mac only test');

        test('EmulationTab', async() => {
          await e2ePreferences.virtualMachine.tabEmulation.click();
          await expect(e2ePreferences.virtualMachine.vmType).toBeVisible();
          await prefScreenshot.take('virtualMachine', 'tabEmulation');
        });

        test('VolumesTab-virtiofs', async() => {
          if (await e2ePreferences.virtualMachine.vz.isEnabled()) {
            await e2ePreferences.virtualMachine.vz.click();
            await expect(e2ePreferences.virtualMachine.vz).toBeChecked();
          }

          await e2ePreferences.virtualMachine.tabVolumes.click();
          if (await e2ePreferences.virtualMachine.virtiofs.isEnabled()) {
            await e2ePreferences.virtualMachine.virtiofs.click();
            await expect(e2ePreferences.virtualMachine.virtiofs).toBeChecked();
            await page.waitForTimeout(afterCheckedTimeout);
            await prefScreenshot.take('virtualMachine', 'tabVolumes_virtiofs');
          }
        });

        test('EmulationTab-vz', async() => {
          await e2ePreferences.virtualMachine.tabEmulation.click();
          if (await e2ePreferences.virtualMachine.vz.isEnabled()) {
            await prefScreenshot.take('virtualMachine', 'tabEmulation_vz');
          }
        });
      });
    });

    test.describe('Container Engine Page', () => {
      test('GeneralTab', async() => {
        await prefScreenshot.take('containerEngine', 'tabGeneral');
      });

      test('AllowedImagesTab', async() => {
        await e2ePreferences.containerEngine.nav.click();
        await e2ePreferences.containerEngine.tabAllowedImages.click();
        await expect(e2ePreferences.containerEngine.allowedImages).toBeVisible();
        await e2ePreferences.containerEngine.allowedImagesCheckbox.click();
        await page.waitForTimeout(afterCheckedTimeout);

        await prefScreenshot.take('containerEngine', 'tabAllowedImages');
      });
    });

    test('Kubernetes Page', async() => {
      await prefScreenshot.take('kubernetes');
    });
  });

  test.describe('Preferences Page, locked fields', () => {
    // ToDo, locked fields tooltips are not captured on Windows.

    let prefScreenshot: PreferencesScreenshots;
    let prefPage: Page;
    let preferencesPage: Page;
    let e2ePreferences: PreferencesPage;

    test.beforeAll(async({ colorScheme }) => {
      await navPage.preferencesButton.click();

      prefPage = await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));
      // Mock locked Fields API response
      await prefPage.route(/^.*\/settings\/locked/, async(route) => {
        await route.fulfill(lockedSettings);
      });

      preferencesPage = electronApp.windows()[1];
      await preferencesPage.emulateMedia({ colorScheme });
      e2ePreferences = new PreferencesPage(preferencesPage);
      prefScreenshot = new PreferencesScreenshots(preferencesPage, e2ePreferences,
        { directory: `${ colorScheme }/preferences`, log: console });
    });

    test.afterAll(async({ colorScheme }) => {
      await preferencesPage.close({ runBeforeUnload: true });
    });

    test('Allowed Images - locked fields', async() => {
      await e2ePreferences.containerEngine.nav.click();
      await e2ePreferences.containerEngine.tabAllowedImages.click();
      await expect(e2ePreferences.containerEngine.allowedImages).toBeVisible();

      await e2ePreferences.containerEngine.enabledLockedField.hover();
      await preferencesPage.waitForTimeout(250);
      await prefScreenshot.take('containerEngine', 'tabAllowedImages_lockedFields');
    });

    test('Kubernetes - locked fields', async() => {
      await e2ePreferences.kubernetes.nav.click();
      await expect(e2ePreferences.kubernetes.kubernetesVersionLockedFields).toBeVisible();

      await e2ePreferences.kubernetes.kubernetesVersionLockedFields.hover();
      await preferencesPage.waitForTimeout(250);
      await prefScreenshot.take('kubernetes', 'lockedFields');
    });
  });

  test('Intro Image', async({ colorScheme }) => {
    await navPage.navigateTo('General');
    const bounds = await navPage.page.evaluate(() => {
      window.resizeTo(1024, 768);

      return {
        top: window.screenTop, left: window.screenLeft, width: window.outerWidth, height: window.outerHeight,
      };
    });

    await navPage.preferencesButton.click();
    await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));
    const preferencesPage = electronApp.windows()[1];

    await preferencesPage.evaluate((bounds) => {
      const {
        top, left, width, height,
      } = bounds;

      window.moveTo(left + (width - window.outerWidth) / 2, top + (height - window.outerHeight) / 2);
    }, bounds);

    try {
      await preferencesPage.emulateMedia({ colorScheme });
      await preferencesPage.waitForTimeout(250);
      await preferencesPage.bringToFront();
      await screenshot.take('intro', true);
    } finally {
      preferencesPage.close({ runBeforeUnload: true });
    }
  });
});
