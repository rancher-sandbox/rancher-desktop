import fs from 'fs';
import path from 'path';

import semver from 'semver';

import {
  assetChecksum,
  DependencyAsset,
  DownloadContext,
  downloadAndHash,
  getOctokit,
  GitHubDependency,
  GlobalDependency,
  selectAsset,
} from '../lib/dependencies';
import { download } from '../lib/download';

import { simpleSpawn } from '@/scripts/simple_process';

/**
 * Wix downloads the latest build of WiX3.
 */
export class Wix extends GlobalDependency(GitHubDependency) {
  readonly name = 'wix';

  // Wix4 is packaged really oddly (involves NuGet), and while there's a sketchy
  // build in https://github.com/electron-userland/electron-builder-binaries, it's rather
  // outdated (and has since-fixed bugs).
  readonly githubOwner = 'wixtoolset';
  readonly githubRepo = 'wix3';
  readonly releaseFilter = 'custom';

  async download(context: DownloadContext): Promise<void> {
    // WiX is a .NET toolset with no per-arch build; a single Windows asset
    // serves every architecture.  Upstream publishes no checksum file, so we
    // rely on the digest recorded in dependencies.yaml at bump time.
    const asset = selectAsset(context, this.name, { platform: 'windows' });
    const hostDir = path.join(context.resourcesDir, 'host');
    const wixDir = path.join(hostDir, 'wix');
    const archivePath = path.join(hostDir, path.basename(new URL(asset.url).pathname));

    await fs.promises.mkdir(wixDir, { recursive: true });
    await download(asset.url, archivePath, { expectedChecksum: assetChecksum(asset) });
    await simpleSpawn('unzip', ['-q', '-o', archivePath, '-d', wixDir], { cwd: wixDir });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const tagName = this.versionToTagName(version);
    const parsed = semver.parse(version);

    if (!parsed) {
      throw new Error(`Could not parse WiX version ${ version }`);
    }

    // The archive name never includes the patch version.
    const archiveName = `wix${ parsed.major }${ parsed.minor }-binaries.zip`;
    const url = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/${ tagName }/${ archiveName }`;

    return [{ platform: 'windows', url, checksum: await downloadAndHash(url) }];
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
}
