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
];

// Removes any symlinks that may remain from the previous strategy
// of managing integrations. Ensures a clean transition to the new
// strategy. Idempotent.
export default async function removeLegacySymlinks(legacyIntegrationDir: string): Promise<void> {
  await Promise.all(LEGACY_INTEGRATION_NAMES.map(async(name) => {
    const linkPath = path.join(legacyIntegrationDir, name);

    await manageSymlink('', linkPath, false);
  }));
}
