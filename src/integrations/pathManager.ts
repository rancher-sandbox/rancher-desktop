import fs from 'fs';
import os from 'os';
import path from 'path';
import paths from '@/utils/paths';
import manageLinesInFile from '@/integrations/manageLinesInFile';

/**
 * PathManager is the interface that anything that manages the
 *  PATH variable must implement.
 */
export interface PathManager {
  /** The PathManagementStrategy that corresponds to the implementation. */
  readonly strategy: PathManagementStrategy
  /** Makes real any changes to the system. Should be idempotent. */
  enforce(): Promise<void>
  /** Removes any changes that the PathManager may have made. Should be idempotent. */
  remove(): Promise<void>
}

/**
 * ManualPathManager is for when the user has chosen to manage
 * their PATH themselves. It does nothing.
 */
export class ManualPathManager implements PathManager {
  readonly strategy = PathManagementStrategy.Manual;
  async enforce(): Promise<void> {}
  async remove(): Promise<void> {}
}

/**
 * RcFilePathManager is for when the user wants Rancher Desktop to
 * make changes to their PATH by putting lines that change it in their
 * shell .rc files.
 */
export class RcFilePathManager implements PathManager {
  readonly strategy = PathManagementStrategy.RcFiles;

  constructor() {
    const platform = os.platform();

    if (platform !== 'linux' && platform !== 'darwin') {
      throw new Error(`Platform "${ platform }" is not supported by RcFilePathManager`);
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
    const pathLine = `export PATH="${ paths.integration }:$PATH"`;

    await Promise.all(['.bashrc', '.zshrc'].map((rcName) => {
      const rcPath = path.join(os.homedir(), rcName);

      return manageLinesInFile(rcPath, [pathLine], desiredPresent);
    }));
  }

  protected async manageCsh(desiredPresent: boolean): Promise<void> {
    const pathLine = `setenv PATH "${ paths.integration }"\\:"$PATH"`;

    await Promise.all(['.cshrc', '.tcshrc'].map((rcName) => {
      const rcPath = path.join(os.homedir(), rcName);

      return manageLinesInFile(rcPath, [pathLine], desiredPresent);
    }));
  }

  protected async manageFish(desiredPresent: boolean): Promise<void> {
    const pathLine = `set --export --prepend PATH "${ paths.integration }"`;
    const configHome = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
    const fishConfigDir = path.join(configHome, 'fish');
    const fishConfigPath = path.join(fishConfigDir, 'config.fish');

    await fs.promises.mkdir(fishConfigDir, { recursive: true, mode: 0o700 });
    await manageLinesInFile(fishConfigPath, [pathLine], desiredPresent);
  }
}

export enum PathManagementStrategy {
  Manual = 'manual',
  RcFiles = 'rcfiles',
}

/**
 * Changes the path manager to match a PathManagementStrategy and realizes the
 * changes that the new path manager represents.
 */
export function getPathManagerFor(strategy: PathManagementStrategy): PathManager {
  switch (strategy) {
  case PathManagementStrategy.Manual:
    return new ManualPathManager();
  case PathManagementStrategy.RcFiles:
    return new RcFilePathManager();
  default:
    throw new Error(`Invalid strategy "${ strategy }"`);
  }
}
