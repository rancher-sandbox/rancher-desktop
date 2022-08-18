import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { downloadLimaAndQemu, downloadAlpineLimaISO } from 'scripts/download/lima';
import downloadMobyOpenAPISpec from 'scripts/download/moby-openapi';
import * as tools from 'scripts/download/tools';
import { downloadWSLDistro, downloadHostResolverHost, downloadHostResolverPeer } from 'scripts/download/wsl';
import { DependencyPlatform, DependencyVersions, DownloadContext } from 'scripts/lib/dependencies';

const unixDependencies = [
  tools.downloadKuberlrAndKubectl,
  tools.downloadHelm,
  tools.downloadDockerCLI,
  tools.downloadDockerBuildx,
  tools.downloadDockerCompose,
  tools.downloadSteve,
  tools.downloadGuestAgent,
  tools.downloadDockerProvidedCredHelpers,
  tools.downloadECRCredHelper,
  downloadLimaAndQemu,
  downloadAlpineLimaISO,
];

const windowsDependencies = [
  tools.downloadKuberlrAndKubectl,
  tools.downloadHelm,
  tools.downloadDockerCLI,
  tools.downloadDockerBuildx,
  tools.downloadDockerCompose,
  tools.downloadSteve,
  tools.downloadGuestAgent,
  tools.downloadDockerProvidedCredHelpers,
  tools.downloadECRCredHelper,
  downloadWSLDistro,
  downloadHostResolverHost,
];

// Dependencies that are specific to WSL.
const wslDependencies = [
  tools.downloadKuberlrAndKubectl,
  tools.downloadHelm,
  tools.downloadDockerCLI,
  tools.downloadDockerBuildx,
  tools.downloadDockerCompose,
  tools.downloadSteve,
  tools.downloadGuestAgent,
  tools.downloadDockerProvidedCredHelpers,
  tools.downloadECRCredHelper,
  downloadHostResolverPeer,
]

// Dependencies that apply to all cases.
const platformIndependentDependencies = [
  tools.downloadRancherDashboard,
]

// These ones run inside the VM, so they always go in resources/linux.
const vmDependencies = [
  tools.downloadTrivy,
];

async function runScripts(): Promise<void> {
  // load desired versions of dependencies
  const depVersions = await DependencyVersions.fromYAMLFile('dependencies.yaml');

  // download dependencies that don't depend on platform
  const platformIndependentDownloadContext = buildDownloadContextFor('linux', depVersions);
  await downloadMobyOpenAPISpec();
  await Promise.all(platformIndependentDependencies.map(downloadDependency => downloadDependency(platformIndependentDownloadContext)));
  const platform = os.platform();

  if (platform === 'linux' || platform === 'darwin') {
    const downloadContext = buildDownloadContextFor(platform, depVersions);
    await Promise.all(unixDependencies.map((downloadDependency) => downloadDependency(downloadContext)));

    // download things that go inside Lima VM
    const vmDownloadContext = buildDownloadContextFor('linux', depVersions);
    await Promise.all(vmDependencies.map((downloadDependency) => downloadDependency(vmDownloadContext)));

  } else if (platform === 'win32') {
    // download things for windows
    const windowsDownloadContext = buildDownloadContextFor('win32', depVersions);
    await Promise.all(windowsDependencies.map((downloadDependency) => downloadDependency(windowsDownloadContext)));

    // download things that go inside WSL distro
    const wslDownloadContext = buildDownloadContextFor('wsl', depVersions);
    const dependencies = [...wslDependencies, ...vmDependencies];
    await Promise.all(dependencies.map((downloadDependency) => downloadDependency(wslDownloadContext)));
  }
}

function buildDownloadContextFor(rawPlatform: DependencyPlatform, depVersions: DependencyVersions): DownloadContext {
  const platform = rawPlatform === 'wsl' ? 'linux' : rawPlatform;
  const resourcesDir = path.join(process.cwd(), 'resources');
  const downloadContext: DownloadContext = {
    versions:          depVersions,
    dependencyPlaform: rawPlatform,
    platform,
    goPlatform:        platform === 'win32' ? 'windows' : platform,
    isM1:              !!process.env.M1,
    resourcesDir,
    binDir:            path.join(resourcesDir, platform, 'bin'),
    internalDir:       path.join(resourcesDir, platform, 'internal'),
  };

  fs.mkdirSync(downloadContext.binDir, { recursive: true });
  fs.mkdirSync(downloadContext.internalDir, { recursive: true });

  return downloadContext;
}

runScripts().then(() => {
  execFileSync('node', ['node_modules/electron-builder/out/cli/cli.js', 'install-app-deps'], { stdio: 'inherit' });
})
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
