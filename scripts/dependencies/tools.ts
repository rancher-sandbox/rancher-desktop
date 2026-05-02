import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  DownloadContext,
  downloadAndHash,
  fetchUpstreamChecksums,
  getPublishedReleaseTagNames,
  GitHubDependency,
  GlobalDependency,
  lookupChecksum,
  Sha256Checksum,
} from '@/scripts/lib/dependencies';
import {
  ArchiveDownloadOptions,
  download,
  downloadTarGZ,
  downloadZip,
} from '@/scripts/lib/download';
import { simpleSpawn } from '@/scripts/simple_process';

function exeName(context: DownloadContext, name: string) {
  const onWindows = context.platform === 'win32';

  return `${ name }${ onWindows ? '.exe' : '' }`;
}

function cartesian<A extends string, B extends string>(
  as: readonly A[],
  bs: readonly B[],
): [A, B][] {
  return as.flatMap(a => bs.map<[A, B]>(b => [a, b]));
}

export class KuberlrAndKubectl extends GlobalDependency(GitHubDependency) {
  readonly name = 'kuberlr';
  readonly githubOwner = 'flavio';
  readonly githubRepo = 'kuberlr';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const kuberlrPath = await this.downloadKuberlr(context, context.dependencies.kuberlr.version, arch);

    await this.bindKubectlToKuberlr(kuberlrPath, path.join(context.binDir, exeName(context, 'kubectl')));
  }

  async downloadKuberlr(context: DownloadContext, version: string, arch: 'amd64' | 'arm64'): Promise<string> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const platformDir = `kuberlr_${ version }_${ context.goPlatform }_${ arch }`;
    const archiveName = platformDir + (context.goPlatform.startsWith('win') ? '.zip' : '.tar.gz');
    const expectedChecksum = lookupChecksum(context, this.name, archiveName);
    const binName = exeName(context, 'kuberlr');
    const options: ArchiveDownloadOptions = {
      expectedChecksum,
      entryName: `${ platformDir }/${ binName }`,
    };
    const downloadFunc = context.platform.startsWith('win') ? downloadZip : downloadTarGZ;

    return await downloadFunc(`${ baseURL }/${ archiveName }`, path.join(context.binDir, binName), options);
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/checksums.txt`, 'sha256');
    const platforms = cartesian(['linux', 'darwin', 'windows'], ['amd64', 'arm64']);

    return Object.fromEntries(await Promise.all(platforms.map(async([goPlatform, arch]) => {
      const archiveName = `kuberlr_${ version }_${ goPlatform }_${ arch }` + (goPlatform === 'windows' ? '.zip' : '.tar.gz');
      const checksum = await downloadAndHash(`${ baseURL }/${ archiveName }`, {
        verify: { algorithm: 'sha256', expected: upstream[archiveName] },
      });

      return [archiveName, checksum];
    })));
  }

  /**
   * Desired: on Windows, .../bin/kubectl.exe is a copy of .../bin/kuberlr.exe
   *          elsewhere: .../bin/kubectl is a symlink to .../bin/kuberlr
   */
  async bindKubectlToKuberlr(kuberlrPath: string, binKubectlPath: string): Promise<void> {
    if (os.platform().startsWith('win')) {
      await fs.promises.copyFile(kuberlrPath, binKubectlPath);

      return;
    }
    try {
      const binKubectlStat = await fs.promises.lstat(binKubectlPath);

      if (binKubectlStat.isSymbolicLink()) {
        const actualTarget = await fs.promises.readlink(binKubectlPath);

        if (actualTarget === 'kuberlr') {
          // The link is already there
          return;
        } else {
          console.log(`Deleting symlink ${ binKubectlPath } unexpectedly pointing to ${ actualTarget }`);
        }
      }
      await fs.promises.rm(binKubectlPath);
    } catch (_) {
      // .../bin/kubectl doesn't exist, so there's nothing to clean up
    }
    await fs.promises.symlink('kuberlr', binKubectlPath);
  }
}

export class Helm extends GlobalDependency(GitHubDependency) {
  readonly name = 'helm';
  readonly githubOwner = 'helm';
  readonly githubRepo = 'helm';

  async download(context: DownloadContext): Promise<void> {
    // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const archiveName = `helm-v${ context.dependencies.helm.version }-${ context.goPlatform }-${ arch }.tar.gz`;
    const helmURL = `https://get.helm.sh/${ archiveName }`;

    await downloadTarGZ(helmURL, path.join(context.binDir, exeName(context, 'helm')), {
      expectedChecksum: lookupChecksum(context, this.name, archiveName),
      entryName:        `${ context.goPlatform }-${ arch }/${ exeName(context, 'helm') }`,
    });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const platforms = cartesian(['linux', 'darwin', 'windows'], ['amd64', 'arm64']);

    return Object.fromEntries(await Promise.all(platforms.map(async([goPlatform, arch]) => {
      const archiveName = `helm-v${ version }-${ goPlatform }-${ arch }.tar.gz`;
      const url = `https://get.helm.sh/${ archiveName }`;
      // Helm publishes a sidecar `.sha256sum` per artifact, one line of `<hex>  <filename>`.
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha256sum`, 'sha256');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: sidecar[archiveName] },
      });

      return [archiveName, checksum];
    })));
  }
}

export class DockerCLI extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerCLI';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-docker-cli';

  async download(context: DownloadContext): Promise<void> {
    const dockerPlatform = context.dependencyPlatform === 'wsl' ? 'wsl' : context.goPlatform;
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.dependencies.dockerCLI.version }`;
    const executableName = exeName(context, `docker-${ dockerPlatform }-${ arch }`);
    const dockerURL = `${ baseURL }/${ executableName }`;
    const destPath = path.join(context.binDir, exeName(context, 'docker'));
    const expectedChecksum = lookupChecksum(context, this.name, executableName);
    const codesign = process.platform === 'darwin';

    await download(dockerURL, destPath, { expectedChecksum, codesign });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/sha256sum.txt`, 'sha256');
    const platforms = cartesian(['linux', 'wsl', 'darwin', 'windows'], ['amd64', 'arm64']);

    return Object.fromEntries(await Promise.all(platforms.map(async([dockerPlatform, arch]) => {
      const executableName = `docker-${ dockerPlatform }-${ arch }` + (dockerPlatform === 'windows' ? '.exe' : '');
      const checksum = await downloadAndHash(`${ baseURL }/${ executableName }`, {
        verify: { algorithm: 'sha256', expected: upstream[executableName] },
      });

      return [executableName, checksum];
    })));
  }
}

export class DockerBuildx extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerBuildx';
  readonly githubOwner = 'docker';
  readonly githubRepo = 'buildx';

  async download(context: DownloadContext): Promise<void> {
    // Download the Docker-Buildx Plug-In
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.dependencies.dockerBuildx.version }`;
    const executableName = exeName(context, `buildx-v${ context.dependencies.dockerBuildx.version }.${ context.goPlatform }-${ arch }`);
    const dockerBuildxURL = `${ baseURL }/${ executableName }`;
    const dockerBuildxPath = path.join(context.dockerPluginsDir, exeName(context, 'docker-buildx'));
    const expectedChecksum = lookupChecksum(context, this.name, executableName);

    await download(dockerBuildxURL, dockerBuildxPath, { expectedChecksum });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    // Upstream checksums.txt omits darwin entries
    // (https://github.com/docker/buildx/issues/945), so we hash darwin without
    // upstream verification.
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/checksums.txt`, 'sha256');
    const platforms = cartesian(['linux', 'darwin', 'windows'], ['amd64', 'arm64']);

    return Object.fromEntries(await Promise.all(platforms.map(async([goPlatform, arch]) => {
      const executableName = `buildx-v${ version }.${ goPlatform }-${ arch }` + (goPlatform === 'windows' ? '.exe' : '');
      const url = `${ baseURL }/${ executableName }`;
      const verify = goPlatform === 'darwin' ? undefined : { algorithm: 'sha256' as const, expected: upstream[executableName] };
      const checksum = await downloadAndHash(url, verify ? { verify } : undefined);

      return [executableName, checksum];
    })));
  }
}

export class DockerCompose extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerCompose';
  readonly githubOwner = 'docker';
  readonly githubRepo = 'compose';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.dependencies.dockerCompose.version }`;
    const arch = context.isM1 ? 'aarch64' : 'x86_64';
    const executableName = exeName(context, `docker-compose-${ context.goPlatform }-${ arch }`);
    const url = `${ baseUrl }/${ executableName }`;
    const destPath = path.join(context.dockerPluginsDir, exeName(context, 'docker-compose'));
    const expectedChecksum = lookupChecksum(context, this.name, executableName);

    await download(url, destPath, { expectedChecksum });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const platforms = cartesian(['linux', 'darwin', 'windows'], ['x86_64', 'aarch64']);

    return Object.fromEntries(await Promise.all(platforms.map(async([goPlatform, arch]) => {
      const executableName = `docker-compose-${ goPlatform }-${ arch }` + (goPlatform === 'windows' ? '.exe' : '');
      const url = `${ baseUrl }/${ executableName }`;
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha256`, 'sha256');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: sidecar[executableName] },
      });

      return [executableName, checksum];
    })));
  }
}

export class GoLangCILint extends GlobalDependency(GitHubDependency) {
  readonly name = 'golangci-lint';
  readonly githubOwner = 'golangci';
  readonly githubRepo = 'golangci-lint';

  download(context: DownloadContext): Promise<void> {
    // We don't actually download anything; when we invoke the linter, we just
    // use `go run` with the appropriate package.
    return Promise.resolve();
  }

  getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    return Promise.resolve({});
  }
}

export class CheckSpelling extends GlobalDependency(GitHubDependency) {
  readonly name = 'check-spelling';
  readonly githubOwner = 'check-spelling';
  readonly githubRepo = 'check-spelling';

  download(context: DownloadContext): Promise<void> {
    // We don't download anything there; `scripts/spelling.sh` does the cloning.
    return Promise.resolve();
  }

  getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    return Promise.resolve({});
  }
}

export class Trivy extends GlobalDependency(GitHubDependency) {
  readonly name = 'trivy';
  readonly githubOwner = 'aquasecurity';
  readonly githubRepo = 'trivy';

  async download(context: DownloadContext): Promise<void> {
    // Download Trivy
    // Always run this in the VM, so download the *LINUX* version into internalDir
    // and move it over to the wsl/lima partition at runtime.
    // Sample URLs:
    // https://github.com/aquasecurity/trivy/releases/download/v0.18.3/trivy_0.18.3_checksums.txt
    // https://github.com/aquasecurity/trivy/releases/download/v0.18.3/trivy_0.18.3_macOS-64bit.tar.gz

    const versionWithV = `v${ context.dependencies.trivy.version }`;
    const trivyURLBase = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases`;
    const trivyOS = context.isM1 ? 'Linux-ARM64' : 'Linux-64bit';
    const archiveName = `trivy_${ context.dependencies.trivy.version }_${ trivyOS }.tar.gz`;
    const trivyURL = `${ trivyURLBase }/download/${ versionWithV }/${ archiveName }`;
    const trivySHA = lookupChecksum(context, this.name, archiveName);
    const trivyDir = context.dependencyPlatform === 'wsl' ? 'staging' : 'internal';
    const trivyPath = path.join(context.resourcesDir, 'linux', trivyDir, 'trivy');

    // trivy.tgz files are top-level tarballs - not wrapped in a labelled directory :(
    await downloadTarGZ(trivyURL, trivyPath, { expectedChecksum: trivySHA });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const versionWithV = `v${ version }`;
    const trivyURLBase = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases`;
    const checksumURL = `${ trivyURLBase }/download/${ versionWithV }/trivy_${ version }_checksums.txt`;
    const upstream = await fetchUpstreamChecksums(checksumURL, 'sha256');
    const archLabels = ['Linux-64bit', 'Linux-ARM64'];

    return Object.fromEntries(await Promise.all(archLabels.map(async(archLabel) => {
      const archiveName = `trivy_${ version }_${ archLabel }.tar.gz`;
      const checksum = await downloadAndHash(`${ trivyURLBase }/download/${ versionWithV }/${ archiveName }`, {
        verify: { algorithm: 'sha256', expected: upstream[archiveName] },
      });

      return [archiveName, checksum];
    })));
  }
}

export class Steve extends GlobalDependency(GitHubDependency) {
  readonly name = 'steve';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-steve';
  readonly releaseFilter = 'published-pre';

  async download(context: DownloadContext): Promise<void> {
    const steveURLBase = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.dependencies.steve.version }`;
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const archiveName = `steve-${ context.goPlatform }-${ arch }.tar.gz`;
    const steveURL = `${ steveURLBase }/${ archiveName }`;
    const stevePath = path.join(context.internalDir, exeName(context, 'steve'));
    const steveSHA = lookupChecksum(context, this.name, archiveName);

    await downloadTarGZ(
      steveURL,
      stevePath,
      {
        expectedChecksum: steveSHA,
      });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const steveURLBase = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const platforms: [string, string][] = [
      ['linux', 'amd64'], ['linux', 'arm64'],
      ['darwin', 'amd64'], ['darwin', 'arm64'],
      ['windows', 'amd64'],
    ];

    return Object.fromEntries(await Promise.all(platforms.map(async([goPlatform, arch]) => {
      const archiveName = `steve-${ goPlatform }-${ arch }.tar.gz`;
      const url = `${ steveURLBase }/${ archiveName }`;
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha512sum`, 'sha512');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha512', expected: sidecar[archiveName] },
      });

      return [archiveName, checksum];
    })));
  }
}

export class RancherDashboard extends GlobalDependency(GitHubDependency) {
  readonly name = 'rancherDashboard';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-dashboard';
  readonly releaseFilter = 'custom';

  async download(context: DownloadContext): Promise<void> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/desktop-v${ context.dependencies.rancherDashboard.version }`;
    const archiveName = 'rancher-dashboard-desktop-embed.tar.gz';
    const url = `${ baseURL }/${ archiveName }`;
    const destPath = path.join(context.resourcesDir, 'rancher-dashboard.tgz');
    const expectedChecksum = lookupChecksum(context, this.name, archiveName);
    const rancherDashboardDir = path.join(context.resourcesDir, 'rancher-dashboard');
    // Stamp records the manifest digest of the archive that produced the
    // extracted directory.  Re-extract unless the stamp matches.  A crash
    // between mkdir and tar leaves the stamp absent, so the next run
    // starts over.
    const stampPath = path.join(rancherDashboardDir, '.source-sha256');
    const stamp = await fs.promises.readFile(stampPath, 'utf-8').catch(() => '');

    if (stamp === expectedChecksum) {
      console.log(`${ rancherDashboardDir } already extracted with expected checksum, not re-downloading.`);

      return;
    }

    await fs.promises.rm(rancherDashboardDir, { recursive: true, force: true, maxRetries: 10 });
    await download(
      url,
      destPath,
      {
        expectedChecksum,
        access: fs.constants.W_OK,
      });

    await fs.promises.mkdir(rancherDashboardDir, { recursive: true });

    const args = ['tar', '-xf', destPath];

    if (os.platform().startsWith('win')) {
      // On Windows, force use the bundled bsdtar.
      // We may find GNU tar on the path, which looks at the Windows-style path
      // and considers C:\Temp to be a reference to a remote host named `C`.
      const systemRoot = process.env.SystemRoot;

      if (!systemRoot) {
        throw new Error('Could not find system root');
      }
      args[0] = path.join(systemRoot, 'system32', 'tar.exe');
    }

    console.log('Extracting rancher dashboard...');
    await simpleSpawn(args[0], args.slice(1), {
      cwd:   rancherDashboardDir,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    await fs.promises.writeFile(stampPath, expectedChecksum, { encoding: 'utf-8' });
    await fs.promises.rm(destPath, { recursive: true, maxRetries: 10 });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/desktop-v${ version }`;
    const archiveName = 'rancher-dashboard-desktop-embed.tar.gz';
    const url = `${ baseURL }/${ archiveName }`;
    const sidecar = await fetchUpstreamChecksums(`${ url }.sha512sum`, 'sha512');

    return {
      [archiveName]: await downloadAndHash(url, {
        verify: { algorithm: 'sha512', expected: sidecar[archiveName] },
      }),
    };
  }

  async getAvailableVersions(): Promise<string[]> {
    const tagNames = await getPublishedReleaseTagNames(this.githubOwner, this.githubRepo, 'published');

    return tagNames.map((tagName: string) => tagName.replace(/^desktop-v/, ''));
  }

  versionToTagName(version: string): string {
    return `desktop-v${ version }`;
  }
}

export class DockerProvidedCredHelpers extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerProvidedCredentialHelpers';
  readonly githubOwner = 'docker';
  readonly githubRepo = 'docker-credential-helpers';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const version = context.dependencies.dockerProvidedCredentialHelpers.version;
    const credHelperNames = {
      linux:  ['docker-credential-secretservice', 'docker-credential-pass'],
      darwin: ['docker-credential-osxkeychain'],
      win32:  ['docker-credential-wincred'],
    }[context.platform];
    const promises = [];
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;

    for (const baseName of credHelperNames) {
      const fullBaseName = `${ baseName }-v${ version }.${ context.goPlatform }-${ arch }`;
      const fullBinName = context.platform.startsWith('win') ? `${ fullBaseName }.exe` : fullBaseName;
      const sourceURL = `${ baseURL }/${ fullBinName }`;
      const expectedChecksum = lookupChecksum(context, this.name, fullBinName);
      const binName = context.platform.startsWith('win') ? `${ baseName }.exe` : baseName;
      const destPath = path.join(context.binDir, binName);
      // starting with the 0.7.0 the upstream releases have a broken ad-hoc signature
      const codesign = context.platform === 'darwin';

      promises.push(download(sourceURL, destPath, { expectedChecksum, codesign } ));
    }

    await Promise.all(promises);
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/checksums.txt`, 'sha256');
    const matrix: { goPlatform: string, arch: string, baseName: string, isWindows: boolean }[] = [];
    const credHelperNames: Record<string, string[]> = {
      linux:   ['docker-credential-secretservice', 'docker-credential-pass'],
      darwin:  ['docker-credential-osxkeychain'],
      windows: ['docker-credential-wincred'],
    };

    for (const [goPlatform, names] of Object.entries(credHelperNames)) {
      for (const arch of ['amd64', 'arm64']) {
        for (const baseName of names) {
          matrix.push({ goPlatform, arch, baseName, isWindows: goPlatform === 'windows' });
        }
      }
    }

    return Object.fromEntries(await Promise.all(matrix.map(async({ goPlatform, arch, baseName, isWindows }) => {
      const fullBaseName = `${ baseName }-v${ version }.${ goPlatform }-${ arch }`;
      const fullBinName = isWindows ? `${ fullBaseName }.exe` : fullBaseName;
      const checksum = await downloadAndHash(`${ baseURL }/${ fullBinName }`, {
        verify: { algorithm: 'sha256', expected: upstream[fullBinName] },
      });

      return [fullBinName, checksum];
    })));
  }
}

export class ECRCredHelper extends GlobalDependency(GitHubDependency) {
  readonly name = 'ECRCredentialHelper';
  readonly githubOwner = 'awslabs';
  readonly githubRepo = 'amazon-ecr-credential-helper';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const ecrLoginPlatform = context.platform.startsWith('win') ? 'windows' : context.platform;
    const baseName = 'docker-credential-ecr-login';
    const baseUrl = 'https://amazon-ecr-credential-helper-releases.s3.us-east-2.amazonaws.com';
    const binName = exeName(context, baseName);
    const sourceUrl = `${ baseUrl }/${ context.dependencies.ECRCredentialHelper.version }/${ ecrLoginPlatform }-${ arch }/${ binName }`;
    const destPath = path.join(context.binDir, binName);
    const expectedChecksum = lookupChecksum(context, this.name, `${ ecrLoginPlatform }-${ arch }/${ binName }`);

    return await download(sourceUrl, destPath, { expectedChecksum });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseName = 'docker-credential-ecr-login';
    const baseUrl = 'https://amazon-ecr-credential-helper-releases.s3.us-east-2.amazonaws.com';
    const platforms = cartesian(['linux', 'darwin', 'windows'], ['amd64', 'arm64']);

    return Object.fromEntries(await Promise.all(platforms.map(async([ecrLoginPlatform, arch]) => {
      const binName = ecrLoginPlatform === 'windows' ? `${ baseName }.exe` : baseName;
      const key = `${ ecrLoginPlatform }-${ arch }/${ binName }`;
      const url = `${ baseUrl }/${ version }/${ key }`;
      // Upstream publishes a per-binary `<bin>.sha256` sidecar in GNU format,
      // indexed by the bare binary name without the platform-prefixed path.
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha256`, 'sha256');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: sidecar[binName] },
      });

      return [key, checksum];
    })));
  }
}

export class WasmShims extends GlobalDependency(GitHubDependency) {
  readonly name = 'spinShim';
  readonly githubOwner = 'spinframework';
  readonly githubRepo = 'containerd-shim-spin';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'aarch64' : 'x86_64';
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.dependencies.spinShim.version }`;
    const filename = `containerd-shim-spin-v2-linux-${ arch }.tar.gz`;
    const url = `${ base }/${ filename }`;
    const destPath = path.join(context.resourcesDir, 'linux', 'internal', 'containerd-shim-spin-v2');

    await downloadTarGZ(url, destPath, { expectedChecksum: lookupChecksum(context, this.name, filename) });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const architectures = ['x86_64', 'aarch64'];

    // Upstream does not publish a checksum file, so we record the sha256 we
    // observe at bump time.
    return Object.fromEntries(await Promise.all(architectures.map(async(arch) => {
      const filename = `containerd-shim-spin-v2-linux-${ arch }.tar.gz`;
      const checksum = await downloadAndHash(`${ base }/${ filename }`);

      return [filename, checksum];
    })));
  }
}

export class CertManager extends GlobalDependency(GitHubDependency) {
  readonly name = 'certManager';
  readonly githubOwner = 'cert-manager';
  readonly githubRepo = 'cert-manager';

  async download(context: DownloadContext): Promise<void> {
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.dependencies.certManager.version }`;
    const crdsFilename = 'cert-manager.crds.yaml';

    await download(`${ base }/${ crdsFilename }`, path.join(context.resourcesDir, crdsFilename), {
      expectedChecksum: lookupChecksum(context, this.name, crdsFilename),
    });

    const chartFilename = `cert-manager-v${ context.dependencies.certManager.version }.tgz`;
    const chartURL = `https://charts.jetstack.io/charts/${ chartFilename }`;

    await download(chartURL, path.join(context.resourcesDir, 'cert-manager.tgz'), {
      expectedChecksum: lookupChecksum(context, this.name, chartFilename),
    });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    // Upstream does not publish a checksum file, so we record the sha256 we
    // observe at bump time.
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const crdsFilename = 'cert-manager.crds.yaml';
    const chartFilename = `cert-manager-v${ version }.tgz`;
    const [crdsHash, chartHash] = await Promise.all([
      downloadAndHash(`${ base }/${ crdsFilename }`),
      downloadAndHash(`https://charts.jetstack.io/charts/${ chartFilename }`),
    ]);

    return {
      [crdsFilename]:  crdsHash,
      [chartFilename]: chartHash,
    };
  }
}

export class SpinOperator extends GlobalDependency(GitHubDependency) {
  readonly name = 'spinOperator';
  readonly githubOwner = 'spinframework';
  readonly githubRepo = 'spin-operator';

  async download(context: DownloadContext): Promise<void> {
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.dependencies.spinOperator.version }`;
    const crdsFilename = 'spin-operator.crds.yaml';

    await download(`${ base }/${ crdsFilename }`, path.join(context.resourcesDir, crdsFilename), {
      expectedChecksum: lookupChecksum(context, this.name, crdsFilename),
    });

    const chartFilename = `spin-operator-${ context.dependencies.spinOperator.version }.tgz`;

    await download(`${ base }/${ chartFilename }`, path.join(context.resourcesDir, 'spin-operator.tgz'), {
      expectedChecksum: lookupChecksum(context, this.name, chartFilename),
    });
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    // Upstream does not publish a checksum file, so we record the sha256 we
    // observe at bump time.
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const crdsFilename = 'spin-operator.crds.yaml';
    const chartFilename = `spin-operator-${ version }.tgz`;
    const [crdsHash, chartHash] = await Promise.all([
      downloadAndHash(`${ base }/${ crdsFilename }`),
      downloadAndHash(`${ base }/${ chartFilename }`),
    ]);

    return {
      [crdsFilename]:  crdsHash,
      [chartFilename]: chartHash,
    };
  }
}

export class SpinCLI extends GlobalDependency(GitHubDependency) {
  readonly name = 'spinCLI';
  readonly githubOwner = 'spinframework';
  readonly githubRepo = 'spin';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'aarch64' : 'amd64';
    const platform = {
      darwin:  'macos',
      linux:   'static-linux',
      windows: 'windows',
    }[context.goPlatform];
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.dependencies.spinCLI.version }`;
    const archiveName = `spin-v${ context.dependencies.spinCLI.version }-${ platform }-${ arch }${ context.goPlatform.startsWith('win') ? '.zip' : '.tar.gz' }`;
    const expectedChecksum = lookupChecksum(context, this.name, archiveName);
    const entryName = exeName(context, 'spin');
    const options: ArchiveDownloadOptions = { expectedChecksum, entryName };
    const downloadFunc = context.platform.startsWith('win') ? downloadZip : downloadTarGZ;

    await downloadFunc(`${ baseURL }/${ archiveName }`, path.join(context.internalDir, entryName), options);
  }

  async getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/checksums-v${ version }.txt`, 'sha256');
    const platforms: [string, string][] = [
      ['macos', 'amd64'], ['macos', 'aarch64'],
      ['static-linux', 'amd64'], ['static-linux', 'aarch64'],
      ['windows', 'amd64'],
    ];

    return Object.fromEntries(await Promise.all(platforms.map(async([platform, arch]) => {
      const ext = platform === 'windows' ? '.zip' : '.tar.gz';
      const archiveName = `spin-v${ version }-${ platform }-${ arch }${ ext }`;
      const checksum = await downloadAndHash(`${ baseURL }/${ archiveName }`, {
        verify: { algorithm: 'sha256', expected: upstream[archiveName] },
      });

      return [archiveName, checksum];
    })));
  }
}

export class SpinKubePlugin extends GlobalDependency(GitHubDependency) {
  readonly name = 'spinKubePlugin';
  readonly githubOwner = 'spinframework';
  readonly githubRepo = 'spin-plugin-kube';

  download(context: DownloadContext): Promise<void> {
    // We don't download anything there; `resources/setup-spin` does the installation.
    return Promise.resolve();
  }

  getChecksums(version: string): Promise<Record<string, Sha256Checksum>> {
    return Promise.resolve({});
  }
}
