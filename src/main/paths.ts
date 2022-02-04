/**
 * This handles migrating from the old path layout to the new one.
 * See https://github.com/rancher-sandbox/rancher-desktop/issues/298
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Electron from 'electron';

import Logging from '@/utils/logging';
import paths, { Paths } from '@/utils/paths';
import { isNodeError } from '@/typings/unix.interface';

const console = Logging.background;
const APP_NAME = 'rancher-desktop';

/**
 * DarwinObsoletePaths describes the paths we're migrating from.
 */
class DarwinObsoletePaths implements Paths {
  config = path.join(os.homedir(), 'Library', 'Preferences', APP_NAME);
  logs = path.join(os.homedir(), 'Library', 'State', APP_NAME, 'logs');
  cache = path.join(os.homedir(), 'Library', 'Caches', APP_NAME);
  lima = path.join(os.homedir(), 'Library', 'State', APP_NAME, 'lima');
  hyperkit = path.join(os.homedir(), 'Library', 'State', APP_NAME, 'driver');
  integration = '/usr/local/bin';
  get wslDistro(): string {
    throw new Error('wslDistro not available for darwin');
  }

  get wslDistroData(): string {
    throw new Error('wslDistro not available for darwin');
  }

  get appHome(): string {
    throw new Error('appHome not available for darwin');
  }
}

/**
 * Remove the given directory if it is empty, and also any parent directories
 * that become empty.  Any `.DS_Store` files are ignored (and directories that
 * only contain `.DS_Store` are also removed).
 */
function removeEmptyParents(directory: string) {
  const expectedErrors = ['ENOTEMPTY', 'EACCES', 'EBUSY', 'ENOENT', 'EPERM'];
  const isDarwin = os.platform() === 'darwin';
  let parent = directory;
  let previous = '';

  while (parent !== previous) {
    previous = parent;
    if (isDarwin) {
      const items = fs.readdirSync(parent);

      if (items.length === 1 && items[0] === '.DS_Store') {
        // on macOS, we _may_ have directories with just .DS_Store
        const DSStorePath = path.join(parent, '.DS_Store');

        try {
          fs.rmSync(DSStorePath);
        } catch (ex) {
          console.error(`Error removing ${ DSStorePath }: ${ ex }`);
          break;
        }
      }
    }
    try {
      fs.rmdirSync(parent);
    } catch (ex) {
      if (isNodeError(ex) && expectedErrors.includes(ex.code)) {
        break;
      }
      throw ex;
    }
    parent = path.dirname(parent);
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
    if ((ex as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw ex;
  }
  removeEmptyParents(path.dirname(target));
}

type renameResult = 'succeeded' | 'failed' | 'skipped';

/**
 * Try to rename an old directory name to a new one.  If the move failed,
 * delete the old directory.
 */
function tryRename(oldPath: string, newPath: string, info: string, deleteOnFailure = true): renameResult {
  if (oldPath === newPath) {
    return 'skipped';
  }
  try {
    fs.accessSync(newPath);
    // We have the new file, quietly try to remove the old file.
    fs.rmSync(oldPath, { force: true });

    return 'skipped';
  } catch {
    // Ignore non-ENOENT errors on newPath and continue to try to do the rename
  }

  try {
    fs.accessSync(oldPath);
  } catch (err:any ) {
    if (err.code === 'ENOENT') {
      console.log(`Can't migrate ${ oldPath } to ${ newPath }: neither exists`);
    } else {
      console.log(`Ignorable error looking for obsolete files: can't access ${ oldPath } :`, err);
    }

    return 'failed';
  }
  if (newPath.startsWith(oldPath)) {
    // If the old path looks like a prefix of the new path, rename it out of the way first.
    fs.renameSync(oldPath, `${ oldPath }.tmp`);
    oldPath = `${ oldPath }.tmp`;
  }
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  try {
    fs.renameSync(oldPath, newPath);
    console.log(`Migrated ${ info } data from ${ oldPath } to ${ newPath }`);
    try {
      removeEmptyParents(path.dirname(oldPath));
    } catch (ex) {
      console.log(`Failed to remove empty parent directories, ignoring: ${ ex }`);
    }

    return 'succeeded';
  } catch (ex) {
    if (isNodeError(ex) && ['ENOENT', 'EEXIST'].includes(ex.code)) {
      console.error(`Expected error moving ${ info }: ${ ex }`);

      return 'failed';
    }
    console.error(`Error moving ${ info }: fatal: ${ ex }`);
    if (deleteOnFailure) {
      recursiveRemoveSync(oldPath);
    }
  }

  return 'failed';
}

/**
 * Migrate old data.  This must run synchronously to ensure Electron doesn't
 * use any paths before we're done.
 */
function migratePaths() {
  if (os.platform() !== 'darwin') {
    console.error(`No paths migration available for platform ${ os.platform() }`);

    return;
  }
  const obsoletePaths = new DarwinObsoletePaths();

  // Move the settings over
  // Attempting to move the whole directory will cause EPERM on Windows; so we
  // can only move the file itself.
  tryRename(
    path.join(obsoletePaths.config, 'settings.json'),
    path.join(paths.config, 'settings.json'),
    'config');

  // Delete old logs.
  recursiveRemoveSync(obsoletePaths.logs);

  // Move cache.
  tryRename(obsoletePaths.cache, paths.cache, 'cache');

  // Delete any hyperkit VMs.
  // eslint-disable-next-line deprecation/deprecation -- needed for migration
  recursiveRemoveSync(obsoletePaths.hyperkit);

  // Move Lima state
  if (tryRename(obsoletePaths.lima, paths.lima, 'Lima state') === 'succeeded') {
    // We also changed the VM name.
    const oldVM = path.join(paths.lima, 'rancher-desktop');
    const newVM = path.join(paths.lima, '0');

    tryRename(oldVM, newVM, 'Lima VM');
  }
}

export default function setupPaths() {
  try {
    migratePaths();
  } catch (ex) {
    console.error(ex);
  }
  Electron.app.setPath('cache', paths.cache);
  Electron.app.setAppLogsPath(paths.logs);
}
