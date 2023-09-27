/**
 * This module describes the various paths we use to store state & data.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import electron from 'electron';

export interface Paths {
  /** appHome: the location of the main appdata directory. */
  appHome: string;
  /** altAppHome is a secondary directory for application data. */
  altAppHome: string;
  /** Directory which holds configuration. */
  config: string;
  /** Directory which holds logs. */
  logs: string;
  /** Directory which holds caches that may be removed. */
  cache: string;
  /** Directory that holds resource files in the RD installation. */
  resources: string;
  /** Directory holding Lima state (Unix-specific). */
  lima: string;
  /** Directory holding provided binary resources */
  integration: string;
  /** Deployment Profile System-wide startup settings path. */
  deploymentProfileSystem: string;
  /** Deployment Profile User startup settings path. */
  deploymentProfileUser: string;
  /** Directory that will hold extension data. */
  readonly extensionRoot: string;
  /** Directory holding the WSL distribution (Windows-specific). */
  wslDistro: string;
  /** Directory holding the WSL data distribution (Windows-specific). */
  wslDistroData: string;
  /** Directory that holds snapshots. */
  snapshots: string;
}

export class UnixPaths implements Paths {
  appHome = '';
  altAppHome = '';
  config = '';
  logs = '';
  cache = '';
  resources = '';
  lima = '';
  integration = '';
  deploymentProfileSystem = '';
  deploymentProfileUser = '';
  extensionRoot = '';
  snapshots = '';

  constructor(pathsData: Record<string, unknown>) {
    Object.assign(this, pathsData);
  }

  get wslDistro(): string {
    throw new Error('wslDistro not available for Unix');
  }

  get wslDistroData(): string {
    throw new Error('wslDistroData not available for Unix');
  }
}

export class WindowsPaths implements Paths {
  appHome = '';
  altAppHome = '';
  config = '';
  logs = '';
  cache = '';
  resources = '';
  extensionRoot = '';
  wslDistro = '';
  wslDistroData = '';

  constructor(pathsData: Record<string, unknown>) {
    Object.assign(this, pathsData);
  }

  get lima(): string {
    throw new Error('lima not available for Windows');
  }

  get integration(): string {
    throw new Error('Internal error: integration path not available for Windows');
  }

  get deploymentProfileSystem(): string {
    throw new Error('Internal error: Windows profiles will be read from Registry');
  }

  get deploymentProfileUser(): string {
    throw new Error('Internal error: Windows profiles will be read from Registry');
  }

  get snapshots(): string {
    throw new Error('Internal error: snapshots not implemented for Windows');
  }
}

// Gets the path to rdctl. Returns null if rdctl cannot be found.
export function getRdctlPath(): string | null {
  let basePath: string;

  // If we are running as a script (i.e. yarn postinstall), electron.app is undefined
  if (electron.app === undefined) {
    basePath = process.cwd();
  } else {
    basePath = electron.app.isPackaged ? process.resourcesPath : electron.app.getAppPath();
  }
  const osSpecificName = os.platform().startsWith('win') ? `rdctl.exe` : 'rdctl';
  const rdctlPath = path.join(basePath, 'resources', os.platform(), 'bin', osSpecificName);

  if (!fs.existsSync(rdctlPath)) {
    return null;
  }

  return rdctlPath;
}

function getPaths(): Paths {
  const rdctlPath = getRdctlPath();
  let pathsData: Partial<Paths>|undefined;
  let errorMsg = '';

  if (rdctlPath) {
    const result = spawnSync(rdctlPath, ['paths'], { encoding: 'utf8' });

    if (result.status === 0 && result.stdout.length > 0) {
      pathsData = JSON.parse(result.stdout);
    } else {
      errorMsg = `rdctl paths failed: ${ JSON.stringify(result) }`;
    }
  }
  if (!pathsData) {
    const processType = process.type;

    if (!errorMsg) {
      errorMsg = `Internal error: attempting to load the paths module from a ${ processType } process.`;
    }
    if (processType === 'renderer') {
      alert(errorMsg);
    }
    throw new Error(errorMsg);
  }

  switch (process.platform) {
  case 'darwin':
    return new UnixPaths(pathsData);
  case 'linux':
    return new UnixPaths(pathsData);
  case 'win32':
    return new WindowsPaths(pathsData);
  default:
    throw new Error(`Platform "${ process.platform }" is not supported.`);
  }
}

export default getPaths();
