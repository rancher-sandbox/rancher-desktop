import Electron from 'electron';
import semver from 'semver';

import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import mainEvents from '@pkg/main/mainEvents';
import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';

const console = Logging.diagnostics;

let virtualMachineMemory = Number.POSITIVE_INFINITY;

mainEvents.on('settings-update', (cfg) => {
  virtualMachineMemory = cfg.virtualMachine.memoryInGB;
});

/**
 * CheckLimaDarwin version checks for an issue where lima/qemu isn't able to
 * allocate more than 3GiB of memory when running on macOS 12.3 (darwin 21.4.0).
 *
 * See also: https://github.com/lima-vm/lima/issues/795
 */
const CheckLimaDarwin: DiagnosticsChecker = {
  id:       'LIMA_DARWIN_VERSION',
  category: DiagnosticsCategory.ContainerEngine,
  applicable() {
    const isDarwin = process.platform === 'darwin';
    const isArm = Electron.app.runningUnderARM64Translation || process.arch.startsWith('arm');

    return Promise.resolve(isDarwin && isArm);
  },
  async check() {
    const result = {
      description: '',
      passed:      false,
      fixes:       [] as { description: string }[],
    };
    const { stdout } = await spawnFile('/usr/bin/sw_vers', ['-productVersion'], { stdio: ['ignore', 'pipe', console] });
    const currentVersion = semver.coerce(stdout.trim());

    result.passed = !!currentVersion && semver.gte(currentVersion, '12.4.0', { loose: true });
    result.description = `This machine is running macOS ${ currentVersion }.`;
    if (!result.passed) {
      if (currentVersion) {
        result.description = `This machine is running macOS ${ currentVersion }, which is too old; virtual machine memory is limited to 3GiB.`;
        result.fixes.push({ description: 'Update your macOS installation to at least macOS 12.4 (Monterey).' });
      } else {
        result.description = `There was an error determining your macOS version.  Virtual memory may be limited to 3GiB.`;
      }
    }
    if (Math.ceil(virtualMachineMemory) <= 3) {
      // If we're not using more than 3GB of memory, consider this a pass.
      result.passed = true;
    }
    console.debug(`${ this.id }: version=${ currentVersion } result=${ JSON.stringify(result) }`);

    return result;
  },
};

export default CheckLimaDarwin;
