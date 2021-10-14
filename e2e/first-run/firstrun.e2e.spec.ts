import { Application, SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';
import NavBarPage from '../pages/navbar';
import FirstRunPage from '../pages/firstrun';
import { TestUtils } from '../utils/TestUtils';

const electronPath = require('electron');

describe('Rancher Desktop - First Run', () => {
  let utils: TestUtils;
  let app: Application;
  let client: SpectronClient;
  let browserWindow: BrowserWindow;
  let firstRunPage: FirstRunPage;
  let navBarPage: NavBarPage;

  beforeAll(async() => {
    utils = new TestUtils();
    utils.setupJestTimeout();
    app = await utils.setUp();

    if (app && app.isRunning()) {
      client = app.client;
      browserWindow = app.browserWindow;
      navBarPage = new NavBarPage(app);
      firstRunPage = new FirstRunPage(app);

      return await app.client.waitUntilWindowLoaded();
    } else {
      console.log('Application error: Does not started properly');
    }
  });

  afterAll(async(done) => {
    await utils.tearDown();
    done();
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
