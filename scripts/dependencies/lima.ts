// This downloads the resources related to Lima.

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import yaml from 'yaml';

import { download, downloadTarGZ, getResource } from '../lib/download';

import {
  AlpineLimaISOVersion,
  DEP_VERSIONS_PATH,
  DependencyVersions,
  DownloadContext,
  findChecksum,
  getOctokit,
  GitHubDependency,
  GitHubRelease,
  GlobalDependency,
} from 'scripts/lib/dependencies';
import { simpleSpawn } from 'scripts/simple_process';

export class Lima extends GlobalDependency(GitHubDependency) {
  readonly name = 'lima';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-lima';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    let platform: string = context.platform;

    if (platform === 'darwin') {
      platform = `macos-15.${ process.env.M1 ? 'arm64' : 'amd64' }`;
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
  }
}

export class Qemu extends GlobalDependency(GitHubDependency) {
  readonly name = 'qemu';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-qemu';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const arch = context.isM1 ? 'aarch64' : 'x86_64';

    const url = `${ baseUrl }/v${ context.versions.qemu }/qemu-${ context.versions.qemu }-${ context.platform }-${ arch }.tar.gz`;
    const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];
    const limaDir = path.join(context.resourcesDir, context.platform, 'lima');
    const tarPath = path.join(context.resourcesDir, context.platform, `qemu.v${ context.versions.qemu }.tgz`);

    await download(url, tarPath, {
      expectedChecksum, checksumAlgorithm: 'sha512', access: fs.constants.W_OK,
    });
    await fs.promises.mkdir(limaDir, { recursive: true });

    await simpleSpawn('/usr/bin/tar', ['-xf', tarPath], { cwd: limaDir });
  }
}

export class SocketVMNet extends GlobalDependency(GitHubDependency) {
  readonly name = 'socketVMNet';
  readonly githubOwner = 'lima-vm';
  readonly githubRepo = 'socket_vmnet';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'arm64' : 'x86_64';
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.versions.socketVMNet }`;
    const archiveName = `socket_vmnet-${ context.versions.socketVMNet }-${ arch }.tar.gz`;
    const expectedChecksum = await findChecksum(`${ baseURL }/SHA256SUMS`, archiveName);

    await downloadTarGZ(`${ baseURL }/${ archiveName }`,
      path.join(context.resourcesDir, context.platform, 'lima', 'socket_vmnet', 'bin', 'socket_vmnet'),
      { expectedChecksum, entryName: './opt/socket_vmnet/bin/socket_vmnet' });
  }
}

export class AlpineLimaISO extends GlobalDependency(GitHubDependency) {
  readonly name = 'alpineLimaISO';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'alpine-lima';
  readonly releaseFilter = 'custom';

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

    return await Promise.all(releases.map(this.assembleAlpineLimaISOVersionFromGitHubRelease));
  }

  versionToTagName(version: AlpineLimaISOVersion): string {
    return `v${ version.isoVersion }`;
  }

  rcompareVersions(version1: AlpineLimaISOVersion, version2: AlpineLimaISOVersion): -1 | 0 | 1 {
    return super.rcompareVersions(version1.isoVersion, version2.isoVersion);
  }

  async updateManifest(newVersion: string | AlpineLimaISOVersion): Promise<Set<string>> {
    if (typeof newVersion === 'string') {
      throw new TypeError(`AlpineLimaISO.updateManifest does not support string version ${ newVersion }`);
    }

    const depVersions: DependencyVersions = yaml.parse(await fs.promises.readFile(DEP_VERSIONS_PATH, 'utf8'));

    depVersions.alpineLimaISO = newVersion;
    await fs.promises.writeFile(DEP_VERSIONS_PATH, yaml.stringify(depVersions), 'utf-8');

    return new Set([DEP_VERSIONS_PATH]);
  }
}
