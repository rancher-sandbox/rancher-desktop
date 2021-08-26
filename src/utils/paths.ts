/**
 * This module describes the various paths we use to store state & data.
 */

import os from 'os';
import path from 'path';

const APP_NAME = 'rancher-desktop';
const APP_BUNDLE = 'io.rancherdesktop';

export interface Paths {
  /** Directory which holds configuration. */
  config: string;
  /** Directory for Electron data. */
  electron: string;
  /** Directory which holds logs. */
  logs: string;
  /** Directory which holds caches that may be removed. */
  cache: string;
  /** Directory holding the WSL distribution (Windows-specific). */
  wslDistro: string;
  /** Directory holding Lima state (macOS-specific). */
  lima: string;
  /** @deprecated Directory holding hyperkit state (macOS-specific) */
  hyperkit: string;
}

/**
 * DarwinPaths implements paths for Darwin / macOS.
 */
export class DarwinPaths implements Paths {
  config = path.join(os.homedir(), 'Library', 'Preferences', APP_BUNDLE);
  electron = path.join(os.homedir(), 'Library', 'Application Support', APP_BUNDLE, 'electron');
  logs = path.join(os.homedir(), 'Library', 'Logs', APP_BUNDLE);
  cache = path.join(os.homedir(), 'Library', 'Caches', APP_BUNDLE);
  lima = path.join(os.homedir(), 'Library', 'Application Support', APP_BUNDLE, 'lima');
  hyperkit = path.join(os.homedir(), 'Library', 'State', APP_NAME, 'driver');
  get wslDistro(): string {
    throw new Error('wslDistro not available for darwin');
  }
}

/**
 * Win32Paths implements paths for Windows.
 */
export class Win32Paths implements Paths {
  protected appData = process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming');
  protected localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
  get config() {
    return path.join(this.appData, APP_NAME);
  }

  get electron() {
    return path.join(this.appData, APP_NAME, 'electron');
  }

  get logs() {
    return path.join(this.localAppData, APP_NAME, 'logs');
  }

  get cache() {
    return path.join(this.localAppData, APP_NAME, 'cache');
  }

  get wslDistro() {
    return path.join(this.localAppData, APP_NAME, 'distro');
  }

  get lima(): string {
    throw new Error('lima not available for Windows');
  }

  get hyperkit(): string {
    throw new Error('hyperkit not available for Windows');
  }
}

function getPaths(): Paths {
  switch (os.platform()) {
  case 'darwin':
    return new DarwinPaths();
  case 'win32':
    return new Win32Paths();
  default:
    throw new Error(`Paths not implemented for ${ os.platform() }`);
  }
}

export default getPaths();
