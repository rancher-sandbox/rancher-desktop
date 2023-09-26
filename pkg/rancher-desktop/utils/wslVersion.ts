/**
 * This exports a single function to ask wsl-helper about the current WSL
 * version.
 */

import path from 'path';

import { spawnFile } from '@pkg/utils/childProcess';
import logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

type WSLVersionInfo = {
    installed: boolean;
    inbox: boolean;

    has_kernel: boolean;
    version: {
        major: number;
        minor: number;
        build: number;
        revision: number;
    };
};

const console = logging['wsl-version'];

/**
 * Get information about the currently installed WSL version.
 */
export default async function getWSLVersion(): Promise<WSLVersionInfo> {
  const wslHelper = path.join(paths.resources, 'win32', 'wsl-helper.exe');
  const { stdout } = await spawnFile(wslHelper, ['wsl', 'info'], { stdio: ['ignore', 'pipe', console] });

  return JSON.parse(stdout);
}
