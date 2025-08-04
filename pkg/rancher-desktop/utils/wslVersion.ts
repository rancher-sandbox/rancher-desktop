/**
 * This exports a single function to ask wsl-helper about the current WSL
 * version.
 */

import { spawnFile } from '@pkg/utils/childProcess';
import logging from '@pkg/utils/logging';
import { executable } from '@pkg/utils/resources';

interface Version {
  major:    number;
  minor:    number;
  build:    number;
  revision: number;
};

/**
 * WSLVersionInfo describes the output from `wsl-helper info`; note that this
 * gets serialized across Electron IPC boundaries.
 */
export interface WSLVersionInfo {
  installed: boolean;
  inbox:     boolean;

  has_kernel:      boolean;
  outdated_kernel: boolean;
  version:         Version;
  kernel_version:  Version;
};

const console = logging['wsl-version'];

export function makeVersion(major: number, minor = 0, build = 0, revision = 0): Version {
  return { major, minor, build, revision };
}

export function versionString(version: Version): string {
  const { major, minor, build, revision } = version;

  return [major, minor, build, revision].join('.');
}

export function compareVersion(left: Version, right: Version): -1 | 0 | 1 {
  for (const key of ['major', 'minor', 'build', 'revision'] as const) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Get information about the currently installed WSL version.
 */
export default async function getWSLVersion(): Promise<WSLVersionInfo> {
  const { stdout } = await spawnFile(executable('wsl-helper'),
    ['wsl', 'info'], { stdio: ['ignore', 'pipe', console] });

  return JSON.parse(stdout);
}
