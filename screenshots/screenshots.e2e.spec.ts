import os from 'os';
import path from 'path';

import { test, expect, _electron } from '@playwright/test';

import { MainWindowScreenshots, PreferencesScreenshots } from './Screenshots';
import { containersList } from './test-data/containers';
import { lockedSettings } from './test-data/preferences';
import { snapshotsList } from './test-data/snapshots';
import { NavPage } from '../e2e/pages/nav-page';
import { PreferencesPage } from '../e2e/pages/preferences';
import { clearUserProfile } from '../e2e/utils/ProfileUtils';
import {
  createDefaultSettings, createUserProfile, reportAsset, teardown, tool
} from '../e2e/utils/TestUtils';

import { ContainerEngine, CURRENT_SETTINGS_VERSION } from '@pkg/config/settings';

import type { ElectronApplication, BrowserContext, Page } from '@playwright/test';

const isWin = os.platform() === 'win32';
const isMac = os.platform() === 'darwin';

test.describe.serial('Main App Test', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let page: Page;
  let navPage: NavPage;
  let screenshot: MainWindowScreenshots;
  const afterCheckedTimeout = 200;

  test.beforeAll(async({ colorScheme }) => {
    createDefaultSettings({
      application:     { updater: { enabled: false } },
      containerEngine: {
        allowedImages: { enabled: false, patterns: ['rancher/example'] },
        name:          ContainerEngine.CONTAINERD,
      },
      diagnostics: { showMuted: true, mutedChecks: { MOCK_CHECKER: true } },
    });

    await createUserProfile(
      { version: 10 as typeof CURRENT_SETTINGS_VERSION, containerEngine: { allowedImages: { enabled: true, patterns: [] } } },
      {},
    );

    electronApp = await _electron.launch({
      args: [
        path.join(__dirname, '../'),
        '--disable-gpu',
        '--whitelisted-ips=',
        '--disable-dev-shm-usage',
        '--no-modal-dialogs',
      ],
      env: {
        ...process.env,
        RD_LOGS_DIR: reportAsset(__filename, 'log'),
      },
    });
    context = electronApp.context();

    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await electronApp.firstWindow();
    navPage = new NavPage(page);
    screenshot = new MainWindowScreenshots(page, { directory: `${ colorScheme }/main` });

    await page.emulateMedia({ colorScheme });

    await navPage.progressBecomesReady();

    await page.waitForTimeout(2500);

    await tool('rdctl', 'extension', 'install', 'ghcr.io/rancher-sandbox/epinio-desktop-extension');
    await tool('rdctl', 'extension', 'install', 'docker/logs-explorer-extension');

    const navExtension = page.locator('[data-test="extension-nav-epinio"]');

    await expect(navExtension).toBeVisible({ timeout: 30000 });
  });

  test.afterAll(async({ colorScheme }) => {
    await clearUserProfile();
    await tool('rdctl', 'extension', 'uninstall', 'ghcr.io/rancher-sandbox/epinio-desktop-extension');
    await tool('rdctl', 'extension', 'uninstall', 'docker/logs-explorer-extension');

    return teardown(electronApp, __filename);
  });

  test.describe('Main Page', () => {
    test('General Page', async({ colorScheme }) => {
      await screenshot.take('General');
    });

    test('Containers Page', async() => {
      const prefs = JSON.parse(await tool('rdctl', 'list-settings'));
      const containerEngine = prefs.containerEngine.name;
      let expectedRowCount = -1;
      const currentNamespace = prefs.containers.namespace;
      let namespace = '';

      if (containerEngine === 'containerd') {
        // Choose which namespace to use before navigating to the page, so it's up to date.
        for (namespace of ['default', 'k8s.io', 'buildkit', 'rancher-desktop-extensions']) {
          try {
            const info = await tool('nerdctl', '-n', namespace, 'images', '--format', '{{json .ID}}');
            const idValues = info.trim().replace(/"/g, '').split(/\s+/);

            expectedRowCount = new Set(idValues).size + 1;
            if (expectedRowCount > 1) {
              if (namespace !== currentNamespace) {
                await tool('rdctl', 'set', `--containers.namespace=${ namespace }`);
              }
              break;
            }
          } catch (e) {
            console.log(`Error running nerdctl images: ${ e }`);
          }
        }
      }
      const containersPage = await navPage.navigateTo('Containers');

      if (containerEngine === 'moby') {
        await containersPage.page.exposeFunction('listContainersMock', (options?: any) => {
          return containersList;
        });
        await containersPage.page.evaluate(() => {
          // eslint-disable-next-line
          // @ts-ignore
          window.ddClient.docker.listContainers = listContainersMock;
        });
        expectedRowCount = 6;
      }
      if (expectedRowCount > 1) {
        await expect(containersPage.page.getByRole('row')).toHaveCount(expectedRowCount);
      }
      await screenshot.take('Containers');
    });

    test('PortForwarding Page', async({ colorScheme }) => {
      const portForwardingPage = await navPage.navigateTo('PortForwarding');

      await expect(portForwardingPage.page.getByRole('row')).toHaveCount(4);
      await screenshot.take('PortForwarding', navPage);
    });

    test('Images Page', async({ colorScheme }) => {
      const imagesPage = await navPage.navigateTo('Images');

      await expect(imagesPage.rows).toBeVisible();
      await screenshot.take('Images');
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

      await expect(extensionsPage.cardEpinio).toBeVisible();
      await screenshot.take('Extensions');

      await extensionsPage.tabInstalled.click();

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
      prefScreenshot = new PreferencesScreenshots(preferencesPage, e2ePreferences, { directory: `${ colorScheme }/preferences` });
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

        test('NetworkTab', async() => {
          await e2ePreferences.virtualMachine.tabNetwork.click();
          await expect(e2ePreferences.virtualMachine.socketVmNet).toBeVisible();
          await prefScreenshot.take('virtualMachine', 'tabNetwork');
        });

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
      prefScreenshot = new PreferencesScreenshots(preferencesPage, e2ePreferences, { directory: `${ colorScheme }/preferences` });
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
});
