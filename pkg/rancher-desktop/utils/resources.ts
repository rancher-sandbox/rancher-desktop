import path from 'path';

import memoize from 'lodash/memoize';

import paths from '@pkg/utils/paths';

/**
 * executableMap is a mapping of valid executable names and their path.
 * If the value is `undefined`, then it's assumed to be an executable in the
 * user-accessible `bin` directory.
 * Otherwise, it's an array containing the path to the executable.
 */
const executableMap: Record<string, string[] | undefined> = {
  docker:             undefined,
  kubectl:            undefined,
  nerdctl:            undefined,
  rdctl:              undefined,
  spin:               undefined,
  'setup-spin':       [paths.resources, 'setup-spin'],
  'wsl-helper':       [paths.resources, process.platform, 'internal', platformBinary('wsl-helper')],
  'wsl-helper-linux': [paths.resources, 'linux', 'internal', 'wsl-helper'],
};

function platformBinary(name: string): string {
  return process.platform === 'win32' ? `${ name }.exe` : name;
}

/**
 * Gets the absolute path to an executable. Adds ".exe" to the end
 * if running on Windows.
 * @param name The name of the binary, without file extension.
 */
function _executable(name: keyof typeof executableMap): string {
  const parts = executableMap[name];

  if (parts === undefined) {
    return path.join(paths.resources, process.platform, 'bin', platformBinary(name));
  }

  return path.join(...parts);
}
export const executable = memoize(_executable);

export default { executable };
