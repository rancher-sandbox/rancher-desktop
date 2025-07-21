import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as goUtils from 'scripts/dependencies/go-source';
import { Lima, Qemu, SocketVMNet, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import { SudoPrompt } from 'scripts/dependencies/sudo-prompt';
import { ExtensionProxyImage, WSLDistroImage } from 'scripts/dependencies/tar-archives';
import * as tools from 'scripts/dependencies/tools';
import { Wix } from 'scripts/dependencies/wix';
import { WSLDistro, Moproxy } from 'scripts/dependencies/wsl';
import {
  DependencyPlatform, DependencyVersions, readDependencyVersions, DownloadContext, Dependency,
} from 'scripts/lib/dependencies';
import { simpleSpawn } from 'scripts/simple_process';

interface DependencyWithContext {
  dependency: Dependency;
  context:    DownloadContext;
}

/**
 * The amount of time we allow the post-install script to run, in milliseconds.
 */
const InstallTimeout = 10 * 60 * 1_000; // Ten minutes.

/**
 * Retrieves the application version from package.json to stamp Go binaries.
 * This version number ensures Go utilities like WSL helpers are tagged with
 * the same version as the main application, maintaining consistency across
 * all components of Rancher Desktop.
 */
const versionToStamp = getStampVersion();

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
  new goUtils.RDCtl(versionToStamp),
  new goUtils.GoDependency('docker-credential-none'),
];

// Dependencies that are specific to unix hosts.
const unixDependencies = [
  new Lima(),
  new Qemu(),
  new AlpineLimaISO(),
];

// Dependencies that are specific to macOS hosts.
const macOSDependencies = [
  new SocketVMNet(),
  new SudoPrompt(),
];

// Dependencies that are specific to windows hosts.
const windowsDependencies = [
  new WSLDistro(),
  new WSLDistroImage(),
  new Wix(),
  new goUtils.GoDependency('networking/cmd/host', 'internal/host-switch'),
  new goUtils.WSLHelper(versionToStamp),
  new goUtils.NerdctlStub(),
  new goUtils.SpinStub(),
];

// Dependencies that are specific to WSL.
const wslDependencies = [
  new Moproxy(),
  new goUtils.RDCtl(versionToStamp),
  new goUtils.GoDependency('guestagent', 'staging'),
  new goUtils.GoDependency('networking/cmd/vm', 'staging/vm-switch'),
  new goUtils.GoDependency('networking/cmd/network', 'staging/network-setup'),
  new goUtils.GoDependency('networking/cmd/proxy', 'staging/wsl-proxy'),
  new goUtils.WSLHelper(versionToStamp),
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

async function downloadDependencies(items: DependencyWithContext[]): Promise<void> {
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
  const promises: Record<string, Promise<void>> = {};

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
          promises[dependent] = process(dependent);
        }
      }
    }
  }

  for (const item of items.filter(d => (d.dependency.dependencies?.(d.context) ?? []).length === 0)) {
    promises[specialize(item)] = process(specialize(item));
  }

  const abortSignal = AbortSignal.timeout(InstallTimeout);

  while (!abortSignal.aborted && running.size > done.size) {
    const timeout = new Promise((resolve) => {
      setTimeout(resolve, 60_000);
      abortSignal.onabort = resolve;
    });
    const pending = Array.from(running).filter(v => !done.has(v));

    await Promise.race([timeout, ...pending.map(v => promises[v])]);
  }
  abortSignal.onabort = null;

  if (all.size > done.size) {
    const remaining = Array.from(all).filter(d => !done.has(d)).sort();
    const message = [`${ remaining.length } dependencies are stuck:`];

    for (const key of remaining) {
      const deps = forwardDependencies[key].filter(d => !done.has(d));
      const depsString = deps.length > 0 ? deps.join(', ') : '(nothing)';
      const started = running.has(key) ? ' (started)' : '';

      message.push(`    ${ key }${ started } depends on ${ depsString }`);
    }
    if (abortSignal.aborted) {
      message.unshift('Timed out downloading dependencies');
    }
    throw new Error(message.join('\n'));
  }
}

async function runScripts(): Promise<void> {
  // load desired versions of dependencies
  const depVersions = await readDependencyVersions(path.join('pkg', 'rancher-desktop', 'assets', 'dependencies.yaml'));
  const platform = os.platform();
  const dependencies: DependencyWithContext[] = [];

  if (platform === 'linux' || platform === 'darwin') {
    // download things that go on unix host
    const hostDownloadContext = await buildDownloadContextFor(platform, depVersions);

    for (const dependency of [...userTouchedDependencies, ...unixDependencies, ...hostDependencies]) {
      dependencies.push({ dependency, context: hostDownloadContext });
    }

    // download things for macOS host
    if (platform === 'darwin') {
      for (const dependency of macOSDependencies) {
        dependencies.push({ dependency, context: hostDownloadContext });
      }
    }

    // download things that go inside Lima VM
    const vmDownloadContext = await buildDownloadContextFor('linux', depVersions);

    dependencies.push(...vmDependencies.map(dependency => ({ dependency, context: vmDownloadContext })));
  } else if (platform === 'win32') {
    // download things for windows
    const hostDownloadContext = await buildDownloadContextFor('win32', depVersions);

    for (const dependency of [...userTouchedDependencies, ...windowsDependencies, ...hostDependencies]) {
      dependencies.push({ dependency, context: hostDownloadContext });
    }

    // download things that go inside WSL distro
    const vmDownloadContext = await buildDownloadContextFor('wsl', depVersions);

    for (const dependency of [...userTouchedDependencies, ...wslDependencies, ...vmDependencies]) {
      dependencies.push({ dependency, context: vmDownloadContext });
    }
  }

  await downloadDependencies(dependencies);
}

async function buildDownloadContextFor(rawPlatform: DependencyPlatform, depVersions: DependencyVersions): Promise<DownloadContext> {
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
    dockerPluginsDir:   path.join(resourcesDir, platform, 'docker-cli-plugins'),
  };

  const dirsToCreate = ['binDir', 'internalDir', 'dockerPluginsDir'] as const;

  await Promise.all(dirsToCreate.map(d => fs.promises.mkdir(downloadContext[d], { recursive: true })));

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

/**
* Gets the version string for Go tools from git.
* Format: {tag}-{commits}-{hash}{dirty}
* Examples: v1.18.0, v1.18.0-39-gf46609959, v1.18.0-39-gf46609959.m
*/
function getStampVersion(): string {
  const gitCommand = 'git describe --match v[0-9]* --dirty=.m --always --tags';
  const stdout = childProcess.execSync(gitCommand, { encoding: 'utf-8' });

  return stdout;
}
