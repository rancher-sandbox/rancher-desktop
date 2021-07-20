import { expect } from 'chai';
import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

import commonSetup from './common-setup';

describe('Rancher Desktop', function() {
  commonSetup.apply(this);

  let client: SpectronClient;
  let browserWindow: BrowserWindow;

  beforeEach(function() {
    client = this.app.client;
  });

  it('opens the window', async () => {
    await client.waitUntilWindowLoaded();
    const title = await browserWindow.getTitle();

    expect(title).equals('Rancher Desktop');
  });

  it('should display message saying App works !', async() => {
    await client.waitUntilWindowLoaded(60_000);
    const text = await (await client.$('.wrapper')).getText();

    expect(text).to.contain('Welcome');
  });
});
