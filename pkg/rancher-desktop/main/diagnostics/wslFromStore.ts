import os from 'os';
import path from 'path';

import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';

const console = Logging.diagnostics;

/**
 * Check if WSL was installed from Microsoft Store.
 */
class CheckWSLFromStore implements DiagnosticsChecker {
  readonly id = 'WSL_FROM_STORE';

  category = DiagnosticsCategory.Testing;
  applicable(): Promise<boolean> {
    return Promise.resolve(process.platform === 'win32');
  }

  get system32() {
    return path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32');
  }

  get powerShellExecutable(): string {
    return path.join(this.system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  }

  /**
   * Check if the current version of Windows can use WSL from the store.
   */
  async canUseStoreWSL(): Promise<boolean> {
    const [major, minor, build] = os.version().split('.').map(v => parseInt(v, 10));

    if (major < 10) {
      // Windows 8.x or lower?
      return false;
    }
    if (major > 10 || minor > 0) {
      // Windows 11 is 10.0.22000; so this is a future version.
      return true;
    }

    const { stdout } = await spawnFile(path.join(this.system32, 'reg.exe'),
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'UBR', '/t', 'REG_DWORD'],
      { stdio: ['ignore', 'pipe', console] });
    const lines = stdout.split(/\n/).map(line => line.trim().split(/\s+/));
    const patchString = lines.find(([key]) => key === 'UBR')?.pop() ?? '0x0';
    const patch = parseInt(patchString, 16);

    if (build > 22000) {
      // After Windows 11
      return true;
    } else if (build === 22000) {
      // Windows 11
      return patch >= 1281;
    } else {
      // Windows 10
      return patch >= 2311;
    }
  }

  /**
   * Check if the WSL store package is installed; returns a description of the
   * error if it is not. If it is installed, returns an empty string.
   */
  async checkWSLFromStore(): Promise<string> {
    try {
      const pkg = 'MicrosoftCorporationII.WindowsSubsystemForLinux';
      const command = `Get-AppxPackage -Name ${ pkg } | ConvertTo-Json`;
      const { stdout } = await spawnFile(this.powerShellExecutable, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-Command', command,
      ], { stdio: ['ignore', 'pipe', console] });

      if (!stdout) {
        return 'WSL does not appear to be installed from the Microsoft Store.';
      }
      const result = JSON.parse(stdout || '{"missing": true}');

      if (result.Status === 0) {
        return '';
      }
      if (result.missing) {
        return 'The Windows in-box WSL is installed instead of the Microsoft Store version.';
      }
      console.debug(`${ this.id }: ${ JSON.stringify(result, undefined, 2) }`);

      return 'WSL was installed from the Microsoft Store, but it is not functioning correctly.';
    } catch (ex) {
      console.error(`Failed to check for WSL in store: ${ ex }`);

      return 'There was an error checking if WSL was installed from the Microsoft Store.';
    }
  }

  /**
   * Run WSL and return stdout.
   * @param args Command line for WSL
   * @param failureMatch If given, ignore non-zero exit code if the output
   *   contains this string.
   */
  async runWSL(args: string[], failureMatch?: string): Promise<string> {
    try {
      const result = await spawnFile(
        path.join(this.system32, 'wsl.exe'), args,
        { stdio: ['ignore', 'pipe', console], encoding: 'utf16le' });

      return result.stdout;
    } catch (ex: any) {
      if (failureMatch && 'stdout' in ex) {
        const stdout: string = ex.stdout;

        if (stdout.includes(failureMatch)) {
          return stdout;
        }
      }
      throw ex;
    }
  }

  _cachedWSLHelpText: string | undefined;
  async getWSLHelpText(): Promise<string> {
    if (this._cachedWSLHelpText) {
      return this._cachedWSLHelpText;
    }
    // `wsl.exe --help` always exits with -1; that's okay as long as the output
    // contains `wsl.exe` somewhere.
    this._cachedWSLHelpText = await this.runWSL(['--help'], 'wsl.exe');

    return this._cachedWSLHelpText;
  }

  async isKernelInstalled(): Promise<boolean> {
    if ((await this.getWSLHelpText()).includes('--version')) {
      const versions = await this.runWSL(['--version']);
      const kernel = versions.split(/\r?\n/).map(s => s.trim()).find(v => /kernel/i.test(v));

      console.debug(`Running WSL with ${ kernel || '(no kernel found)' }`);

      return !!kernel;
    } else {
      try {
        const status = await this.runWSL(['--status']);
        const match = /:\s*((?:\d+\.){2,}\d+)/.exec(status);

        if (match) {
          console.debug(`Running WSL with kernel ${ match.groups?.[1] }`);

          return true;
        }
        console.debug('`wsl --status` does not contain version string.');
      } catch (ex) {
        console.debug(ex);
      }

      return false;
    }
  }

  async check() {
    const storeURL = 'ms-windows-store://pdp/?ProductId=9P9TQF7MRM4R&mode=mini';

    if (!(await this.getWSLHelpText()).includes('--exec')) {
      // WSL is not installed
      const description = 'Windows Subsystem for Linux is not installed.';
      const fixes: { description: string, url?: string }[] = [];

      if (await this.canUseStoreWSL()) {
        fixes.push({
          description: `Install Windows Subsystem for Linux from the [Microsoft Store](${ storeURL }).`,
          url:         storeURL,
        });
      } else {
        fixes.push({
          description: `Install Windows Subsystem for Linux manually.`,
          url:         'https://aka.ms/wslinstall',
        });
      }

      return {
        passed: false, description, fixes,
      };
    }

    if (!await this.isKernelInstalled()) {
      // The kernel is not installed; this covers virtualization not available.
      return {
        passed:      false,
        description: `The WSL kernel does not appear to be installed.`,
        fixes:       [{ description: 'Install the WSL kernel with `wsl.exe --update`' }],
      };
    }

    if (await this.canUseStoreWSL()) {
      const description = await this.checkWSLFromStore();

      if (description) {
        // WSL is installed, but we're using the in-box version.
        return {
          passed: false,
          description,
          fixes:  [{
            description: `Install Windows Subsystem for Linux from the [Microsoft Store](${ storeURL }).`,
            url:         storeURL,
          }],
        };
      }
    }

    return {
      passed: true, description: 'WSL is installed.', fixes: [],
    };
  }
}

export default new CheckWSLFromStore();
