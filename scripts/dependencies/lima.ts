// This downloads the resources related to Lima.

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { download, downloadTarGZ } from '../lib/download';

import {
  AlpineLimaISOVersion,
  DownloadContext,
  downloadAndHash,
  fetchUpstreamChecksums,
  getOctokit,
  GitHubDependency,
  GitHubRelease,
  GlobalDependency,
  lookupChecksum,
  Sha256Checksum,
} from '@/scripts/lib/dependencies';
import { simpleSpawn } from '@/scripts/simple_process';

export class Lima extends GlobalDependency(GitHubDependency) {
  readonly name = 'lima';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-lima';

  // Names the macOS runner that builds the rancher-desktop-lima darwin
  // archive.  Both `download()` and `getChecksums()` embed this token in
  // artifact filenames, so update it here when upstream bumps the runner
  // (e.g. `macos-16`).
  static readonly MACOS_RUNNER = 'macos-15';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const arch = process.env.M1 ? 'arm64' : 'amd64';
    const platform = context.platform === 'darwin' ? `${ Lima.MACOS_RUNNER }.${ arch }` : `linux.${ arch }`;
    const archiveName = `lima.${ platform }.tar.gz`;
    const url = `${ baseUrl }/v${ context.dependencies.lima.version }/${ archiveName }`;
    const expectedChecksum = lookupChecksum(context, this.name, archiveName);
    const limaDir = path.join(context.resourcesDir, context.platform, 'lima');
    const tarPath = path.join(context.resourcesDir, context.platform, `lima.${ platform }.v${ context.dependencies.lima.version }.tgz`);

    await download(url, tarPath, {
      expectedChecksum,
      access: fs.constants.W_OK,
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

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const platforms = [`${ Lima.MACOS_RUNNER }.amd64`, `${ Lima.MACOS_RUNNER }.arm64`, 'linux.amd64', 'linux.arm64'];

    return Object.fromEntries(await Promise.all(platforms.map(async(platform) => {
      const archiveName = `lima.${ platform }.tar.gz`;
      const url = `${ baseUrl }/${ archiveName }`;
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha512sum`, 'sha512');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha512', expected: sidecar[archiveName] },
      });

      return [archiveName, checksum];
    })));
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

    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const arch = context.isM1 ? 'aarch64' : 'x86_64';
    const archiveName = `qemu-${ context.dependencies.qemu.version }-${ context.platform }-${ arch }.tar.gz`;
    const url = `${ baseUrl }/v${ context.dependencies.qemu.version }/${ archiveName }`;
    const expectedChecksum = lookupChecksum(context, this.name, archiveName);
    const limaDir = path.join(context.resourcesDir, context.platform, 'lima');
    const tarPath = path.join(context.resourcesDir, context.platform, `qemu.v${ context.dependencies.qemu.version }.tgz`);

    await download(url, tarPath, {
      expectedChecksum, access: fs.constants.W_OK,
    });
    await fs.promises.mkdir(limaDir, { recursive: true });

    await simpleSpawn('/usr/bin/tar', ['-xf', tarPath], { cwd: limaDir });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    // rancher-desktop-qemu does not yet publish a linux/arm64 build; mirror the skip in download().
    const platforms: [string, string][] = [
      ['darwin', 'x86_64'], ['darwin', 'aarch64'],
      ['linux', 'x86_64'],
    ];

    return Object.fromEntries(await Promise.all(platforms.map(async([platform, arch]) => {
      const archiveName = `qemu-${ version }-${ platform }-${ arch }.tar.gz`;
      const url = `${ baseUrl }/${ archiveName }`;
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha512sum`, 'sha512');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha512', expected: sidecar[archiveName] },
      });

      return [archiveName, checksum];
    })));
  }
}

export class SocketVMNet extends GlobalDependency(GitHubDependency) {
  readonly name = 'socketVMNet';
  readonly githubOwner = 'lima-vm';
  readonly githubRepo = 'socket_vmnet';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'arm64' : 'x86_64';
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.dependencies.socketVMNet.version }`;
    const archiveName = `socket_vmnet-${ context.dependencies.socketVMNet.version }-${ arch }.tar.gz`;
    const expectedChecksum = lookupChecksum(context, this.name, archiveName);

    await downloadTarGZ(`${ baseURL }/${ archiveName }`,
      path.join(context.resourcesDir, context.platform, 'lima', 'socket_vmnet', 'bin', 'socket_vmnet'),
      { expectedChecksum, entryName: './opt/socket_vmnet/bin/socket_vmnet' });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/SHA256SUMS`, 'sha256');
    const architectures = ['x86_64', 'arm64'];

    return Object.fromEntries(await Promise.all(architectures.map(async(arch) => {
      const archiveName = `socket_vmnet-${ version }-${ arch }.tar.gz`;
      const checksum = await downloadAndHash(`${ baseURL }/${ archiveName }`, {
        verify: { algorithm: 'sha256', expected: upstream[archiveName] },
      });

      return [archiveName, checksum];
    })));
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
    const version = context.dependencies.alpineLimaISO.version;
    const arch = process.env.M1 ? 'aarch64' : 'x86_64';

    const isoName = `alpine-lima-${ edition }-${ version.alpineVersion }-${ arch }.iso`;
    const url = `${ baseUrl }/v${ version.isoVersion }/${ isoName }`;
    const destPath = path.join(process.cwd(), 'resources', os.platform(), `alpine-lima-v${ version.isoVersion }-${ edition }-${ version.alpineVersion }.iso`);
    const expectedChecksum = lookupChecksum(context, this.name, isoName);

    await download(url, destPath, {
      expectedChecksum, access: fs.constants.W_OK,
    });
  }

  async getChecksums(version: AlpineLimaISOVersion): Promise<Record<string, Sha256Checksum>> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version.isoVersion }`;
    const edition = 'rd';
    const architectures = ['x86_64', 'aarch64'];

    return Object.fromEntries(await Promise.all(architectures.map(async(arch) => {
      const isoName = `alpine-lima-${ edition }-${ version.alpineVersion }-${ arch }.iso`;
      const url = `${ baseUrl }/${ isoName }`;
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha512sum`, 'sha512');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha512', expected: sidecar[isoName] },
      });

      return [isoName, checksum];
    })));
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
