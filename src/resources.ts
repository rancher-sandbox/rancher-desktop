import os from 'os';
import path from 'path';
import { app } from 'electron';
import memoize from 'lodash/memoize';

const adjustNameWithDir: Record<string, string> = {
  docker:            path.join('bin', 'docker'),
  'docker-compose':  path.join('bin', 'docker-compose'),
  helm:              path.join('bin', 'helm'),
  kubectl:           path.join('bin', 'kubectl'),
  nerdctl:           path.join('bin', 'nerdctl'),
};

function fixedSourceName(name: string) {
  return adjustNameWithDir[name] || name;
}

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
  const adjustedName = fixedSourceName(name);

  return get(os.platform(), /^win/i.test(os.platform()) ? `${ adjustedName }.exe` : adjustedName);
}
export const executable = memoize(_executable);

export default { get, executable };
