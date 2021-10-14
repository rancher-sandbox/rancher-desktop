import path from 'path';
import { platform } from 'os';
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
   * @param pattern rancher process string
   */
  public async tearDown(pattern: any) {
    if (process.env.CI) {
      return this.app?.stop();
    } else {
      const commandUnix = `pkill -f ${ pattern }`;
      const commandWin = `taskkill /f /IM ${ pattern }*`;

      if (platform() === 'darwin' || platform() === 'linux') {
        await this.forceShutdown(commandUnix);
      } else {
        await this.forceShutdown(commandWin);
      }
    }
  }

  /**
   * Receive command patter for kill electron process
   * based on OS distros
   * @param command command pattern
   */
  public async forceShutdown(command: string) {
    await exec(command, (err, stdout) => {
      if (err) {
        throw err;
      }
      console.log(stdout);

      return new Promise((resolve) => {
        setTimeout(resolve, 2000);
      });
    });
  }

  /**
   * Set jest command timeout based on env
   */
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
