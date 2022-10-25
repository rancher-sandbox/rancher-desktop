import fs from 'fs';
import os from 'os';
import path from 'path';

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
};

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
  const searchString = path.join('resources', os.platform(), 'bin');
  const settledPromises = await Promise.allSettled(LEGACY_INTEGRATION_NAMES.map(async(name) => {
    const linkPath = path.join(legacyIntegrationDir, name);
    let linkedTo: string;

    try {
      linkedTo = await fs.promises.readlink(linkPath);
    } catch (error: any) {
      if (['EINVAL', 'ENOENT'].includes(error.code)) {
        return;
      }
      throw error;
    }

    if (path.dirname(linkedTo).endsWith(searchString)) {
      await fs.promises.unlink(linkPath);
    }
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
