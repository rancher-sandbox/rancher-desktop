import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

import downloadLima from 'scripts/download/lima';
import downloadMobyOpenAPISpec from 'scripts/download/moby-openapi';
import downloadDependencies from 'scripts/download/tools';
import { downloadWSLDistro, downloadHostResolverHost, downloadHostResolverPeer } from 'scripts/download/wsl';
import { DependencyPlatform, DependencyVersions, DownloadContext, Platform, KubePlatform } from 'scripts/lib/dependencies';

async function runScripts(): Promise<void> {
  // load desired versions of dependencies
  const depVersions = await DependencyVersions.fromYAMLFile('dependencies.yaml');

  // download the desired versions
  await downloadMobyOpenAPISpec();
  switch (os.platform()) {
  case 'linux':
    const linuxDownloadContext = buildDownloadContextFor('linux');
    await downloadDependencies(linuxDownloadContext, depVersions);
    await downloadLima();
    break;
  case 'darwin':
    const macosDownloadContext = buildDownloadContextFor('darwin');
    await downloadDependencies(macosDownloadContext, depVersions);
    await downloadLima();
    break;
  case 'win32':
    // download things for windows
    const windowsDownloadContext = buildDownloadContextFor('win32');
    await downloadDependencies(windowsDownloadContext, depVersions);
    await downloadWSLDistro(windowsDownloadContext, depVersions.WSLDistro);
    await downloadHostResolverHost(windowsDownloadContext, depVersions.hostResolver);

    // download things that go inside WSL distro
    const wslDownloadContext = buildDownloadContextFor('wsl');
    await downloadDependencies(wslDownloadContext, depVersions);
    await downloadHostResolverPeer(wslDownloadContext, depVersions.hostResolver);
    break;
  }
}

function buildDownloadContextFor(rawPlatform: DependencyPlatform): DownloadContext {
  const platform = rawPlatform === 'wsl' ? 'linux' : rawPlatform;
  const resourcesDir = path.join(process.cwd(), 'resources', platform);
  const downloadContext: DownloadContext = {
    dependencyPlaform: rawPlatform,
    platform,
    kubePlatform:      getKubePlatform(platform),
    resourcesDir:      resourcesDir,
    binDir:            path.join(resourcesDir, 'bin'),
    internalDir:       path.join(resourcesDir, 'internal'),
  };

  fs.mkdirSync(downloadContext.binDir, { recursive: true });
  fs.mkdirSync(downloadContext.internalDir, { recursive: true });

  return downloadContext;
}

function getKubePlatform(platform: Platform): KubePlatform {
  const platformToKubePlatfom: Record<Platform, KubePlatform> = {
    'darwin': 'darwin',
    'linux': 'linux',
    'win32': 'windows',
  }
  return platformToKubePlatfom[platform];
}

runScripts().then(() => {
  execFileSync('node', ['node_modules/electron-builder/out/cli/cli.js', 'install-app-deps'], { stdio: 'inherit' });
})
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
