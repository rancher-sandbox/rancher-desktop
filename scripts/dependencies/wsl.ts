import fs from 'fs';
import path from 'path';

import { download } from '../lib/download';
import { simpleSpawn } from '../simple_process';

import {
  DependencyAsset,
  DownloadContext,
  downloadAndHash,
  GitHubDependency,
  GlobalDependency,
  selectAsset,
} from '@/scripts/lib/dependencies';

export class Moproxy extends GlobalDependency(GitHubDependency) {
  readonly name = 'moproxy';
  readonly githubOwner = 'sorz';
  readonly githubRepo = 'moproxy';

  async download(context: DownloadContext): Promise<void> {
    const asset = selectAsset(context, this.name, { platform: 'linux', arch: 'amd64' });
    const binName = `moproxy_${ context.dependencies.moproxy.version }_linux_x86_64_musl.bin`;
    const archiveName = `${ binName }.xz`;
    const archivePath = path.join(context.internalDir, archiveName);
    const moproxyPath = path.join(context.internalDir, 'moproxy');

    await download(
      asset.url,
      archivePath,
      {
        expectedChecksum: asset.checksum,
        access:           fs.constants.W_OK,
      });

    // moproxy uses xz with no tar wrapper; just decompress it manually.
    // Keep archivePath beside moproxyPath so download() hits its cache on
    // subsequent postinstall runs; electron-builder.yml excludes *.xz.
    // Pass -y to auto-confirm the overwrite prompt; otherwise a
    // leftover binName from a partial-failure retry stalls postinstall.
    await simpleSpawn('7z', ['e', '-y', archivePath], { cwd: context.internalDir });
    await fs.promises.rename(path.join(context.internalDir, binName), moproxyPath);
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    // Upstream does not publish a checksum file, so we record the sha256 we
    // observe at bump time.  moproxy also publishes an armv7 build, which the
    // x86_64 WSL distro has no use for.
    const archiveName = `moproxy_${ version }_linux_x86_64_musl.bin.xz`;
    const url = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }/${ archiveName }`;

    return [{ platform: 'linux', arch: 'amd64', url, checksum: await downloadAndHash(url) }];
  }
}

export class WSLDistro extends GlobalDependency(GitHubDependency) {
  readonly name = 'WSLDistro';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-wsl-distro';

  async download(context: DownloadContext): Promise<void> {
    const asset = selectAsset(context, this.name, { platform: 'wsl' });
    const tarName = `distro-${ context.dependencies.WSLDistro.version }.tar`;
    const destPath = path.join(context.resourcesDir, context.platform, 'staging', tarName);

    await download(asset.url, destPath, {
      expectedChecksum: asset.checksum,
      access:           fs.constants.W_OK,
    });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    // Upstream does not publish a checksum file, so we record the sha256 we
    // observe at bump time.  The distro ships a single, arch-independent tar.
    const tarName = `distro-${ version }.tar`;
    const url = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }/${ tarName }`;

    return [{ platform: 'wsl', url, checksum: await downloadAndHash(url) }];
  }
}
