import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
import { WSLDistro, HostResolverHost, HostResolverPeer } from 'scripts/dependencies/wsl';
import {
  DependencyPlatform, DependencyVersions, readDependencyVersions, DownloadContext, Dependency,
} from 'scripts/lib/dependencies';

// Dependencies that should be installed into places that users touch
// (so users' WSL distros and hosts as of the time of writing).
const userTouchedDependencies = [
  new tools.KuberlrAndKubectl(),
  new tools.Helm(),
  new tools.DockerCLI(),
  new tools.DockerBuildx(),
  new tools.DockerCompose(),
  new tools.DockerProvidedCredHelpers(),
  new tools.ECRCredHelper(),
];

// Dependencies that are specific to unix hosts.
const unixDependencies = [
  new LimaAndQemu(),
  new AlpineLimaISO(),
];

// Dependencies that are specific to windows hosts.
const windowsDependencies = [
  new WSLDistro(),
  new HostResolverHost(),
];

// Dependencies that are specific to WSL.
const wslDependencies = [
  new HostResolverPeer(),
];

// Dependencies that are specific to WSL and Lima VMs.
const vmDependencies = [
  new tools.Trivy(),
  new tools.GuestAgent(),
];

// Dependencies that are specific to hosts.
const hostDependencies = [
  new tools.Steve(),
  new tools.RancherDashboard(),
  new MobyOpenAPISpec(),
];

function downloadDependencies(context: DownloadContext, dependencies: Dependency[]): Promise<void[]> {
  return Promise.all(
    dependencies.map(dependency => dependency.download(context)),
  );
}

async function runScripts(): Promise<void> {
  // load desired versions of dependencies
  const depVersions = await readDependencyVersions(path.join('src', 'assets', 'dependencies.yaml'));
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
