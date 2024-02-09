import fs from 'fs';
import path from 'path';

import semver from 'semver';

import { Dependency, DownloadContext, GitHubDependency, getPublishedReleaseTagNames } from '../lib/dependencies';
import { download } from '../lib/download';

import { simpleSpawn } from 'scripts/simple_process';

/**
 * Wix downloads the latest build of WiX3.
 */
export class Wix implements Dependency, GitHubDependency {
  readonly name = 'wix';

  // Wix4 is packaged really oddly (involves NuGet), and while there's a sketchy
  // build in github.com/electron-userland/electron-builder-binaries it's rather
  // outdated (and has since-fixed bugs).
  readonly githubOwner = 'wixtoolset';
  readonly githubRepo = 'wix3';

  async download(context: DownloadContext): Promise<void> {
    // WiX doesn't appear to believe in checksum files...

    const tagName = this.versionToTagName(context.versions.wix);
    const hostDir = path.join(context.resourcesDir, 'host');
    const wixDir = path.join(hostDir, 'wix');
    const archivePath = path.join(hostDir, `${ tagName }.zip`);
    const archiveName = `wix${ context.versions.wix }-binaries.zip`;
    const url = `https://github.com/wixtoolset/wix3/releases/download/${ tagName }/${ archiveName }`;

    await fs.promises.mkdir(wixDir, { recursive: true });
    await download(url, archivePath);
    await simpleSpawn('unzip', ['-q', '-o', archivePath, '-d', wixDir], { cwd: wixDir });
  }

  versionToTagName(version: string): string {
    return `wix${ version }rtm`;
  }

  async getAvailableVersions(): Promise<string[]> {
    const tags = await getPublishedReleaseTagNames(this.githubOwner, this.githubRepo);

    return tags.map(t => t.replace(/^wix/, '')).map(t => t.replace(/rtm$/, ''));
  }

  private wixVersionToSemver(version: string): string {
    let normalized = version;

    if (normalized.length === 3) {
      normalized = `${ normalized }0`;
    }
    if (normalized.length !== 4) {
      throw new Error(`Wix version "${ version }" is not in a recognized format`);
    }
    const major = Number(normalized[0]);
    const minor = Number(normalized.slice(1, 3));
    const patch = Number(normalized[3]);

    return `${ major }.${ minor }.${ patch }`;
  }

  rcompareVersions(version1: string, version2: string): -1 | 0 | 1 {
    const semverVersion1 = this.wixVersionToSemver(version1);
    const semverVersion2 = this.wixVersionToSemver(version2);

    return semver.rcompare(semverVersion1, semverVersion2);
  }
}
