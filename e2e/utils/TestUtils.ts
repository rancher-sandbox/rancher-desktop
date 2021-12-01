import path from 'path';
import os from 'os';
import fs from 'fs';
import { Paths, DarwinPaths, LinuxPaths, Win32Paths } from '../../src/utils/paths';

export class TestUtils {
  /**
   * Create empty default settings to bypass gracefully
   * FirstPage window.
   */
  public createDefaultSettings() {
    let paths: Paths;

    switch (os.platform()) {
    case 'darwin': {
      paths = new DarwinPaths();
      const darwinConfigPath = paths.config;

      this.createSettingsFile(darwinConfigPath);
    }
      break;

    case 'linux': {
      paths = new LinuxPaths();
      const linuxConfigPath = paths.config;

      this.createSettingsFile(linuxConfigPath);
    }
      break;

    case 'win32': {
      paths = new Win32Paths();
      const winConfigPath = paths.config;

      this.createSettingsFile(winConfigPath);
    }
      break;
    }
  }

  public createSettingsFile(settingsPath: string) {
    const settingsData = {}; // empty array
    const settingsJson = JSON.stringify(settingsData);
    const fileSettingsName = 'settings.json';
    const settingsFullPath = path.join(settingsPath, '/', fileSettingsName);

    try {
      if (!fs.existsSync(settingsFullPath)) {
        fs.mkdirSync(settingsPath, { recursive: true });
        fs.writeFileSync(path.join(settingsPath, '/', fileSettingsName), settingsJson);
        console.log('Default settings file successfully created on: ', `${ settingsPath }/${ fileSettingsName }`);
      } else {
        console.info('Default settings file already created, skipping bypass first page');
      }
    } catch (err) {
      console.error('Error during default settings creation. Error: --> ', err);
    }
  }

  /**
   * Return a delay on ms
   * e.g. 1000ms = 1s
   * @param time
   * @returns
   */
  public async delay(time: number | undefined) {
    return await new Promise((resolve) => {
      setTimeout(resolve, time);
    });
  }
}
