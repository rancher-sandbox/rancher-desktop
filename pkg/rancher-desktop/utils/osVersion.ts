import semver from 'semver';

import { spawnFile } from '@pkg/utils/childProcess';
import { Log } from '@pkg/utils/logging';

export async function getMacOsVersion(console: Log): Promise<semver.SemVer | null> {
  const { stdout } = await spawnFile('/usr/bin/sw_vers', ['-productVersion'], { stdio: ['ignore', 'pipe', console] });
  const currentVersion = semver.coerce(stdout.trim());

  return currentVersion;
}
