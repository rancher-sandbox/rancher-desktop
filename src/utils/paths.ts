/**
 * This module describes the various paths we use to store state & data.
 */

import os from 'os';
import path from 'path';

const APP_NAME = 'rancher-desktop';

export interface Paths {
  /** Directory which holds configuration. */
  config: string;
  /** Directory which holds logs. */
  logs: string;
  /** Directory which holds caches that may be removed. */
  cache: string;
  /** Directory holding the WSL distribution (Windows-specific). */
  wslDistro: string;
  /** Directory holding the WSL data distribution (Windows-specific). */
  wslDistroData: string;
  /** Directory holding Lima state (macOS-specific). */
  lima: string;
  /** Directory holding provided binary resources */
  integration: string;
  /** @deprecated Directory holding hyperkit state (macOS-specific) */
  hyperkit: string;
}

/**
 * DarwinPaths implements paths for Darwin / macOS.
 */
export class DarwinPaths implements Paths {
  config = path.join(os.homedir(), 'Library', 'Preferences', APP_NAME);
  logs = path.join(os.homedir(), 'Library', 'Logs', APP_NAME);
  cache = path.join(os.homedir(), 'Library', 'Caches', APP_NAME);
  lima = path.join(os.homedir(), 'Library', 'Application Support', APP_NAME, 'lima');
  hyperkit = path.join(os.homedir(), 'Library', 'State', APP_NAME, 'driver');
  integration = '/usr/local/bin';
  get wslDistro(): string {
    throw new Error('wslDistro not available for darwin');
  }

  get wslDistroData(): string {
    throw new Error('wslDistro not available for darwin');
  }
}

/**
 * Win32Paths implements paths for Windows.
 */
export class Win32Paths implements Paths {
  protected readonly appData = process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming');
  protected readonly localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
  get config() {
    return path.join(this.appData, APP_NAME);
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

  get wslDistroData() {
    return path.join(this.localAppData, APP_NAME, 'distro-data');
  }

  get lima(): string {
    throw new Error('lima not available for Windows');
  }

  get hyperkit(): string {
    throw new Error('hyperkit not available for Windows');
  }

  get integration(): string {
    return '/usr/local/bin';
    // The current code paths on Windows fail if no location is returned to watch.
    // Before we can throw an exception, the code paths that use the returned string
    // need to be refactored to handle an error. The current location being returned
    // is the location that has been in use.
    // throw new Error('integration path not available for Windows');
  }
}

/**
 * LinuxPaths implements paths for Linux.
 */
export class LinuxPaths implements Paths {
  protected readonly dataHome = process.env['XDG_DATA_HOME'] || path.join(os.homedir(), '.local', 'share');
  protected readonly configHome = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
  protected readonly cacheHome = process.env['XDG_CACHE_HOME'] || path.join(os.homedir(), '.cache');
  get config() {
    return path.join(this.configHome, APP_NAME);
  }

  get logs() {
    return path.join(this.dataHome, APP_NAME, 'logs');
  }

  get cache() {
    return path.join(this.cacheHome, APP_NAME);
  }

  get wslDistro(): string {
    throw new Error('wslDistro not available for Linux');
  }

  get wslDistroData(): string {
    throw new Error('wslDistro not available for Linux');
  }

  get lima(): string {
    return path.join(this.dataHome, APP_NAME, 'lima');
  }

  get integration(): string {
    return path.join(os.homedir(), '.local', 'bin');
  }

  get hyperkit(): string {
    throw new Error('hyperkit not available for Linux');
  }
}

const UnsupportedPaths: Paths = new Proxy({} as Paths, {
  get(target, prop) {
    throw new Error(`Paths ${ String(prop) } not available for ${ os.platform() }`);
  }
});

function getPaths(): Paths {
  switch (os.platform()) {
  case 'darwin':
    return new DarwinPaths();
  case 'win32':
    return new Win32Paths();
  case 'linux':
    return new LinuxPaths();
  default:
    return UnsupportedPaths;
  }
}

export default getPaths();
