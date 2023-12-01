// This downloads the resources related to Lima.

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import semver from 'semver';

import { download, getResource } from '../lib/download';

import {
  DownloadContext, Dependency, AlpineLimaISOVersion, getOctokit, GitHubDependency, getPublishedReleaseTagNames, GitHubRelease,
} from 'scripts/lib/dependencies';

export class Lima implements Dependency, GitHubDependency {
  name = 'lima';
  githubOwner = 'rancher-sandbox';
  githubRepo = 'rancher-desktop-lima';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    let platform: string = context.platform;

    // If the name of the forward compatible limactl binary changes or the
    // binary is built with a newer version of xcode please update, the
    // fwdCompatLimactlBin or fwdCompatLimactlDarwinVer
    // constants in backend/lima.ts.
    const fwdCompatLimactlBin = 'limactl.ventura';

    if (platform === 'darwin') {
      platform = 'macos-11.amd64';
      if (process.env.M1) {
        platform = `macos-11.arm64`;
      }
    } else {
      platform = 'linux.amd64';
    }

    const url = `${ baseUrl }/v${ context.versions.lima }/lima.${ platform }.tar.gz`;
    const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];
    const limaDir = path.join(context.resourcesDir, context.platform, 'lima');
    const tarPath = path.join(context.resourcesDir, context.platform, `lima.${ platform }.v${ context.versions.lima }.tgz`);

    await download(url, tarPath, {
      expectedChecksum,
      checksumAlgorithm: 'sha512',
      access:            fs.constants.W_OK,
    });
    await fs.promises.mkdir(limaDir, { recursive: true });

    const child = childProcess.spawn('/usr/bin/tar', ['-xf', tarPath],
      { cwd: limaDir, stdio: 'inherit' });

    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code, signal) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Lima extract failed with ${ code || signal }`));
        }
      });
    });

    // Download and install forward compatible limactl binary built for the newest Darwin versions
    if (context.platform === 'darwin') {
      platform = platform.replace('macos-11', 'macos-12');
      const url = `${ baseUrl }/v${ context.versions.lima }/lima.${ platform }.tar.gz`;
      const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];
      const tarPath = path.join(context.resourcesDir, context.platform, `lima.${ platform }.v${ context.versions.lima }.tgz`);

      await download(url, tarPath, {
        expectedChecksum,
        checksumAlgorithm: 'sha512',
        access:            fs.constants.W_OK,
      });

      const limactlChild = childProcess.spawn('/usr/bin/tar',
        ['-xf', tarPath, '-s', `/limactl/${ fwdCompatLimactlBin }/`, '--exclude', 'lima-guestagent*'],
        { cwd: limaDir, stdio: 'inherit' });

      await new Promise<void>((resolve, reject) => {
        limactlChild.on('exit', (code, signal) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Limactl extract failed with ${ code || signal }`));
          }
        });
      });
    }
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

export class LimaAndQemu implements Dependency, GitHubDependency {
  name = 'limaAndQemu';
  githubOwner = 'rancher-sandbox';
  githubRepo = 'lima-and-qemu';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    let platform: string = context.platform;

    if (platform === 'darwin') {
      platform = 'macos';
      if (process.env.M1) {
        platform = `macos-aarch64`;
      }
    }
    const url = `${ baseUrl }/v${ context.versions.limaAndQemu }/lima-and-qemu.${ platform }.tar.gz`;
    const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];
    const limaDir = path.join(context.resourcesDir, context.platform, 'lima');
    const tarPath = path.join(context.resourcesDir, context.platform, `lima-and-qemu.v${ context.versions.limaAndQemu }.tgz`);

    await download(url, tarPath, {
      expectedChecksum, checksumAlgorithm: 'sha512', access: fs.constants.W_OK,
    });
    await fs.promises.mkdir(limaDir, { recursive: true });

    const child = childProcess.spawn('/usr/bin/tar', ['-xf', tarPath, '--exclude', 'lima*'],
      { cwd: limaDir, stdio: 'inherit' });

    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code, signal) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Lima-and-QEMU extract failed with ${ code || signal }`));
        }
      });
    });
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

export class AlpineLimaISO implements Dependency, GitHubDependency {
  name = 'alpineLimaISO';
  githubOwner = 'rancher-sandbox';
  githubRepo = 'alpine-lima';
  isoVersionRegex = /^[0-9]+\.[0-9]+\.[0-9]+\.rd[0-9]+$/;

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const edition = 'rd';
    const version = context.versions.alpineLimaISO;
    let arch = 'x86_64';

    if (context.platform === 'darwin' && process.env.M1) {
      arch = 'aarch64';
    }
    const isoName = `alpine-lima-${ edition }-${ version.alpineVersion }-${ arch }.iso`;
    const url = `${ baseUrl }/v${ version.isoVersion }/${ isoName }`;
    const destPath = path.join(process.cwd(), 'resources', os.platform(), `alpine-lima-v${ version.isoVersion }-${ edition }-${ version.alpineVersion }.iso`);
    const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];

    await download(url, destPath, {
      expectedChecksum, checksumAlgorithm: 'sha512', access: fs.constants.W_OK,
    });
  }

  assembleAlpineLimaISOVersionFromGitHubRelease(release: GitHubRelease): AlpineLimaISOVersion {
    const matchingAsset = release.assets.find((asset: { name: string }) => asset.name.includes('rd'));

    if (!matchingAsset) {
      throw new Error(`Could not find matching asset name in set ${ release.assets }`);
    }
    const nameMatch = matchingAsset.name.match(/alpine-lima-rd-([0-9]+\.[0-9]+\.[0-9])-.*/);

    if (!nameMatch) {
      throw new Error(`Failed to parse name "${ matchingAsset.name }"`);
    }
    const alpineVersion = nameMatch[1];

    return {
      isoVersion: release.tag_name.replace(/^v/, ''),
      alpineVersion,
    };
  }

  async getAvailableVersions(): Promise<AlpineLimaISOVersion[]> {
    const response = await getOctokit().rest.repos.listReleases({ owner: this.githubOwner, repo: this.githubRepo });
    const releases = response.data;
    const versions = await Promise.all(releases.map(this.assembleAlpineLimaISOVersionFromGitHubRelease));

    return versions;
  }

  versionToTagName(version: AlpineLimaISOVersion): string {
    return `v${ version.isoVersion }`;
  }

  versionToSemver(version: AlpineLimaISOVersion): string {
    const isoVersion = version.isoVersion;
    const isoVersionParts = isoVersion.split('.');

    if (!this.isoVersionRegex.test(isoVersion)) {
      throw new Error(`${ this.name }: version ${ version.isoVersion } is not in expected format ${ this.isoVersionRegex }`);
    }
    const normalVersion = isoVersionParts.slice(0, 3).join('.');
    const prereleaseVersion = isoVersionParts[3].replace('rd', '');

    return `${ normalVersion }-${ prereleaseVersion }`;
  }

  rcompareVersions(version1: AlpineLimaISOVersion, version2: AlpineLimaISOVersion): -1 | 0 | 1 {
    let semverVersion1 = '0.0.0';
    let invalidVersion1 = false;
    let semverVersion2 = '0.0.0';
    let invalidVersion2 = false;

    try {
      semverVersion1 = this.versionToSemver(version1);
    } catch (ex) {
      invalidVersion1 = true;
    }
    try {
      semverVersion2 = this.versionToSemver(version2);
    } catch (ex) {
      invalidVersion2 = true;
    }
    if (invalidVersion1 || invalidVersion2) {
      if (!invalidVersion1) {
        return -1; // Version 1 is valid, version 2 is not; count 1 as higher.
      }
      if (!invalidVersion2) {
        return 1; // Version 2 is valid, version 1 is not; count 2 as higher.
      }

      // Neither version is valid, return something consistent.
      if (version1.isoVersion > version2.isoVersion) {
        return -1;
      }
      if (version2.isoVersion > version1.isoVersion) {
        return 1;
      }

      return 0;
    }

    return semver.rcompare(semverVersion1, semverVersion2);
  }
}
