import fs from 'fs';
import path from 'path';

import { download } from '../lib/download';
import { simpleSpawn } from '../simple_process';

import { DownloadContext, GitHubDependency, GlobalDependency } from 'scripts/lib/dependencies';

export class Moproxy extends GlobalDependency(GitHubDependency) {
  readonly name = 'moproxy';
  readonly githubOwner = 'sorz';
  readonly githubRepo = 'moproxy';

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
}

export class WSLDistro extends GlobalDependency(GitHubDependency) {
  readonly name = 'WSLDistro';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-wsl-distro';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const tarName = `distro-${ context.versions.WSLDistro }.tar`;
    const url = `${ baseUrl }/v${ context.versions.WSLDistro }/${ tarName }`;
    const destPath = path.join(context.resourcesDir, context.platform, 'staging', tarName);

    await download(url, destPath, { access: fs.constants.W_OK });
  }
}
