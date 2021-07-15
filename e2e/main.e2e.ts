import { expect } from 'chai';
import { SpectronClient } from 'spectron';

import commonSetup from './common-setup';

describe('Rancher Desktop', function () {

  commonSetup.apply(this);

  let client: SpectronClient;

  beforeEach(function() {
    client = this.app.client;
  });

  it('dummy test', async function () {
    expect(1).to.equal(1);
  });

/*   it('creates initial windows', async function () {
    const count = await client.getWindowCount();
    expect(count).to.equal(1);
  });

  it('should display message saying App works !', async function () {
    const elem = await client.$('app-home h1');
    const text = await elem.getText();
    expect(text).to.equal('App works !');
  }); */

});
