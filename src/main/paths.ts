/**
 * This handles migrating from the old path layout to the new one.
 * See https://github.com/rancher-sandbox/rancher-desktop/issues/298
 */

import { Console } from 'console';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Electron from 'electron';

import Logging from '@/utils/logging';
import paths, { Paths } from '@/utils/paths';

const console = new Console(Logging.background.stream);
const APP_NAME = 'rancher-desktop';

/**
 * DarwinObsoletePaths describes the paths we're migrating from.
 */
class DarwinObsoletePaths implements Paths {
  config = path.join(os.homedir(), 'Library', 'Preferences', APP_NAME);
  electron = path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  logs = path.join(os.homedir(), 'Library', 'State', APP_NAME, 'logs');
  cache = path.join(os.homedir(), 'Library', 'Caches', APP_NAME);
  lima = path.join(os.homedir(), 'Library', 'State', APP_NAME, 'lima');
  hyperkit = path.join(os.homedir(), 'Library', 'State', APP_NAME, 'driver');
  get wslDistro(): string {
    throw new Error('wslDistro not available for darwin');
  }
}

/**
 * Win32ObsoletePaths describes the paths we're migrating from.
 */
class Win32ObsoletePaths implements Paths {
  protected appData = process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming');
  protected localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
  get config() {
    return path.join(this.appData, 'xdg.config', APP_NAME);
  }

  get electron() {
    return path.join(this.appData, APP_NAME);
  }

  get logs() {
    return path.join(this.localAppData, 'xdg.state', APP_NAME, 'logs');
  }

  get cache() {
    return path.join(this.localAppData, 'xdg.cache', APP_NAME);
  }

  get wslDistro() {
    return path.join(this.localAppData, 'xdg.state', APP_NAME, 'distro');
  }

  get lima(): string {
    throw new Error('lima not available for win32');
  }

  get hyperkit(): string {
    throw new Error('hyperkit not available for win32');
  }
}

/**
 * Recursively remove a directory and its contents.  Also remove any empty
 * parent directories.  If the given path does not exist, no exception is raised.
 * @param target The path to remove.
 */
function recursiveRemoveSync(target: string) {
  try {
    fs.rmSync(target, { recursive: true });
  } catch (ex) {
    if (ex.code === 'ENOENT') {
      return;
    }
    throw ex;
  }

  const expectedErrors = ['ENOTEMPTY', 'EACCES', 'EBUSY', 'ENOENT', 'EPERM'];
  const isDarwin = os.platform() === 'darwin';
  const seen = new Set([target]);
  let parent = path.dirname(target);

  while (!seen.has(parent)) {
    seen.add(parent);
    if (isDarwin) {
      const items = fs.readdirSync(parent);

      if (items.length === 1 && items[0] === '.DS_Store') {
        // on macOS, we _may_ have directories with just .DS_Store
        const DSStorePath = path.join(parent, '.DS_Store');

        try {
          fs.rmSync(DSStorePath);
        } catch (ex) {
          console.error(`Error removing ${ DSStorePath }:`, ex);
          break;
        }
      }
    }
    try {
      fs.rmdirSync(parent);
    } catch (ex) {
      if (expectedErrors.includes(ex.code)) {
        break;
      }
      throw ex;
    }
    parent = path.dirname(parent);
  }
}

/**
 * Try to rename an old directory name to a new one.  If the move failed,
 * delete the old directory.
 *
 * @returns True if the rename occurred and succeeded.
 */
function tryRename(oldPath: string, newPath: string, info: string): boolean {
  if (oldPath === newPath) {
    return false;
  }
  try {
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
    console.log(`Migrated ${ info } data from ${ oldPath } to ${ newPath }`);

    return true;
  } catch (ex) {
    if (!['ENOENT', 'EEXIST'].includes(ex.code)) {
      console.error(`Error moving ${ info }:`, ex);
    } else {
      console.log(`Could not move ${ oldPath } to ${ newPath }:`, ex);
    }
    recursiveRemoveSync(oldPath);

    return false;
  }
}

/**
 * Migrate old data.  This must run synchronously to ensure Electron doesn't
 * use any paths before we're done.
 */
function migratePaths() {
  const platform = os.platform();
  let obsoletePaths: Paths;

  switch (platform) {
  case 'darwin':
    obsoletePaths = new DarwinObsoletePaths();
    break;
  case 'win32':
    obsoletePaths = new Win32ObsoletePaths();
    break;
  default:
    console.error(`No paths migration available for platform ${ os.platform() }`);

    return;
  }

  // Move the settings over
  tryRename(obsoletePaths.config, paths.config, 'config');

  // Delete old logs.
  recursiveRemoveSync(obsoletePaths.logs);

  // Move cache.
  tryRename(obsoletePaths.cache, paths.cache, 'cache');

  // Move electron data.
  tryRename(obsoletePaths.electron, paths.electron, 'Electron data');

  switch (platform) {
  case 'win32':
    // Delete the old distro.
    break;
  case 'darwin':
    // Delete any hyperkit VMs.
    // eslint-disable-next-line deprecation/deprecation -- needed for migration
    recursiveRemoveSync(obsoletePaths.hyperkit);

    // Move Lima state
    if (tryRename(obsoletePaths.lima, paths.lima, 'Lima state')) {
      // We also changed the VM name.
      const oldVM = path.join(paths.lima, 'rancher-desktop');
      const newVM = path.join(paths.lima, 'rd');

      tryRename(oldVM, newVM, 'Lima VM');
    }
    break;
  }
}

export default function setupPaths() {
  try {
    migratePaths();
  } catch (ex) {
    console.error(ex);
  }
  Electron.app.setPath('userData', paths.electron);
  Electron.app.setPath('cache', paths.cache);
  Electron.app.setAppLogsPath(paths.logs);
}
