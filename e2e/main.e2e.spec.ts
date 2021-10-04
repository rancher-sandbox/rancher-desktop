
import path from 'path';
import os from 'os';
import { Application, SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';
import NavBarPage from './pages/navbar';
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
  });

  afterAll(async() => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  it('should open the main window', async() => {
    await client.waitUntilWindowLoaded();
    // typescript doesn't see a value of await in below statement, but
    // removing await makes the statement not wait till the app window loads
    // Also, Alternate ways to get the app window title, for example using client
    // didn't work. So, Leaving 'await' for now. We may need to review this and
    // fix this in future.
    await app.client.saveScreenshot('./screenshots/open_window.png');
    const title = await browserWindow.getTitle();

    expect(title).toBe('Rancher Desktop');
  });

  it('should display welcome message in general tab', async() => {
    const generalPage = await navBarPage.getGeneralPage();

    await app.client.saveScreenshot('./screenshots/general.png');
    expect(generalPage).not.toBeNull();
    expect(await generalPage?.getTitle()).toBe('Welcome to Rancher Desktop');
  });

  it('should switch to Kubernetes Settings tab', async() => {
    const kubernetesPage = await navBarPage.getKubernetesPage();

    await app.client.saveScreenshot('./screenshots/kubernetes_settings.png');
    expect(kubernetesPage).not.toBeNull();
    expect(await kubernetesPage?.getResetKubernetesButtonText()).toBe('Reset Kubernetes');
  });

  it('should switch to Port Forwarding tab', async() => {
    const portForwardingPage = await navBarPage.getPortForwardingPage();

    await app.client.saveScreenshot('./screenshots/forwarding.png');
    if (os.platform().startsWith('win')) {
      expect(portForwardingPage).not.toBeNull();
    } else {
      expect(portForwardingPage).toBeNull();
    }
  });

  it('should switch to Images tab', async() => {
    const imagesPage = await navBarPage.getImagesPage();

    await app.client.saveScreenshot('./screenshots/image_tab.png');
    expect(imagesPage).not.toBeNull();
  });

  it('should switch to Troubleshooting tab', async() => {
    const troubleShootingPage = await navBarPage.getTroubleshootingPage();

    await app.client.saveScreenshot('./screenshots/troubleshooting.png');
    expect(troubleShootingPage).not.toBeNull();
    expect(await troubleShootingPage?.getFactoryResetButtonText()).toBe('Factory Reset');
  });
});
