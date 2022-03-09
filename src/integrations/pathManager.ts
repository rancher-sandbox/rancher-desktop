import os from 'os';
import path from 'path';
import paths from '@/utils/paths';
import { manageLinesInFile } from '@/integrations/rdFileManager';

let pathManager: ManualPathManager;

// PathManager is the interface that anything that manages the
// PATH variable must implement.
interface PathManager {
  // Makes real any changes to the system. Should be idempotent.
  enforce(): Promise<void>
  // Removes any changes that the PathManager may have made.
  // Should be idempotent.
  remove(): Promise<void>
}

// ManualPathManager is for when the user has chosen to manage
// their PATH themselves.
class ManualPathManager implements PathManager {
  async enforce(): Promise<void> {}
  async remove(): Promise<void> {}
}

// RcFilePathManager is for when the user wants Rancher Desktop to
// make changes to their PATH by putting the necessary lines in their
// shell .rc files.
class RcFilePathManager implements PathManager {

  constructor() {
    const platform = os.platform();
    if (platform !== 'linux' && platform !== 'darwin') {
      throw new Error(`Platform "${platform}" is not supported by RcFilePathManager`);
    }
  }

  async enforce(): Promise<void> {
    await this.managePosix(true);
    await this.manageCsh(true);
    await this.manageFish(true);
  }

  async remove(): Promise<void> {
    await this.managePosix(false);
    await this.manageCsh(false);
    await this.manageFish(false);
  }

  protected async managePosix(desiredPresent: boolean): Promise<void> {
    const pathLine = `PATH=\${PATH}:${ paths.integration }`;

    await Promise.all(['.bashrc', '.zshrc'].map((rcName) => {
      const rcPath = path.join(os.homedir(), rcName);

      return manageLinesInFile(rcPath, [pathLine], desiredPresent);
    }));
  }

  protected async manageCsh(desiredPresent: boolean): Promise<void> {
    const pathLine = `set path=($path ${ paths.integration })`;

    await Promise.all(['.cshrc', '.tcshrc'].map((rcName) => {
      const rcPath = path.join(os.homedir(), rcName);

      return manageLinesInFile(rcPath, [pathLine], desiredPresent);
    }));
  }

  protected async manageFish(desiredPresent: boolean): Promise<void> {
    const pathLine = `set -x PATH "${paths.integration}" "$PATH"`;
    let configHome = '';
    switch (os.platform()) {
      case 'darwin':
        configHome = path.join(os.homedir(), '.config');
      case 'linux':
        configHome = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
    }
    const fishConfigPath = path.join(configHome, 'fish', 'config.fish');
    await manageLinesInFile(fishConfigPath, [pathLine], desiredPresent);
  }
}

export enum PathManagementStrategy {
  Manual = 'manual',
  RcFiles = 'rcfiles',
}

// Changes the path manager to match a PathManagementStrategy and realizes the
// changes that the new path manager represents.
export function setPathManagementStrategy(strategy: PathManagementStrategy): void {
  pathManager.remove();
  switch (strategy) {
  case PathManagementStrategy.Manual:
    pathManager = new ManualPathManager();
  case PathManagementStrategy.RcFiles:
    pathManager = new RcFilePathManager();
  }
  pathManager.enforce();
}
