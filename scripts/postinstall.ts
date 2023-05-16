import fs from 'fs';
import os from 'os';
import path from 'path';

import { spawnFile } from '@pkg/utils/childProcess';
import { LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
import { Wix } from 'scripts/dependencies/wix';
import {
  WSLDistro, HostResolverHost, HostResolverPeer, HostSwitch, Moproxy,
} from 'scripts/dependencies/wsl';
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
  new Wix(),
  new HostSwitch(),
];

// Dependencies that are specific to WSL.
const wslDependencies = [
  new HostResolverPeer(),
  new Moproxy(),
  new tools.GuestAgent(),
];

// Dependencies that are specific to WSL and Lima VMs.
const vmDependencies = [
  new tools.Trivy(),
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
  const depVersions = await readDependencyVersions(path.join('pkg', 'rancher-desktop', 'assets', 'dependencies.yaml'));
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

// The main purpose of this setTimeout is to keep the script waiting until the main async function finishes
const keepScriptAlive = setTimeout(() => { }, 24 * 3600 * 1000);

(async() => {
  let exitCode = 2;

  try {
    await runScripts();
    await spawnFile('node',
      ['node_modules/electron-builder/out/cli/cli.js', 'install-app-deps'],
      { stdio: 'inherit' });
    await spawnFile('node', ['scripts/ts-wrapper.js',
      'scripts/generateCliCode.ts',
      'pkg/rancher-desktop/assets/specs/command-api.yaml',
      'src/go/rdctl/pkg/options/generated/options.go'],
    { stdio: 'inherit' });
    exitCode = 0;
  } catch (e: any) {
    console.error('POSTINSTALL ERROR: ', e);
  } finally {
    clearTimeout(keepScriptAlive);
    process.exit(exitCode);
  }
})();
