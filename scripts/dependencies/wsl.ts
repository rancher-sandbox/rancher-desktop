import fs from 'fs';
import path from 'path';

import semver from 'semver';

import { download } from '../lib/download';
import { simpleSpawn } from '../simple_process';

import { DownloadContext, GitHubDependency, getPublishedReleaseTagNames, getPublishedVersions } from 'scripts/lib/dependencies';

export class Moproxy implements GitHubDependency {
  name = 'moproxy';
  githubOwner = 'sorz';
  githubRepo = 'moproxy';

  async download(context: DownloadContext): Promise<void> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const binName = `moproxy_${ context.versions.moproxy }_linux_x86_64_musl.bin`;
    const archiveName = `${ binName }.xz`;
    const moproxyURL = `${ baseURL }/v${ context.versions.moproxy }/${ archiveName }`;
    const archivePath = path.join(context.internalDir, archiveName);
    const moproxyPath = path.join(context.internalDir, 'moproxy');

    await download(
      moproxyURL,
      archivePath,
      { access: fs.constants.W_OK });

    // moproxy uses xz with no tar wrapper; just decompress it manually.
    await simpleSpawn('7z', ['e', archivePath], { cwd: context.internalDir });
    await fs.promises.rename(path.join(context.internalDir, binName), moproxyPath);
    await fs.promises.rm(archivePath);
  }

  async getAvailableVersions(includePrerelease = false): Promise<string[]> {
    return await getPublishedVersions(this.githubOwner, this.githubRepo, includePrerelease);
  }

  versionToTagName(version: string): string {
    return `v${ version }`;
  }

  rcompareVersions(version1: string, version2: string): -1 | 0 | 1 {
    return semver.rcompare(version1, version2);
  }
}

export class WSLDistro implements GitHubDependency {
  name = 'WSLDistro';
  githubOwner = 'rancher-sandbox';
  githubRepo = 'rancher-desktop-wsl-distro';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const tarName = `distro-${ context.versions.WSLDistro }.tar`;
    const url = `${ baseUrl }/v${ context.versions.WSLDistro }/${ tarName }`;
    const destPath = path.join(context.resourcesDir, context.platform, 'staging', tarName);

    await download(url, destPath, { access: fs.constants.W_OK });
  }

  async getAvailableVersions(): Promise<string[]> {
    const tagNames = await getPublishedReleaseTagNames(this.githubOwner, this.githubRepo);

    return tagNames.map((tagName: string) => tagName.replace(/^v/, ''));
  }

  versionToTagName(version: string): string {
    return `v${ version }`;
  }

  rcompareVersions(version1: string, version2: string): -1 | 0 | 1 {
    const semver1 = semver.coerce(version1);
    const semver2 = semver.coerce(version2);

    if (semver1 === null || semver2 === null) {
      throw new Error(`One of ${ version1 } and ${ version2 } failed to be coerced to semver`);
    }

    return semver.rcompare(semver1, semver2);
  }
}
