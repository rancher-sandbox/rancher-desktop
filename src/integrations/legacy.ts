import path from 'path';

import { manageSymlink } from '@/integrations/unixIntegrationManager';

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
