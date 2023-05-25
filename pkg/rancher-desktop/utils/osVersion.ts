import semver from 'semver';

import { spawnFile } from '@pkg/utils/childProcess';
import { Log } from '@pkg/utils/logging';

let macOsVersion: semver.SemVer;

export async function fetchMacOsVersion(console: Log) {
  const { stdout } = await spawnFile('/usr/bin/sw_vers', ['-productVersion'], { stdio: ['ignore', 'pipe', console] });
  const currentVersion = semver.coerce(stdout);

  if (currentVersion) {
    macOsVersion = currentVersion;
  } else {
    throw new Error(`Cannot convert "${ stdout.trimEnd() }" to macOS semver`);
  }
}

export function getMacOsVersion(): semver.SemVer {
  return macOsVersion;
}
