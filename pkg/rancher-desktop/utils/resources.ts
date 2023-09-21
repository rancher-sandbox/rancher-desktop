import os from 'os';
import path from 'path';

import paths from '@pkg/utils/paths';
import memoize from 'lodash/memoize';

/**
 * Gets the absolute path to an executable. Adds ".exe" to the end
 * if running on Windows.
 * @param name The name of the binary, without file extension.
 */
function _executable(name: string) {
  const osSpecificName = os.platform().startsWith('win') ? `${ name }.exe` : name;

  return path.join(paths.resources, os.platform(), 'bin', osSpecificName);
}
export const executable = memoize(_executable);

export default { executable };
