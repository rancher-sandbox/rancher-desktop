import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import getWSLVersion, { compareVersion, makeVersion, versionString } from '@pkg/utils/wslVersion';

/**
 * Check information about WSL.
 */
class CheckWSLFromStore implements DiagnosticsChecker {
  readonly id = 'WSL_INFO';

  category = DiagnosticsCategory.Testing;
  applicable(): Promise<boolean> {
    return Promise.resolve(process.platform === 'win32');
  }

  async check() {
    // Microsoft Store URL for WSL; product ID is from searching the store.
    const storeURL = 'ms-windows-store://pdp/?ProductId=9P9TQF7MRM4R&mode=mini';
    const version = await getWSLVersion();

    if (!version.installed) {
      // Since all versions we care about can install from the store now, just
      // say that.
      return {
        passed:      false,
        description: 'Windows Subsystem for Linux is not installed.',
        fixes:       [{
          description: `Install Windows Subsystem for Linux from the [Microsoft Store](${ storeURL }).`,
          url:         storeURL,
        }],
      };
    }

    if (!version.has_kernel) {
      // The kernel is not installed; this covers virtualization not available.
      return {
        passed:      false,
        description: `The WSL kernel does not appear to be installed.`,
        fixes:       [{ description: 'Install the WSL kernel with `wsl.exe --update`' }],
      };
    }

    if (compareVersion(version.version, makeVersion(2, 5, 7)) < 0) {
      return {
        passed:      false,
        description: `WSL version ${ versionString(version.version) } is too old.`,
        fixes:       [{ description: 'Update WSL with `wsl.exe --update`' }],
      };
    }

    return {
      passed: true, description: `WSL is installed (version ${ versionString(version.version) }).`, fixes: [],
    };
  }
}

export default new CheckWSLFromStore();
