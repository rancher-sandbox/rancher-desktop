import util from 'util';
import { expect } from 'chai';
import { SpectronClient } from 'spectron';

import commonSetup from './common-setup';

describe('Rancher Desktop', function() {
  commonSetup.apply(this);

  let client: SpectronClient;

  beforeEach(function() {
    client = this.app.client;
  });

  it('dummy test', () => {
    expect(1).to.equal(1);
  });

  it('creates initial windows', async() => {
    const count = await client.getWindowCount();

    expect(count).to.equal(1);
  });

  it('should display message saying App works !', async() => {
    await client.waitUntilWindowLoaded(60_000);
    const text = await (await client.$('.wrapper')).getText();

    expect(text).to.contain('Welcome');
  });
});
