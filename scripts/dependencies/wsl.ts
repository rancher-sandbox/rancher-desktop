import fs from 'fs';
import path from 'path';

import { download } from '../lib/download';
import { simpleSpawn } from '../simple_process';

import {
  DownloadContext,
  downloadAndHash,
  GitHubDependency,
  GlobalDependency,
  lookupChecksum,
  Sha256Checksum,
} from '@/scripts/lib/dependencies';

export class Moproxy extends GlobalDependency(GitHubDependency) {
  readonly name = 'moproxy';
  readonly githubOwner = 'sorz';
  readonly githubRepo = 'moproxy';

  async download(context: DownloadContext): Promise<void> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const binName = `moproxy_${ context.dependencies.moproxy.version }_linux_x86_64_musl.bin`;
    const archiveName = `${ binName }.xz`;
    const moproxyURL = `${ baseURL }/v${ context.dependencies.moproxy.version }/${ archiveName }`;
    const archivePath = path.join(context.internalDir, archiveName);
    const moproxyPath = path.join(context.internalDir, 'moproxy');

    await download(
      moproxyURL,
      archivePath,
      {
        expectedChecksum: lookupChecksum(context, this.name, archiveName),
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

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    // Upstream does not publish a checksum file, so we record the sha256 we
    // observe at bump time.
    const archiveName = `moproxy_${ version }_linux_x86_64_musl.bin.xz`;
    const url = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }/${ archiveName }`;

    return { [archiveName]: await downloadAndHash(url) };
  }
}

export class WSLDistro extends GlobalDependency(GitHubDependency) {
  readonly name = 'WSLDistro';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-wsl-distro';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const tarName = `distro-${ context.dependencies.WSLDistro.version }.tar`;
    const url = `${ baseUrl }/v${ context.dependencies.WSLDistro.version }/${ tarName }`;
    const destPath = path.join(context.resourcesDir, context.platform, 'staging', tarName);

    await download(url, destPath, {
      expectedChecksum: lookupChecksum(context, this.name, tarName),
      access:           fs.constants.W_OK,
    });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    // Upstream does not publish a checksum file, so we record the sha256 we
    // observe at bump time.
    const tarName = `distro-${ version }.tar`;
    const url = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }/${ tarName }`;

    return { [tarName]: await downloadAndHash(url) };
  }
}
