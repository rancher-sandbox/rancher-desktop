import path from 'path';
import { exec } from 'child_process';
import { setTimeout } from 'timers';
import { Application } from 'spectron';
const electronPath = require('electron');

export class TestUtils {
  public app: Application | undefined;

  public setUp() {
    this.app = new Application({
      path:             electronPath as any,
      args:             [path.join(__dirname, '../../')],
      chromeDriverArgs: [
        '--no-sandbox',
        '--whitelisted-ips=',
        '--disable-dev-shm-usage',
      ],
      webdriverLogPath: './'
    });

    return this.app.start();
  }

  /**
   * Forced solution to close all electron instances after
   * tests.
   * @param pattern rancher string
   */
  public async tearDown(pattern: any) {
    const commandUnix = `pkill -f ${ pattern }`;

    // TODO: Win command

    await exec(commandUnix, (err, stdout) => {
      if (err) {
        throw err;
      }
      console.log(stdout);

      return new Promise((resolve) => {
        setTimeout(resolve, 2000);
      });
    });
  }

  public setupJestTimeout() {
    const jestCiTimeout = 60000;
    const jestDevTimeout = 30000;

    if (process.env.CI) {
      jest.setTimeout(jestCiTimeout);
    } else {
      jest.setTimeout(jestDevTimeout);
    }
  }
}
