import path from 'path';
import { Application, SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';
import FirstRunPage from '../pages/firstrun';
import * as TestUtils from '../utils/TestUtils';

const electronPath = require('electron');

jest.setTimeout(60_000);

describe('Rancher Desktop', () => {
  TestUtils.setupJestTimeout();

  let app: Application;
  let client: SpectronClient;
  let browserWindow: BrowserWindow;
  let firstRunPage: FirstRunPage;

  beforeAll(async() => {
    app = new Application({
      path:             electronPath as any,
      args:             [path.join(__dirname, '../../')],
      chromeDriverArgs: [
        '--no-sandbox',
        '--whitelisted-ips=',
        '--disable-dev-shm-usage',
      ],
      webdriverLogPath: './'
    });

    await app.start();
    client = app.client;
    browserWindow = app.browserWindow;
    firstRunPage = new FirstRunPage(app);
  });

  afterAll(async() => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  it('should open k8s settings page - First Run', async() => {
    await client.waitUntilWindowLoaded();

    const k8sSettings = await firstRunPage.getK8sVersionHeaderText();
    const acceptBtnSelector = '[data-test="accept-btn"]';

    expect(k8sSettings).toBe('Welcome to Rancher Desktop');

    // It closes k8s settings page
    (await client.$(acceptBtnSelector)).waitForExist();
    (await client.$(acceptBtnSelector)).click();
  });
});
