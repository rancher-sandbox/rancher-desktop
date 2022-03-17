import os from 'os';
import path from 'path';
import { app } from 'electron';
import memoize from 'lodash/memoize';
import paths from '@/utils/paths';

/**
 * Get the path to a resource file
 * @param pathParts Path relative to the resource directory
 */
export function get(...pathParts: string[]) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', ...pathParts);
  }

  return path.join(app.getAppPath(), 'resources', ...pathParts);
}

/**
 * Get the path to an executable binary
 * @param name The name of the binary, without file extension.
 */
function _executable(name: string) {
  const osSpecificName = /^win/i.test(os.platform()) ? `${ name }.exe` : name
  return path.join(paths.resources, os.platform(), 'bin', osSpecificName);
}
export const executable = memoize(_executable);

export default { get, executable };
