import fs from 'fs';
import path from 'path';
import os from 'os';
import { manageSymlink } from '@/integrations/unixIntegrationManager';
import paths from '@/utils/paths';
import * as childProcess from '@/utils/childProcess';

const LEGACY_INTEGRATION_NAMES = [
  'docker',
  'docker-buildx',
  'docker-compose',
  'helm',
  'kubectl',
  'kuberlr',
  'nerdctl',
  'steve',
  'trivy',
  'rdctl',
];

type EaccesError = {
  errno: number;
  code: string;
  syscall: string;
  path: string;
}

export class PermissionError {
  errors: EaccesError[] = [];

  constructor(errors: EaccesError[]) {
    this.errors = errors;
  }
}

// Removes any symlinks that may remain from the previous strategy
// of managing integrations. Ensures a clean transition to the new
// strategy. Idempotent.
export async function removeLegacySymlinks(legacyIntegrationDir: string): Promise<void> {
  const settledPromises = await Promise.allSettled(LEGACY_INTEGRATION_NAMES.map((name) => {
    const linkPath = path.join(legacyIntegrationDir, name);

    return manageSymlink('', linkPath, false);
  }));

  const permissionErrors = [];

  for (const settledPromise of settledPromises) {
    if (settledPromise.status === 'rejected') {
      if (settledPromise.reason.code === 'EACCES') {
        permissionErrors.push(settledPromise.reason);
      } else {
        throw settledPromise.reason;
      }
    }
  }

  if (permissionErrors.length > 0) {
    throw new PermissionError(permissionErrors);
  }
}

// Moves lima content from the old location to the current one. Idempotent.
export async function migrateLimaFilesToNewLocation() {
  try {
    await fs.promises.access(paths.oldLima, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // there is no directory to move, done already
      return;
    } else {
      throw new Error(`Can't test for ${ paths.oldLima }: err`);
    }
  }

  try {
    await fs.promises.rm(paths.lima, { recursive: true });
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // there is no directory to delete, all good
    } else {
      throw new Error(`Can't delete ${ paths.lima }: err`);
    }
  }

  try {
    await fs.promises.rename(paths.oldLima, paths.lima);
  } catch (err: any) {
    throw new Error(`Can't migrate lima configuration to ${ paths.lima }: err`);
  }

  // Update Time Machine exclusions
  if (os.platform().startsWith('darwin')) {
    try {
      await childProcess.spawnFile('tmutil', ['addexclusion', paths.lima]);
    } catch (ex) {
      console.log('Failed to add exclusion to TimeMachine', ex);
    }
  }
}
