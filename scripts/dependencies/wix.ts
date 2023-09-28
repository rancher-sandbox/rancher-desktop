import fs from 'fs';
import path from 'path';

import semver from 'semver';

import { Dependency, DownloadContext, getPublishedReleaseTagNames } from '../lib/dependencies';
import { download } from '../lib/download';

import { simpleSpawn } from 'scripts/simple_process';

/**
 * Wix downloads the latest build of WiX3.
 */
export class Wix implements Dependency {
  readonly name = 'wix';

  // Wix4 is packaged really oddly (involves NuGet), and while there's a sketchy
  // build in github.com/electron-userland/electron-builder-binaries it's rather
  // outdated (and has since-fixed bugs).
  readonly githubOwner = 'wixtoolset';
  readonly githubRepo = 'wix3';

  async download(context: DownloadContext): Promise<void> {
    // WiX doesn't appear to believe in checksum files...

    const hostDir = path.join(context.resourcesDir, 'host');
    const wixDir = path.join(hostDir, 'wix');
    const archivePath = path.join(hostDir, `${ context.versions.wix }.zip`);
    const url = `https://github.com/wixtoolset/wix3/releases/download/${ context.versions.wix }/wix311-binaries.zip`;

    await fs.promises.mkdir(wixDir, { recursive: true });
    await download(url, archivePath);
    await simpleSpawn('unzip', ['-o', archivePath, '-d', wixDir], { cwd: wixDir });
  }

  async getAvailableVersions(): Promise<string[]> {
    return await getPublishedReleaseTagNames(this.githubOwner, this.githubRepo);
  }

  private wixVersionToSemver(version: string): string {
    let onlyNumbers = version.replace(/^wix/, '').replace(/rtm$/, '');

    if (onlyNumbers.length === 3) {
      onlyNumbers = `${ onlyNumbers }0`;
    }
    if (onlyNumbers.length !== 4) {
      throw new Error(`Wix version "${ version }" is not in a recognized format`);
    }
    const major = Number(onlyNumbers[0]);
    const minor = Number(onlyNumbers.slice(1, 3));
    const patch = Number(onlyNumbers[3]);

    return `${ major }.${ minor }.${ patch }`;
  }

  rcompareVersions(version1: string, version2: string): -1 | 0 | 1 {
    const semverVersion1 = this.wixVersionToSemver(version1);
    const semverVersion2 = this.wixVersionToSemver(version2);

    return semver.rcompare(semverVersion1, semverVersion2);
  }
}
