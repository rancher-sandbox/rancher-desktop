import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { downloadLimaAndQemu, downloadAlpineLimaISO } from 'scripts/download/lima';
import { downloadMobyOpenAPISpec } from 'scripts/download/moby-openapi';
import * as tools from 'scripts/download/tools';
import { downloadWSLDistro, downloadHostResolverHost, downloadHostResolverPeer } from 'scripts/download/wsl';
import { DependencyPlatform, DependencyVersions, DownloadContext } from 'src/utils/dependencies';

// Dependencies that should be installed into places that users touch
// (so users' WSL distros and hosts as of the time of writing).
const userTouchedDependencies = [
  tools.downloadKuberlrAndKubectl,
  tools.downloadHelm,
  tools.downloadDockerCLI,
  tools.downloadDockerBuildx,
  tools.downloadDockerCompose,
  tools.downloadDockerProvidedCredHelpers,
  tools.downloadECRCredHelper,
];

// Dependencies that are specific to unix hosts.
const unixDependencies = [
  downloadLimaAndQemu,
  downloadAlpineLimaISO,
];

// Dependencies that are specific to windows hosts.
const windowsDependencies = [
  downloadWSLDistro,
  downloadHostResolverHost,
];

// Dependencies that are specific to WSL.
const wslDependencies = [
  downloadHostResolverPeer,
];

// Dependencies that are specific to WSL and Lima VMs.
const vmDependencies = [
  tools.downloadTrivy,
  tools.downloadGuestAgent,
];

// Dependencies that are specific to hosts.
const hostDependencies = [
  tools.downloadSteve,
  tools.downloadRancherDashboard,
  downloadMobyOpenAPISpec,
];

function downloadDependencies(context: DownloadContext, dependencies: ((context: DownloadContext) => Promise<void>)[]): Promise<void[]> {
  return Promise.all(
    dependencies.map(downloadDependency => downloadDependency(context)),
  );
}

async function runScripts(): Promise<void> {
  // load desired versions of dependencies
  const depVersions = await DependencyVersions.fromYAMLFile('dependencies.yaml');
  const platform = os.platform();

  if (platform === 'linux' || platform === 'darwin') {
    // download things that go on unix host
    const hostDownloadContext = buildDownloadContextFor(platform, depVersions);

    await downloadDependencies(hostDownloadContext, [...userTouchedDependencies, ...unixDependencies, ...hostDependencies]);

    // download things that go inside Lima VM
    const vmDownloadContext = buildDownloadContextFor('linux', depVersions);

    await downloadDependencies(vmDownloadContext, vmDependencies);
  } else if (platform === 'win32') {
    // download things for windows
    const hostDownloadContext = buildDownloadContextFor('win32', depVersions);

    await downloadDependencies(hostDownloadContext, [...userTouchedDependencies, ...windowsDependencies, ...hostDependencies]);

    // download things that go inside WSL distro
    const vmDownloadContext = buildDownloadContextFor('wsl', depVersions);

    await downloadDependencies(vmDownloadContext, [...userTouchedDependencies, ...wslDependencies, ...vmDependencies]);
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
