import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import { spawnFile } from '@pkg/utils/childProcess';

/**
 * Check for known-incompatible WSL distributions
 */
class CheckWSLDistros implements DiagnosticsChecker {
  readonly id = 'WSL_DISTROS';

  category = DiagnosticsCategory.Testing;
  applicable(): Promise<boolean> {
    return Promise.resolve(process.platform === 'win32');
  }

  async check() {
    const banned = new Set(['wsl-vpnkit']);
    try {
      const { stdout } = await spawnFile(
        'wsl.exe',
        ['--list', '--quiet'],
        { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', env: { WSL_UTF8: '1' } },
      );
      const distros = new Set(stdout.split(/\s+/m));
      const issues = banned.intersection(distros);

      if (issues.size === 0) {
        return {
          passed:      true,
          description: 'No unsupported WSL distributions detected',
          fixes:       [],
        };
      }

      return Array.from(issues).map(distro => ({
        id:          distro,
        passed:      false,
        description: `WSL distribution \`${ distro }\` causes issues with Rancher Desktop`,
        fixes:       [{ description: `Remove WSL distribution \`${ distro }\`` }],
      }));
    } catch (ex: any) {
      return {
        passed:      false,
        description: `There was an error checking for unknown WSL distributions: \`${ ex?.stderr || ex }\``,
        fixes:       [],
      };
    }
  }
}

export default new CheckWSLDistros();
