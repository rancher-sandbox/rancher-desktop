import fs from 'fs';
import os from 'os';
import path from 'path';

import * as goUtils from 'scripts/dependencies/go-source';
import { Lima, LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import { ExtensionProxyImage, WSLDistroImage } from 'scripts/dependencies/tar-archives';
import * as tools from 'scripts/dependencies/tools';
import { Wix } from 'scripts/dependencies/wix';
import {
  WSLDistro, HostResolverHost, HostResolverPeer, HostSwitch, Moproxy,
} from 'scripts/dependencies/wsl';
import {
  DependencyPlatform, DependencyVersions, readDependencyVersions, DownloadContext, Dependency,
} from 'scripts/lib/dependencies';
import { simpleSpawn } from 'scripts/simple_process';

type DependencyWithContext = {
  dependency: Dependency;
  context: DownloadContext;
};

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
  new tools.SpinCLI(),
  new goUtils.RDCtl(),
  new goUtils.GoDependency('docker-credential-none'),
];

// Dependencies that are specific to unix hosts.
const unixDependencies = [
  new Lima(),
  new LimaAndQemu(),
  new AlpineLimaISO(),
];

// Dependencies that are specific to windows hosts.
const windowsDependencies = [
  new WSLDistro(),
  new WSLDistroImage(),
  new HostResolverHost(),
  new Wix(),
  new HostSwitch(),
  new goUtils.GoDependency('vtunnel', 'internal'),
  new goUtils.GoDependency('privileged-service', 'internal'),
  new goUtils.WSLHelper(),
  new goUtils.NerdctlStub(),
];

// Dependencies that are specific to WSL.
const wslDependencies = [
  new HostResolverPeer(),
  new Moproxy(),
  new goUtils.GoDependency('vtunnel', 'internal'),
  new goUtils.RDCtl(),
  new goUtils.GoDependency('guestagent', 'staging'),
  new goUtils.WSLHelper(),
  new goUtils.NerdctlStub(),
];

// Dependencies that are specific to WSL and Lima VMs.
const vmDependencies = [
  new tools.Trivy(),
  new tools.WasmShims(),
  new tools.CertManager(),
  new tools.SpinOperator(),
  new goUtils.GoDependency('extension-proxy', { outputPath: 'staging', env: { CGO_ENABLED: '0' } }),
  new ExtensionProxyImage(),
];

// Dependencies that are specific to hosts.
const hostDependencies = [
  new tools.Steve(),
  new tools.RancherDashboard(),
  new MobyOpenAPISpec(),
];

async function downloadDependencies(items: DependencyWithContext[]): Promise<void[]> {
  function specialize(item: DependencyWithContext) {
    return `${ item.dependency.name }:${ item.context.platform }`;
  }
  // Dependencies might depend on other dependencies.  Note that we may have
  // multiple dependencies of the same name, but different platforms; therefore,
  // all dependencies are keyed by <name>:<platform>.
  const dependenciesByName = Object.fromEntries(items.map(item => [specialize(item), item]));
  const forwardDependencies = Object.fromEntries(items.map(item => [specialize(item), [] as string[]] as const));
  const reverseDependencies = Object.fromEntries(items.map(item => [specialize(item), [] as string[]] as const));
  const all = new Set(Object.keys(dependenciesByName));
  const running = new Set<string>();
  const done = new Set<string>();
  const promises: Promise<void>[] = [];

  for (const item of items) {
    const dependencies = item.dependency.dependencies?.(item.context) ?? [];

    forwardDependencies[specialize(item)].push(...dependencies);
    for (const dependency of dependencies) {
      if (dependency in reverseDependencies) {
        reverseDependencies[dependency].push(specialize(item));
      } else {
        throw new Error(`Dependency ${ item.dependency.name } depends on unknown dependency ${ dependency }`);
      }
    }
  }
  async function process(name: string) {
    running.add(name);
    const item = dependenciesByName[name];

    await item.dependency.download(item.context);
    done.add(name);
    for (const dependent of reverseDependencies[name]) {
      if (!running.has(dependent)) {
        if (forwardDependencies[dependent].every(d => done.has(d))) {
          promises.push(process(dependent));
        }
      }
    }
  }

  for (const item of items.filter(d => (d.dependency.dependencies?.(d.context) ?? []).length === 0)) {
    promises.push(process(specialize(item)));
  }

  while (running.size > done.size) {
    await Promise.all(promises);
  }

  if (all.size > done.size) {
    const remaining = Array.from(all).filter(d => !done.has(d)).sort();
    const message = [`${ remaining.length } dependencies are stuck:`];

    for (const key of remaining) {
      const deps = forwardDependencies[key].filter(d => !done.has(d));

      message.push(`    ${ key } depends on ${ deps }`);
    }
    throw new Error(message.join('\n'));
  }

  return await Promise.all(promises);
}

async function runScripts(): Promise<void> {
  // load desired versions of dependencies
  const depVersions = await readDependencyVersions(path.join('pkg', 'rancher-desktop', 'assets', 'dependencies.yaml'));
  const platform = os.platform();
  const dependencies: DependencyWithContext[] = [];

  if (platform === 'linux' || platform === 'darwin') {
    // download things that go on unix host
    const hostDownloadContext = buildDownloadContextFor(platform, depVersions);

    for (const dependency of [...userTouchedDependencies, ...unixDependencies, ...hostDependencies]) {
      dependencies.push({ dependency, context: hostDownloadContext });
    }

    // download things that go inside Lima VM
    const vmDownloadContext = buildDownloadContextFor('linux', depVersions);

    dependencies.push(...vmDependencies.map(dependency => ({ dependency, context: vmDownloadContext })));
  } else if (platform === 'win32') {
    // download things for windows
    const hostDownloadContext = buildDownloadContextFor('win32', depVersions);

    for (const dependency of [...userTouchedDependencies, ...windowsDependencies, ...hostDependencies]) {
      dependencies.push({ dependency, context: hostDownloadContext });
    }

    // download things that go inside WSL distro
    const vmDownloadContext = buildDownloadContextFor('wsl', depVersions);

    for (const dependency of [...userTouchedDependencies, ...wslDependencies, ...vmDependencies]) {
      dependencies.push({ dependency, context: vmDownloadContext });
    }
  }

  await downloadDependencies(dependencies);
}

function buildDownloadContextFor(rawPlatform: DependencyPlatform, depVersions: DependencyVersions): DownloadContext {
  const platform = rawPlatform === 'wsl' ? 'linux' : rawPlatform;
  const resourcesDir = path.join(process.cwd(), 'resources');
  const downloadContext: DownloadContext = {
    versions:           depVersions,
    dependencyPlatform: rawPlatform,
    platform,
    goPlatform:         platform === 'win32' ? 'windows' : platform,
    isM1:               !!process.env.M1,
    resourcesDir,
    binDir:             path.join(resourcesDir, platform, 'bin'),
    internalDir:        path.join(resourcesDir, platform, 'internal'),
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
    await simpleSpawn('node',
      ['node_modules/electron-builder/out/cli/cli.js', 'install-app-deps']);
    exitCode = 0;
  } catch (e: any) {
    console.error('POSTINSTALL ERROR: ', e);
  } finally {
    clearTimeout(keepScriptAlive);
    process.exit(exitCode);
  }
})();
