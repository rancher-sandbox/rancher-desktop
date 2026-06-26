// This downloads the resources related to Lima.

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { download, downloadTarGZ } from '../lib/download';

import {
  AlpineLimaISOVersion,
  AssetPlatform,
  assetChecksum,
  DependencyAsset,
  DownloadContext,
  downloadAndHash,
  fetchUpstreamChecksums,
  getOctokit,
  GitHubDependency,
  GitHubRelease,
  GlobalDependency,
  GoArch,
  selectAsset,
} from '@/scripts/lib/dependencies';
import { simpleSpawn } from '@/scripts/simple_process';

export class Lima extends GlobalDependency(GitHubDependency) {
  readonly name = 'lima';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-lima';

  // Names the macOS runner that builds the rancher-desktop-lima darwin
  // archive.  Both `download()` and `getAssets()` embed this token in
  // artifact filenames, so update it here when upstream bumps the runner
  // (e.g. `macos-16`).
  static readonly MACOS_RUNNER = 'macos-15';

  async download(context: DownloadContext): Promise<void> {
    const arch: GoArch = context.isM1 ? 'arm64' : 'amd64';
    const platform: AssetPlatform = context.platform === 'darwin' ? 'darwin' : 'linux';
    const token = context.platform === 'darwin' ? `${ Lima.MACOS_RUNNER }.${ arch }` : `linux.${ arch }`;
    const asset = selectAsset(context, this.name, { platform, arch });
    const limaDir = path.join(context.resourcesDir, context.platform, 'lima');
    const tarPath = path.join(context.resourcesDir, context.platform, `lima.${ token }.v${ context.dependencies.lima.version }.tgz`);

    await download(asset.url, tarPath, {
      expectedChecksum: assetChecksum(asset),
      access:           fs.constants.W_OK,
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

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    // macOS artifacts embed the runner name; linux artifacts use a plain token.
    const combos: { platform: AssetPlatform, arch: GoArch, token: string }[] = [
      { platform: 'darwin', arch: 'amd64', token: `${ Lima.MACOS_RUNNER }.amd64` },
      { platform: 'darwin', arch: 'arm64', token: `${ Lima.MACOS_RUNNER }.arm64` },
      { platform: 'linux', arch: 'amd64', token: 'linux.amd64' },
      { platform: 'linux', arch: 'arm64', token: 'linux.arm64' },
    ];

    return Promise.all(combos.map(async({ platform, arch, token }) => {
      const archiveName = `lima.${ token }.tar.gz`;
      const url = `${ baseUrl }/${ archiveName }`;
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha512sum`, 'sha512');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha512', expected: sidecar[archiveName] },
      });

      return { platform, arch, url, checksum };
    }));
  }
}

export class Qemu extends GlobalDependency(GitHubDependency) {
  readonly name = 'qemu';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-qemu';

  async download(context: DownloadContext): Promise<void> {
    // TODO: we don't have an arm64 version of QEMU for Linux yet.
    if (context.platform === 'linux' && context.isM1) {
      return;
    }

    const platform: AssetPlatform = context.platform === 'darwin' ? 'darwin' : 'linux';
    const asset = selectAsset(context, this.name, { platform, arch: context.isM1 ? 'arm64' : 'amd64' });
    const limaDir = path.join(context.resourcesDir, context.platform, 'lima');
    const tarPath = path.join(context.resourcesDir, context.platform, `qemu.v${ context.dependencies.qemu.version }.tgz`);

    await download(asset.url, tarPath, {
      expectedChecksum: assetChecksum(asset), access: fs.constants.W_OK,
    });
    await fs.promises.mkdir(limaDir, { recursive: true });

    await simpleSpawn('/usr/bin/tar', ['-xf', tarPath], { cwd: limaDir });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    // rancher-desktop-qemu does not yet publish a linux/arm64 build; mirror the skip in download().
    const combos: { platform: AssetPlatform, arch: GoArch, unameArch: string }[] = [
      { platform: 'darwin', arch: 'amd64', unameArch: 'x86_64' },
      { platform: 'darwin', arch: 'arm64', unameArch: 'aarch64' },
      { platform: 'linux', arch: 'amd64', unameArch: 'x86_64' },
    ];

    return Promise.all(combos.map(async({ platform, arch, unameArch }) => {
      const archiveName = `qemu-${ version }-${ platform }-${ unameArch }.tar.gz`;
      const url = `${ baseUrl }/${ archiveName }`;
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha512sum`, 'sha512');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha512', expected: sidecar[archiveName] },
      });

      return { platform, arch, url, checksum };
    }));
  }
}

export class SocketVMNet extends GlobalDependency(GitHubDependency) {
  readonly name = 'socketVMNet';
  readonly githubOwner = 'lima-vm';
  readonly githubRepo = 'socket_vmnet';

  async download(context: DownloadContext): Promise<void> {
    const asset = selectAsset(context, this.name, { platform: 'darwin', arch: context.isM1 ? 'arm64' : 'amd64' });

    await downloadTarGZ(asset.url,
      path.join(context.resourcesDir, context.platform, 'lima', 'socket_vmnet', 'bin', 'socket_vmnet'),
      { expectedChecksum: assetChecksum(asset), entryName: './opt/socket_vmnet/bin/socket_vmnet' });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/SHA256SUMS`, 'sha256');
    // socket_vmnet is macOS-only; upstream labels its arches x86_64 / arm64.
    const archLabels: Record<GoArch, string> = { amd64: 'x86_64', arm64: 'arm64' };

    return Promise.all((['amd64', 'arm64'] as const).map(async(arch) => {
      const archiveName = `socket_vmnet-${ version }-${ archLabels[arch] }.tar.gz`;
      const url = `${ baseURL }/${ archiveName }`;
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: upstream[archiveName] },
      });

      return { platform: 'darwin' as const, arch, url, checksum };
    }));
  }
}

export class AlpineLimaISO extends GlobalDependency(GitHubDependency) {
  readonly name = 'alpineLimaISO';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'alpine-lima';
  readonly releaseFilter = 'custom';

  async download(context: DownloadContext): Promise<void> {
    const edition = 'rd';
    const version = context.dependencies.alpineLimaISO.version as AlpineLimaISOVersion;
    const asset = selectAsset(context, this.name, { platform: 'linux', arch: context.isM1 ? 'arm64' : 'amd64' });
    const destPath = path.join(process.cwd(), 'resources', os.platform(), `alpine-lima-v${ version.isoVersion }-${ edition }-${ version.alpineVersion }.iso`);

    await download(asset.url, destPath, {
      expectedChecksum: assetChecksum(asset), access: fs.constants.W_OK,
    });
  }

  async getAssets(version: AlpineLimaISOVersion): Promise<DependencyAsset[]> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version.isoVersion }`;
    const edition = 'rd';
    // The ISO is the linux guest image; upstream labels its arches x86_64 / aarch64.
    const archLabels: Record<GoArch, string> = { amd64: 'x86_64', arm64: 'aarch64' };

    return Promise.all((['amd64', 'arm64'] as const).map(async(arch) => {
      const isoName = `alpine-lima-${ edition }-${ version.alpineVersion }-${ archLabels[arch] }.iso`;
      const url = `${ baseUrl }/${ isoName }`;
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha512sum`, 'sha512');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha512', expected: sidecar[isoName] },
      });

      return { platform: 'linux' as const, arch, url, checksum };
    }));
  }

  assembleAlpineLimaISOVersionFromGitHubRelease(release: GitHubRelease): AlpineLimaISOVersion {
    const matchingAsset = release.assets.find((asset: { name: string }) => asset.name.includes('rd'));

    if (!matchingAsset) {
      throw new Error(`Could not find matching asset name in set ${ release.assets }`);
    }
    const nameMatch = /alpine-lima-rd-([0-9]+\.[0-9]+\.[0-9])-.*/.exec(matchingAsset.name);

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

    return releases.map(release => this.assembleAlpineLimaISOVersionFromGitHubRelease(release));
  }

  versionToTagName(version: AlpineLimaISOVersion): string {
    return `v${ version.isoVersion }`;
  }

  rcompareVersions(version1: AlpineLimaISOVersion, version2: AlpineLimaISOVersion): -1 | 0 | 1 {
    return super.rcompareVersions(version1.isoVersion, version2.isoVersion);
  }
}
