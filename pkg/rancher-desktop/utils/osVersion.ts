import * as process from 'process';

import semver from 'semver';

import { spawnFile } from '@pkg/utils/childProcess';
import { Log } from '@pkg/utils/logging';

let macOsVersion: semver.SemVer;

export async function fetchMacOsVersion(console?: Log) {
  let versionString = process.env.RD_MOCK_MACOS_VERSION;

  if (!versionString) {
    const { stdout } = await spawnFile('/usr/bin/sw_vers', ['-productVersion'], { stdio: ['ignore', 'pipe', console ?? 'ignore'] });

    versionString = stdout.trimEnd();
  }
  const currentVersion = semver.coerce(versionString);

  if (currentVersion) {
    macOsVersion = currentVersion;
  } else {
    throw new Error(`Cannot convert "${ versionString }" to macOS semver`);
  }
}

export function getMacOsVersion(): semver.SemVer {
  return macOsVersion;
}
