import path from 'path';
import { manageSymlink } from '@/integrations/integrationManager';

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

export default async function removeLegacySymlinks(legacyIntegrationDir: string): Promise<void> {
  await Promise.all(LEGACY_INTEGRATION_NAMES.map(async(name) => {
    const linkPath = path.join(legacyIntegrationDir, name);
    await manageSymlink('', linkPath, false);
  }));
}
