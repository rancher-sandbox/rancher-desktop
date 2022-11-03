import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { download } from '../lib/download';

import { DownloadContext, Dependency, GithubVersionGetter } from 'scripts/lib/dependencies';

function extract(resourcesPath: string, file: string, expectedFile: string): void {
  const systemRoot = process.env.SystemRoot;

  if (!systemRoot) {
    throw new Error('Could not find system root');
  }
  const bsdTar = path.join(systemRoot, 'system32', 'tar.exe');

  spawnSync(
    bsdTar,
    ['-xzf', file, expectedFile],
    {
      cwd:   resourcesPath,
      stdio: 'inherit',
    });
  fs.rmSync(file, { maxRetries: 10 });
}

export class HostResolverPeer extends GithubVersionGetter implements Dependency {
  name = 'hostResolver';
  githubOwner = 'rancher-sandbox';
  githubRepo = 'rancher-desktop-host-resolver';

  async download(context: DownloadContext): Promise<void> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const tarName = `host-resolver-v${ context.versions.hostResolver }-linux-amd64.tar.gz`;
    const resolverVsockPeerURL = `${ baseURL }/v${ context.versions.hostResolver }/${ tarName }`;
    const resolverVsockPeerPath = path.join(context.internalDir, tarName );

    await download(
      resolverVsockPeerURL,
      resolverVsockPeerPath,
      { access: fs.constants.W_OK });

    extract(context.internalDir, resolverVsockPeerPath, 'host-resolver');
  }
}

export class HostResolverHost extends GithubVersionGetter implements Dependency {
  name = 'hostResolver';
  githubOwner = 'rancher-sandbox';
  githubRepo = 'rancher-desktop-host-resolver';

  async download(context: DownloadContext): Promise<void> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const zipName = `host-resolver-v${ context.versions.hostResolver }-windows-amd64.zip`;
    const resolverVsockHostURL = `${ baseURL }/v${ context.versions.hostResolver }/${ zipName }`;
    const resolverVsockHostPath = path.join(context.internalDir, zipName);

    await download(
      resolverVsockHostURL,
      resolverVsockHostPath,
      { access: fs.constants.W_OK });

    extract(context.internalDir, resolverVsockHostPath, 'host-resolver.exe');
  }
}

export class WSLDistro extends GithubVersionGetter implements Dependency {
  name = 'WSLDistro';
  githubOwner = 'rancher-sandbox';
  githubRepo = 'rancher-desktop-wsl-distro';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download`;
    const tarName = `distro-${ context.versions.WSLDistro }.tar`;
    const url = `${ baseUrl }/v${ context.versions.WSLDistro }/${ tarName }`;
    const destPath = path.join(context.resourcesDir, context.platform, tarName);

    await download(url, destPath, { access: fs.constants.W_OK });
  }
}
