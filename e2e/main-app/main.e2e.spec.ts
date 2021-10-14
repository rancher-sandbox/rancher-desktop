import os from 'os';
import { Application, SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';
import NavBarPage from '../pages/navbar';
import { TestUtils } from '../utils/TestUtils';

const electronPath = require('electron');

describe('Rancher Desktop', () => {
  let utils: TestUtils;
  let app: Application;
  let client: SpectronClient;
  let browserWindow: BrowserWindow;
  let navBarPage: NavBarPage;

  beforeAll(async() => {
    utils = new TestUtils();
    utils.setupJestTimeout();
    app = await utils.setUp();

    if (app && app.isRunning()) {
      client = app.client;
      browserWindow = app.browserWindow;
      navBarPage = new NavBarPage(app);

      return await app.client.waitUntilWindowLoaded();
    } else {
      console.log('Application error: Does not started properly');
    }
  });

  afterAll(async(done) => {
    await utils.tearDown('rancher');
    done();
  });

  it('opens the window', async() => {
    await client.waitUntilWindowLoaded();
    const title = await browserWindow.getTitle();

    expect(title).toBe('Rancher Desktop');
  });

  it('should display welcome message in general tab', async() => {
    const generalPage = await navBarPage.getGeneralPage();

    expect(generalPage).not.toBeNull();
    expect(await generalPage?.getTitle()).toBe('Welcome to Rancher Desktop');
  });

  it('should switch to Kubernetes Settings tab', async() => {
    const kubernetesPage = await navBarPage.getKubernetesPage();

    expect(kubernetesPage).not.toBeNull();
    expect(await kubernetesPage?.getResetKubernetesButtonText()).toBe('Reset Kubernetes');
  });

  it('should switch to Port Forwarding tab', async() => {
    const portForwardingPage = await navBarPage.getPortForwardingPage();

    if (os.platform().startsWith('win')) {
      expect(portForwardingPage).not.toBeNull();
    } else {
      expect(portForwardingPage).toBeNull();
    }
  });

  it('should switch to Images tab', async() => {
    const imagesPage = await navBarPage.getImagesPage();

    expect(imagesPage).not.toBeNull();
  });

  it('should switch to Troubleshooting tab', async() => {
    const troubleShootingPage = await navBarPage.getTroubleshootingPage();

    expect(troubleShootingPage).not.toBeNull();
    expect(await troubleShootingPage?.getFactoryResetButtonText()).toBe('Factory Reset');
  });
});
