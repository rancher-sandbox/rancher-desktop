import path from 'path';
import os from 'os';
import { Application } from 'spectron';
import NavBarPage from './pages/navbar';
const electronPath = require('electron');

describe('Rancher Desktop', () => {
  jest.setTimeout(60000);
  let navBarPage: NavBarPage;

  const app = new Application({
    path: electronPath as any,
    args: [path.dirname(__dirname)]
  });

  beforeAll(async() => {
    await app.start();
    navBarPage = new NavBarPage(app);
  });

  afterAll(async() => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  it('opens the window', async() => {
    await app.client.waitUntilWindowLoaded();
    const isVisible = await app.browserWindow.isVisible();
    const title = await app.browserWindow.getTitle();

    expect(isVisible).toBe(true);
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
