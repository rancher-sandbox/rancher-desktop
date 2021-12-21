import path from 'path';
import os from 'os';
import fs from 'fs';
import { Paths, DarwinPaths, LinuxPaths, Win32Paths } from '../../src/utils/paths';

type pathsClassType = typeof DarwinPaths|typeof LinuxPaths|typeof Win32Paths;
export class TestUtils {
  /**
   * Create empty default settings to bypass gracefully
   * FirstPage window.
   */
  public createDefaultSettings() {
    const pathInfo: Record<string, pathsClassType> = {
      darwin: DarwinPaths,
      linux:  LinuxPaths,
      win32:  Win32Paths,
    };

    this.createSettingsFile((new pathInfo[os.platform()]()).config);
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
