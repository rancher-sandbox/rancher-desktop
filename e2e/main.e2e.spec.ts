
import path from 'path';
import os from 'os';
import { Application, SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';
import NavBarPage from './pages/navbar';
import FirstRunPage from './pages/firstrun';
import GeneralPage from './pages/general';
import KubernetesPage from './pages/kubernetes';
import PortForwardingPage from './pages/portforwarding';
import ImagesPage from './pages/images';
import TroubleshootingPage from './pages/troubleshooting';
import * as TestUtils from './utils/TestUtils';

const electronPath = require('electron');

describe('Rancher Desktop', () => {
  TestUtils.setupJestTimeout();

  let app: Application;
  let client: SpectronClient;
  let browserWindow: BrowserWindow;
  let navBarPage: NavBarPage;
  let firstRunPage: FirstRunPage;

  beforeAll(async() => {
    app = new Application({
      // 'any' typing is required for now as other alternate usage/import
      //  cause issues running the tests. Without 'any' typescript
      //  complains of type mismatch.
      path:             electronPath as any,
      args:             [path.dirname(__dirname)],
      chromeDriverArgs: [
        '--no-sandbox',
        '--whitelisted-ips=',
        '--disable-dev-shm-usage',
      ],
      webdriverLogPath: './',
    });

    await app.start();
    client = app.client;
    browserWindow = app.browserWindow;
    navBarPage = new NavBarPage(app);
    firstRunPage = new FirstRunPage(app);
  });

  afterAll(async() => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  if (process.env.CI) {
    it('should open k8s settings page - First Run', async() => {
      console.log('Into the IF');
      await client.waitUntilWindowLoaded();

      const k8sSettings = await firstRunPage.getK8sVersionHeaderText();
      const acceptBtnSelector = '[data-test="accept-btn"]';

      expect(k8sSettings).toBe('Welcome to Rancher Desktop');

      // It closes k8s settings page
      (await client.$(acceptBtnSelector)).waitForExist();
      (await client.$(acceptBtnSelector)).click();
    });
  } else {
    it('should open General the main window', async() => {
      await client.waitUntilWindowLoaded();
      const title = await browserWindow.getTitle();

      await client.waitUntilTextExists(title, 'Rancher Desktop', 10000);

      await app.client.saveScreenshot('./open_window.png'); // Debug CI only

      expect(title).toBe('Rancher Desktop');
    });
  }

  it('should display welcome message in general tab', async() => {
    const generalPage = await navBarPage.getGeneralPage();

    await app.client.saveScreenshot('./general.png'); // Debug CI only
    expect(generalPage).not.toBeNull();
    expect(await generalPage?.getTitle()).toBe('Welcome to Rancher Desktop');
  });

  it('should switch to Kubernetes Settings tab', async() => {
    const kubernetesPage = await navBarPage.getKubernetesPage();

    await app.client.saveScreenshot('./kubernetes_settings.png'); // Debug CI only
    expect(kubernetesPage).not.toBeNull();
    expect(await kubernetesPage?.getResetKubernetesButtonText()).toBe('Reset Kubernetes');
  });

  it('should switch to Port Forwarding tab', async() => {
    const portForwardingPage = await navBarPage.getPortForwardingPage();

    await app.client.saveScreenshot('./forwarding.png'); // Debug CI only
    if (os.platform().startsWith('win')) {
      expect(portForwardingPage).not.toBeNull();
    } else {
      expect(portForwardingPage).toBeNull();
    }
  });

  it('should switch to Images tab', async() => {
    const imagesPage = await navBarPage.getImagesPage();

    await app.client.saveScreenshot('./image_tab.png'); // Debug CI only
    expect(imagesPage).not.toBeNull();
  });

  it('should switch to Troubleshooting tab', async() => {
    const troubleShootingPage = await navBarPage.getTroubleshootingPage();

    await app.client.saveScreenshot('./troubleshooting.png'); // Debug CI only
    expect(troubleShootingPage).not.toBeNull();
    expect(await troubleShootingPage?.getFactoryResetButtonText()).toBe('Factory Reset');
  });
});
