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
];

export default async function removeLegacySymlinks(legacyIntegrationDir: string): Promise<void> {
  for (let name of LEGACY_INTEGRATION_NAMES) {
    const linkPath = path.join(legacyIntegrationDir, name);
    if (await isLegacyIntegration(linkPath)) {
      try {
        console.debug(`Removing legacy symlink ${ linkPath }`);
        await fs.promises.unlink(linkPath);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          console.error(`Error unlinking symlink ${ linkPath }: ${ error.message }`);
        }
      }
    }
  }
}

// Tests whether a path is a legacy integration symlink that is safe to delete.
// @param pathToCheck -- absolute path to the file that we want to check
async function isLegacyIntegration(pathToCheck: string): Promise<boolean> {
  let linkedTo: string;

  try {
    linkedTo = await fs.promises.readlink(pathToCheck);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.warn(`Error getting info about node ${ pathToCheck }: ${ error.message }`);
    }

    return false;
  }

  // We need to determine whether the symlink points to something that was
  // in a Rancher Desktop installation. Due to the range of possibilities
  // here, I think the best we can do is to match the symlink on the string
  // "resources/<platform>/bin", since the location of the symlink can vary
  // across packaging formats and operating systems. This should be good enough
  // to keep it from matching symlinks that do not pertain to RD.
  const platform = os.platform();
  const searchString = path.join('resources', platform, 'bin');
  return linkedTo.includes(searchString);
}
