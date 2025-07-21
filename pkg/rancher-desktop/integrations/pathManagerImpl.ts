import fs from 'fs';
import os from 'os';
import path from 'path';

import { Mutex } from 'async-mutex';

import manageLinesInFile from '@pkg/integrations/manageLinesInFile';
import { ManualPathManager, PathManagementStrategy, PathManager } from '@pkg/integrations/pathManager';
import mainEvents from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const console = Logging['path-management'];

/**
 * RcFilePathManager is for when the user wants Rancher Desktop to
 * make changes to their PATH by putting lines that change it in their
 * shell .rc files.
 */
export class RcFilePathManager implements PathManager {
  readonly strategy = PathManagementStrategy.RcFiles;
  private readonly posixMutex :Mutex;
  private readonly cshMutex :  Mutex;
  private readonly fishMutex : Mutex;

  constructor() {
    const platform = os.platform();

    if (platform !== 'linux' && platform !== 'darwin') {
      throw new Error(`Platform "${ platform }" is not supported by RcFilePathManager`);
    }
    this.posixMutex = new Mutex();
    this.cshMutex = new Mutex();
    this.fishMutex = new Mutex();
  }

  async enforce(): Promise<void> {
    try {
      await this.managePosix(true);
      await this.manageCsh(true);
      await this.manageFish(true);
    } catch (error) {
      console.error(error);
    }
  }

  async remove(): Promise<void> {
    try {
      await this.managePosix(false);
      await this.manageCsh(false);
      await this.manageFish(false);
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Call manageFilesInLine, wrapped in calls to trigger diagnostics updates.
   */
  protected async manageLinesInFile(fileName: string, filePath: string, lines: string[], desiredPresent: boolean) {
    try {
      await manageLinesInFile(filePath, lines, desiredPresent);
      mainEvents.emit('diagnostics-event', {
        id: 'path-management', fileName, error: undefined,
      });
    } catch (error: any) {
      mainEvents.emit('diagnostics-event', {
        id: 'path-management', fileName, error,
      });
      throw error;
    }
  }

  /**
   * bash requires some special handling. This is because the files it reads
   * on startup differ depending on whether it is a login shell or a
   * non-login shell. We must cover both cases.
   */
  protected async managePosix(desiredPresent: boolean): Promise<void> {
    await this.posixMutex.runExclusive(async() => {
      const pathLine = `export PATH="${ paths.integration }:$PATH"`;
      // Note: order is important here.  Only the first one has the PATH added;
      // all others have it removed.
      const bashLoginShellFiles = [
        '.bash_profile',
        '.bash_login',
        '.profile',
      ];

      // Handle files that pertain to bash login shells
      if (desiredPresent) {
        let linesAdded = false;

        // Write the first file that exists, if any
        for (const fileName of bashLoginShellFiles) {
          const filePath = path.join(os.homedir(), fileName);

          try {
            await fs.promises.stat(filePath);
          } catch (error: any) {
            if (error.code === 'ENOENT') {
              // If the file does not exist, it is not an error.
              mainEvents.emit('diagnostics-event', {
                id: 'path-management', fileName, error: undefined,
              });
              continue;
            }
            mainEvents.emit('diagnostics-event', {
              id: 'path-management', fileName, error,
            });
            throw error;
          }
          await this.manageLinesInFile(fileName, filePath, [pathLine], !linesAdded);
          linesAdded = true;
        }

        // If none of the files exist, write .bash_profile
        if (!linesAdded) {
          const fileName = bashLoginShellFiles[0];
          const filePath = path.join(os.homedir(), fileName);

          await this.manageLinesInFile(fileName, filePath, [pathLine], true);
        }
      } else {
        // Ensure lines are not present in any of the files
        await Promise.all(bashLoginShellFiles.map(async(fileName) => {
          const filePath = path.join(os.homedir(), fileName);

          await this.manageLinesInFile(fileName, filePath, [], false);
        }));
      }

      // Handle other shells' rc files and .bashrc
      await Promise.all(['.bashrc', '.zshrc'].map((fileName) => {
        const rcPath = path.join(os.homedir(), fileName);

        return this.manageLinesInFile(fileName, rcPath, [pathLine], desiredPresent);
      }));

      mainEvents.invoke('diagnostics-trigger', 'RD_BIN_IN_BASH_PATH');
      mainEvents.invoke('diagnostics-trigger', 'RD_BIN_IN_ZSH_PATH');
    });
  }

  protected async manageCsh(desiredPresent: boolean): Promise<void> {
    await this.cshMutex.runExclusive(async() => {
      const pathLine = `setenv PATH "${ paths.integration }"\\:"$PATH"`;

      await Promise.all(['.cshrc', '.tcshrc'].map((fileName) => {
        const rcPath = path.join(os.homedir(), fileName);

        return this.manageLinesInFile(fileName, rcPath, [pathLine], desiredPresent);
      }));
    });
  }

  protected async manageFish(desiredPresent: boolean): Promise<void> {
    await this.fishMutex.runExclusive(async() => {
      const pathLine = `set --export --prepend PATH "${ paths.integration }"`;
      const configHome = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
      const fileName = 'config.fish';
      const fishConfigDir = path.join(configHome, 'fish');
      const fishConfigPath = path.join(fishConfigDir, fileName);

      await fs.promises.mkdir(fishConfigDir, { recursive: true, mode: 0o700 });
      await this.manageLinesInFile(fileName, fishConfigPath, [pathLine], desiredPresent);
    });
  }
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
