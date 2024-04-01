import fs from 'fs';
import path from 'path';

import semver from 'semver';

import { Dependency, DownloadContext, GitHubDependency, getOctokit } from '../lib/dependencies';
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
    const version = semver.parse(context.versions.wix);

    if (!version) {
      throw new Error(`Could not parse WiX version ${ context.versions.wix }`);
    }

    const hostDir = path.join(context.resourcesDir, 'host');
    const wixDir = path.join(hostDir, 'wix');
    const archivePath = path.join(hostDir, `${ tagName }.zip`);
    // The archive name never includes the patch version.
    const archiveName = `wix${ version.major }${ version.minor }-binaries.zip`;
    const url = `https://github.com/wixtoolset/wix3/releases/download/${ tagName }/${ archiveName }`;

    await fs.promises.mkdir(wixDir, { recursive: true });
    await download(url, archivePath);
    await simpleSpawn('unzip', ['-q', '-o', archivePath, '-d', wixDir], { cwd: wixDir });
  }

  versionToTagName(versionString: string): string {
    const version = semver.parse(versionString);

    if (!version) {
      throw new Error(`Could not parse WiX version ${ versionString }`);
    }

    return `wix${ version.major }${ version.minor }${ version.patch || '' }rtm`;
  }

  async getAvailableVersions(): Promise<string[]> {
    // WiX tag names are `wix${ major }${ minor }${ patch if not zero }rtm` with
    // no separation between fields; so we have to dig the version number out
    // of the release title instead.
    const { data: releases } = await getOctokit().rest.repos.listReleases({ owner: this.githubOwner, repo: this.githubRepo });
    const publishedReleases = releases.filter(release => release.published_at);
    const versions = publishedReleases.map(r => (/^WiX Toolset (v\d+\.\d+\.\d+)/.exec(r.name ?? '') ?? [])[1]);

    return versions.filter(version => version);
  }

  rcompareVersions(version1: string, version2: string): -1 | 0 | 1 {
    return semver.rcompare(version1, version2);
  }
}
