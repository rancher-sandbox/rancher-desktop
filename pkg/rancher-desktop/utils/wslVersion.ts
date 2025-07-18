/**
 * This exports a single function to ask wsl-helper about the current WSL
 * version.
 */

import { spawnFile } from '@pkg/utils/childProcess';
import logging from '@pkg/utils/logging';
import { executable } from '@pkg/utils/resources';

export interface WSLVersionInfo {
  installed: boolean;
  inbox:     boolean;

  has_kernel:      boolean;
  outdated_kernel: boolean;
  version: {
    major:    number;
    minor:    number;
    build:    number;
    revision: number;
  };
  kernel_version: {
    major:    number;
    minor:    number;
    build:    number;
    revision: number;
  }
}

const console = logging['wsl-version'];

/**
 * Get information about the currently installed WSL version.
 */
export default async function getWSLVersion(): Promise<WSLVersionInfo> {
  const { stdout } = await spawnFile(executable('wsl-helper'),
    ['wsl', 'info'], { stdio: ['ignore', 'pipe', console] });

  return JSON.parse(stdout);
}
