import fs from 'fs';
import os from 'os';
import path from 'path';

import { defined } from '@/pkg/rancher-desktop/utils/typeUtils';
import {
  AssetPlatform,
  DependencyAsset,
  DownloadContext,
  downloadAndHash,
  fetchUpstreamChecksums,
  GitHubDependency,
  GlobalDependency,
  GoArch,
  hostArch,
  selectAsset,
  selectAssets,
} from '@/scripts/lib/dependencies';
import {
  ArchiveDownloadOptions,
  download,
  downloadTarGZ,
  downloadZip,
} from '@/scripts/lib/download';

function exeName(context: DownloadContext, name: string) {
  const onWindows = context.platform === 'win32';

  return `${ name }${ onWindows ? '.exe' : '' }`;
}

/** The file name suffix for executable files. */
function exeSuffix(platform: AssetPlatform): string {
  return platform === 'windows' ? '.exe' : '';
}

export function cartesian<A extends string, B extends string>(
  as: readonly A[],
  bs: readonly B[],
): [A, B][] {
  return as.flatMap(a => bs.map<[A, B]>(b => [a, b]));
}

/** The host platforms most dependencies publish for. */
const HOST_PLATFORMS: readonly AssetPlatform[] = ['linux', 'darwin', 'windows'];
const ARCHES: readonly GoArch[] = ['amd64', 'arm64'];

export class KuberlrAndKubectl extends GlobalDependency(GitHubDependency) {
  readonly name = 'kuberlr';
  readonly githubOwner = 'flavio';
  readonly githubRepo = 'kuberlr';

  async download(context: DownloadContext): Promise<void> {
    const version = context.dependencies[this.name].version;
    const asset = selectAsset(context, this.name);
    const platformDir = `kuberlr_${ version }_${ context.goPlatform }_${ hostArch(context) }`;
    const binName = exeName(context, 'kuberlr');
    const options: ArchiveDownloadOptions = {
      expectedChecksum: asset.checksum,
      entryName:        `${ platformDir }/${ binName }`,
    };
    const downloadFunc = context.platform.startsWith('win') ? downloadZip : downloadTarGZ;
    const kuberlrPath = await downloadFunc(asset.url, path.join(context.binDir, binName), options);

    await this.bindKubectlToKuberlr(kuberlrPath, path.join(context.binDir, exeName(context, 'kubectl')));
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/checksums.txt`, 'sha256');

    return Promise.all(cartesian(HOST_PLATFORMS, ARCHES).map(async([platform, arch]) => {
      const archiveName = `kuberlr_${ version }_${ platform }_${ arch }${ platform === 'windows' ? '.zip' : '.tar.gz' }`;
      const url = `${ baseURL }/${ archiveName }`;
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: upstream[archiveName] },
      });

      return { platform, arch, url, checksum };
    }));
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
    const arch = hostArch(context);
    const asset = selectAsset(context, this.name);

    await downloadTarGZ(asset.url, path.join(context.binDir, exeName(context, 'helm')), {
      expectedChecksum: asset.checksum,
      entryName:        `${ context.goPlatform }-${ arch }/${ exeName(context, 'helm') }`,
    });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    return Promise.all(cartesian(HOST_PLATFORMS, ARCHES).map(async([platform, arch]) => {
      const archiveName = `helm-v${ version }-${ platform }-${ arch }.tar.gz`;
      const url = `https://get.helm.sh/${ archiveName }`;
      // Helm publishes a sidecar `.sha256sum` per artifact, one line of `<hex>  <filename>`.
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha256sum`, 'sha256');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: sidecar[archiveName] },
      });

      return { platform, arch, url, checksum };
    }));
  }
}

export class DockerCLI extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerCLI';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-docker-cli';

  async download(context: DownloadContext): Promise<void> {
    const platform: AssetPlatform = context.dependencyPlatform === 'wsl' ? 'wsl' : context.goPlatform;
    const asset = selectAsset(context, this.name, { platform, arch: hostArch(context) });
    const destPath = path.join(context.binDir, exeName(context, 'docker'));
    const codesign = process.platform === 'darwin';

    await download(asset.url, destPath, { expectedChecksum: asset.checksum, codesign });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/sha256sum.txt`, 'sha256');
    const platforms: readonly AssetPlatform[] = ['linux', 'wsl', 'darwin', 'windows'];

    return Promise.all(cartesian(platforms, ARCHES).map(async([platform, arch]) => {
      const executableName = `docker-${ platform }-${ arch }${ exeSuffix(platform) }`;
      const url = `${ baseURL }/${ executableName }`;
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: upstream[executableName] },
      });

      return { platform, arch, url, checksum };
    }));
  }
}

export class DockerBuildx extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerBuildx';
  readonly githubOwner = 'docker';
  readonly githubRepo = 'buildx';

  async download(context: DownloadContext): Promise<void> {
    // Download the Docker-Buildx Plug-In
    const asset = selectAsset(context, this.name);
    const dockerBuildxPath = path.join(context.dockerPluginsDir, exeName(context, 'docker-buildx'));

    await download(asset.url, dockerBuildxPath, { expectedChecksum: asset.checksum });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    // Upstream checksums.txt omits darwin entries
    // (https://github.com/docker/buildx/issues/945), so we hash darwin without
    // upstream verification.
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/checksums.txt`, 'sha256');

    return Promise.all(cartesian(HOST_PLATFORMS, ARCHES).map(async([platform, arch]) => {
      const executableName = `buildx-v${ version }.${ platform }-${ arch }${ exeSuffix(platform) }`;
      const url = `${ baseURL }/${ executableName }`;
      const verify = platform === 'darwin' ? undefined : { algorithm: 'sha256' as const, expected: upstream[executableName] };
      const checksum = await downloadAndHash(url, verify ? { verify } : undefined);

      return { platform, arch, url, checksum };
    }));
  }
}

export class DockerCompose extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerCompose';
  readonly githubOwner = 'docker';
  readonly githubRepo = 'compose';

  /** Upstream names compose artifacts with uname-style architectures. */
  private static readonly upstreamArch: Record<GoArch, string> = { amd64: 'x86_64', arm64: 'aarch64' };

  async download(context: DownloadContext): Promise<void> {
    const asset = selectAsset(context, this.name);
    const destPath = path.join(context.dockerPluginsDir, exeName(context, 'docker-compose'));

    await download(asset.url, destPath, { expectedChecksum: asset.checksum });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;

    return Promise.all(cartesian(HOST_PLATFORMS, ARCHES).map(async([platform, arch]) => {
      const executableName = `docker-compose-${ platform }-${ DockerCompose.upstreamArch[arch] }${ exeSuffix(platform) }`;
      const url = `${ baseUrl }/${ executableName }`;
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha256`, 'sha256');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: sidecar[executableName] },
      });

      return { platform, arch, url, checksum };
    }));
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

  getAssets(version: string): Promise<DependencyAsset[]> {
    return Promise.resolve([]);
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

  getAssets(version: string): Promise<DependencyAsset[]> {
    return Promise.resolve([]);
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

    const asset = selectAsset(context, this.name, { platform: 'linux', arch: hostArch(context) });
    const trivyDir = context.dependencyPlatform === 'wsl' ? 'staging' : 'internal';
    const trivyPath = path.join(context.resourcesDir, 'linux', trivyDir, 'trivy');

    // trivy.tgz files are top-level tarballs - not wrapped in a labelled directory :(
    await downloadTarGZ(asset.url, trivyPath, { expectedChecksum: asset.checksum });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const releasesBase = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ releasesBase }/trivy_${ version }_checksums.txt`, 'sha256');
    // Trivy runs only in the linux guest; upstream labels its arches Linux-64bit / Linux-ARM64.
    const archLabels: Record<GoArch, string> = { amd64: 'Linux-64bit', arm64: 'Linux-ARM64' };

    return Promise.all(ARCHES.map(async(arch) => {
      const archiveName = `trivy_${ version }_${ archLabels[arch] }.tar.gz`;
      const url = `${ releasesBase }/${ archiveName }`;
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: upstream[archiveName] },
      });

      return { platform: 'linux' as const, arch, url, checksum };
    }));
  }
}

export class Steve extends GlobalDependency(GitHubDependency) {
  readonly name = 'steve';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-steve';
  readonly releaseFilter = 'published-pre';

  async download(context: DownloadContext): Promise<void> {
    const asset = selectAsset(context, this.name);
    const stevePath = path.join(context.internalDir, exeName(context, 'steve'));

    await downloadTarGZ(asset.url, stevePath, { expectedChecksum: asset.checksum });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const steveURLBase = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ steveURLBase }/steve.sha512sum`, 'sha512');
    const archiveMatch = /^steve-(linux|darwin|windows)-(amd64|arm64)\.tar\.gz$/;

    return (await Promise.all(Object.keys(upstream).map(async(archiveName) => {
      const match = archiveMatch.exec(archiveName);

      if (!match) {
        return;
      }
      const [, platform, arch] = match as unknown as [string, AssetPlatform, GoArch];
      const url = `${ steveURLBase }/${ archiveName }`;
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha512', expected: upstream[archiveName] },
      });

      return { platform, arch, url, checksum };
    }))).filter(defined);
  }
}

export class DockerProvidedCredHelpers extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerProvidedCredentialHelpers';
  readonly githubOwner = 'docker';
  readonly githubRepo = 'docker-credential-helpers';

  /** The credential helpers published for each platform. */
  private static readonly helperNames: Record<AssetPlatform, string[]> = {
    linux:   ['docker-credential-secretservice', 'docker-credential-pass'],
    darwin:  ['docker-credential-osxkeychain'],
    windows: ['docker-credential-wincred'],
    wsl:     [],
  };

  async download(context: DownloadContext): Promise<void> {
    const version = context.dependencies[this.name].version;
    const arch = hostArch(context);
    const assets = selectAssets(context, this.name);
    const expected = DockerProvidedCredHelpers.helperNames[context.goPlatform];

    // selectAssets() returns [] rather than throwing, so we would silently skip
    // a helper the manifest omits.
    if (assets.length !== expected.length) {
      throw new Error(
        `Expected ${ expected.length } ${ this.name } assets for ` +
        `${ context.goPlatform }/${ arch }, found ${ assets.length }.`,
      );
    }
    // starting with the 0.7.0 the upstream releases have a broken ad-hoc signature
    const codesign = context.platform === 'darwin';

    await Promise.all(assets.map((asset) => {
      const fullBinName = path.basename(new URL(asset.url).pathname);
      const baseName = fullBinName
        .replace(`-v${ version }.${ context.goPlatform }-${ arch }`, '')
        .replace(/\.exe$/, '');
      const destPath = path.join(context.binDir, exeName(context, baseName));

      return download(asset.url, destPath, { expectedChecksum: asset.checksum, codesign });
    }));
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/checksums.txt`, 'sha256');
    const matrix: { platform: AssetPlatform, arch: GoArch, baseName: string }[] = [];

    for (const platform of HOST_PLATFORMS) {
      for (const [baseName, arch] of cartesian(DockerProvidedCredHelpers.helperNames[platform], ARCHES)) {
        matrix.push({ platform, arch, baseName });
      }
    }

    return Promise.all(matrix.map(async({ platform, arch, baseName }) => {
      const fullBinName = `${ baseName }-v${ version }.${ platform }-${ arch }${ exeSuffix(platform) }`;
      const url = `${ baseURL }/${ fullBinName }`;
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: upstream[fullBinName] },
      });

      return { platform, arch, url, checksum };
    }));
  }
}

export class ECRCredHelper extends GlobalDependency(GitHubDependency) {
  readonly name = 'ECRCredentialHelper';
  readonly githubOwner = 'awslabs';
  readonly githubRepo = 'amazon-ecr-credential-helper';

  async download(context: DownloadContext): Promise<void> {
    const asset = selectAsset(context, this.name);
    const destPath = path.join(context.binDir, exeName(context, 'docker-credential-ecr-login'));

    return await download(asset.url, destPath, { expectedChecksum: asset.checksum });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseName = 'docker-credential-ecr-login';
    const baseUrl = 'https://amazon-ecr-credential-helper-releases.s3.us-east-2.amazonaws.com';

    return Promise.all(cartesian(HOST_PLATFORMS, ARCHES).map(async([platform, arch]) => {
      const binName = `${ baseName }${ exeSuffix(platform) }`;
      const url = `${ baseUrl }/${ version }/${ platform }-${ arch }/${ binName }`;
      // Upstream publishes a per-binary `<bin>.sha256` sidecar in GNU format,
      // indexed by the bare binary name without the platform-prefixed path.
      const sidecar = await fetchUpstreamChecksums(`${ url }.sha256`, 'sha256');
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: sidecar[binName] },
      });

      return { platform, arch, url, checksum };
    }));
  }
}

export class WasmShims extends GlobalDependency(GitHubDependency) {
  readonly name = 'spinShim';
  readonly githubOwner = 'spinframework';
  readonly githubRepo = 'containerd-shim-spin';

  async download(context: DownloadContext): Promise<void> {
    const asset = selectAsset(context, this.name, { platform: 'linux', arch: hostArch(context) });
    const destPath = path.join(context.resourcesDir, 'linux', 'internal', 'containerd-shim-spin-v2');

    await downloadTarGZ(asset.url, destPath, { expectedChecksum: asset.checksum });
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    // spinframework labels its linux arches with uname-style names.
    const unameArch: Record<GoArch, string> = { amd64: 'x86_64', arm64: 'aarch64' };

    // Upstream does not publish a checksum file, so we record the sha256 we
    // observe at bump time.
    return Promise.all(ARCHES.map(async(arch) => {
      const url = `${ base }/containerd-shim-spin-v2-linux-${ unameArch[arch] }.tar.gz`;
      const checksum = await downloadAndHash(url);

      return { platform: 'linux' as const, arch, url, checksum };
    }));
  }
}

export class CertManager extends GlobalDependency(GitHubDependency) {
  readonly name = 'certManager';
  readonly githubOwner = 'cert-manager';
  readonly githubRepo = 'cert-manager';

  async download(context: DownloadContext): Promise<void> {
    const fileNames = {
      crds:  'cert-manager.crds.yaml',
      chart: 'cert-manager.tgz',
    };

    await Promise.all(Object.entries(fileNames).map(([variant, fileName]) => {
      const asset = selectAsset(context, this.name, { platform: 'linux', variant });

      return download(asset.url, path.join(context.resourcesDir, fileName), {
        expectedChecksum: asset.checksum,
      });
    }));
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    // The CRDs and chart are platform-independent; they deploy into the linux
    // guest.  Upstream publishes no checksum file, so we record the sha256 we
    // observe at bump time.
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const crdsUrl = `${ base }/cert-manager.crds.yaml`;
    const chartUrl = `https://charts.jetstack.io/charts/cert-manager-v${ version }.tgz`;
    const [crdsChecksum, chartChecksum] = await Promise.all([
      downloadAndHash(crdsUrl),
      downloadAndHash(chartUrl),
    ]);

    return [
      { platform: 'linux', variant: 'crds', url: crdsUrl, checksum: crdsChecksum },
      { platform: 'linux', variant: 'chart', url: chartUrl, checksum: chartChecksum },
    ];
  }
}

export class SpinOperator extends GlobalDependency(GitHubDependency) {
  readonly name = 'spinOperator';
  readonly githubOwner = 'spinframework';
  readonly githubRepo = 'spin-operator';

  async download(context: DownloadContext): Promise<void> {
    const fileNames = {
      crds:  'spin-operator.crds.yaml',
      chart: 'spin-operator.tgz',
    };

    await Promise.all(Object.entries(fileNames).map(([variant, fileName]) => {
      const asset = selectAsset(context, this.name, { platform: 'linux', variant });

      return download(asset.url, path.join(context.resourcesDir, fileName), {
        expectedChecksum: asset.checksum,
      });
    }));
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    // The CRDs and chart are platform-independent; they deploy into the linux
    // guest.  Upstream publishes no checksum file, so we record the sha256 we
    // observe at bump time.
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const crdsUrl = `${ base }/spin-operator.crds.yaml`;
    const chartUrl = `${ base }/spin-operator-${ version }.tgz`;
    const [crdsChecksum, chartChecksum] = await Promise.all([
      downloadAndHash(crdsUrl),
      downloadAndHash(chartUrl),
    ]);

    return [
      { platform: 'linux', variant: 'crds', url: crdsUrl, checksum: crdsChecksum },
      { platform: 'linux', variant: 'chart', url: chartUrl, checksum: chartChecksum },
    ];
  }
}

export class SpinCLI extends GlobalDependency(GitHubDependency) {
  readonly name = 'spinCLI';
  readonly githubOwner = 'spinframework';
  readonly githubRepo = 'spin';

  async download(context: DownloadContext): Promise<void> {
    const asset = selectAsset(context, this.name);
    const entryName = exeName(context, 'spin');
    const options: ArchiveDownloadOptions = { expectedChecksum: asset.checksum, entryName };
    const downloadFunc = context.platform.startsWith('win') ? downloadZip : downloadTarGZ;

    await downloadFunc(asset.url, path.join(context.internalDir, entryName), options);
  }

  async getAssets(version: string): Promise<DependencyAsset[]> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const upstream = await fetchUpstreamChecksums(`${ baseURL }/checksums-v${ version }.txt`, 'sha256');
    // spin labels platforms and arches its own way, and ships no windows/arm64 build.
    const combos: { platform: AssetPlatform, arch: GoArch, spinPlatform: string, spinArch: string }[] = [
      { platform: 'darwin', arch: 'amd64', spinPlatform: 'macos', spinArch: 'amd64' },
      { platform: 'darwin', arch: 'arm64', spinPlatform: 'macos', spinArch: 'aarch64' },
      { platform: 'linux', arch: 'amd64', spinPlatform: 'static-linux', spinArch: 'amd64' },
      { platform: 'linux', arch: 'arm64', spinPlatform: 'static-linux', spinArch: 'aarch64' },
      { platform: 'windows', arch: 'amd64', spinPlatform: 'windows', spinArch: 'amd64' },
    ];

    return Promise.all(combos.map(async({ platform, arch, spinPlatform, spinArch }) => {
      const ext = platform === 'windows' ? '.zip' : '.tar.gz';
      const archiveName = `spin-v${ version }-${ spinPlatform }-${ spinArch }${ ext }`;
      const url = `${ baseURL }/${ archiveName }`;
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: upstream[archiveName] },
      });

      return { platform, arch, url, checksum };
    }));
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

  getAssets(version: string): Promise<DependencyAsset[]> {
    return Promise.resolve([]);
  }
}
