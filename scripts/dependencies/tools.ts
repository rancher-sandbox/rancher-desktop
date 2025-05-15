import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  ArchiveDownloadOptions,
  download,
  DownloadOptions,
  downloadTarGZ,
  downloadZip,
  getResource,
} from '../lib/download';

import {
  DownloadContext,
  findChecksum,
  getPublishedReleaseTagNames,
  GitHubDependency,
  GlobalDependency,
} from 'scripts/lib/dependencies';
import { simpleSpawn } from 'scripts/simple_process';

function exeName(context: DownloadContext, name: string) {
  const onWindows = context.platform === 'win32';

  return `${ name }${ onWindows ? '.exe' : '' }`;
}

export class KuberlrAndKubectl extends GlobalDependency(GitHubDependency) {
  readonly name = 'kuberlr';
  readonly githubOwner = 'flavio';
  readonly githubRepo = 'kuberlr';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const kuberlrPath = await this.downloadKuberlr(context, context.versions.kuberlr, arch);

    await this.bindKubectlToKuberlr(kuberlrPath, path.join(context.binDir, exeName(context, 'kubectl')));
  }

  async downloadKuberlr(context: DownloadContext, version: string, arch: 'amd64' | 'arm64'): Promise<string> {
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }`;
    const platformDir = `kuberlr_${ version }_${ context.goPlatform }_${ arch }`;
    const archiveName = platformDir + (context.goPlatform.startsWith('win') ? '.zip' : '.tar.gz');
    const expectedChecksum = await findChecksum(`${ baseURL }/checksums.txt`, archiveName);
    const binName = exeName(context, 'kuberlr');
    const options: ArchiveDownloadOptions = {
      expectedChecksum,
      entryName: `${ platformDir }/${ binName }`,
    };
    const downloadFunc = context.platform.startsWith('win') ? downloadZip : downloadTarGZ;

    return await downloadFunc(`${ baseURL }/${ archiveName }`, path.join(context.binDir, binName), options);
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
    const helmURL = `https://get.helm.sh/helm-v${ context.versions.helm }-${ context.goPlatform }-${ arch }.tar.gz`;

    await downloadTarGZ(helmURL, path.join(context.binDir, exeName(context, 'helm')), {
      expectedChecksum: (await getResource(`${ helmURL }.sha256sum`)).split(/\s+/, 1)[0],
      entryName:        `${ context.goPlatform }-${ arch }/${ exeName(context, 'helm') }`,
    });
  }
}

export class DockerCLI extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerCLI';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-docker-cli';

  async download(context: DownloadContext): Promise<void> {
    const dockerPlatform = context.dependencyPlatform === 'wsl' ? 'wsl' : context.goPlatform;
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.versions.dockerCLI }`;
    const executableName = exeName(context, `docker-${ dockerPlatform }-${ arch }`);
    const dockerURL = `${ baseURL }/${ executableName }`;
    const destPath = path.join(context.binDir, exeName(context, 'docker'));
    const expectedChecksum = await findChecksum(`${ baseURL }/sha256sum.txt`, executableName);
    const codesign = process.platform === 'darwin';

    await download(dockerURL, destPath, { expectedChecksum, codesign });
  }
}

export class DockerBuildx extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerBuildx';
  readonly githubOwner = 'docker';
  readonly githubRepo = 'buildx';

  async download(context: DownloadContext): Promise<void> {
    // Download the Docker-Buildx Plug-In
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.versions.dockerBuildx }`;
    const executableName = exeName(context, `buildx-v${ context.versions.dockerBuildx }.${ context.goPlatform }-${ arch }`);
    const dockerBuildxURL = `${ baseURL }/${ executableName }`;
    const dockerBuildxPath = path.join(context.dockerPluginsDir, exeName(context, 'docker-buildx'));
    const options: DownloadOptions = {};

    // No checksums available on the docker/buildx site for darwin builds
    // https://github.com/docker/buildx/issues/945
    if (context.goPlatform !== 'darwin') {
      options.expectedChecksum = await findChecksum(`${ baseURL }/checksums.txt`, executableName);
    }
    await download(dockerBuildxURL, dockerBuildxPath, options);
  }
}

export class DockerCompose extends GlobalDependency(GitHubDependency) {
  readonly name = 'dockerCompose';
  readonly githubOwner = 'docker';
  readonly githubRepo = 'compose';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.versions.dockerCompose }`;
    const arch = context.isM1 ? 'aarch64' : 'x86_64';
    const executableName = exeName(context, `docker-compose-${ context.goPlatform }-${ arch }`);
    const url = `${ baseUrl }/${ executableName }`;
    const destPath = path.join(context.dockerPluginsDir, exeName(context, 'docker-compose'));
    const expectedChecksum = await findChecksum(`${ url }.sha256`, executableName);

    await download(url, destPath, { expectedChecksum });
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
}

export class CheckSpelling extends GlobalDependency(GitHubDependency) {
  readonly name = 'check-spelling';
  readonly githubOwner = 'check-spelling';
  readonly githubRepo = 'check-spelling';

  download(context: DownloadContext): Promise<void> {
    // We don't download anything there; `scripts/spelling.sh` does the cloning.
    return Promise.resolve();
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

    const versionWithV = `v${ context.versions.trivy }`;
    const trivyURLBase = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases`;
    const trivyOS = context.isM1 ? 'Linux-ARM64' : 'Linux-64bit';
    const trivyBasename = `trivy_${ context.versions.trivy }_${ trivyOS }`;
    const trivyURL = `${ trivyURLBase }/download/${ versionWithV }/${ trivyBasename }.tar.gz`;
    const checksumURL = `${ trivyURLBase }/download/${ versionWithV }/trivy_${ context.versions.trivy }_checksums.txt`;
    const trivySHA = await findChecksum(checksumURL, `${ trivyBasename }.tar.gz`);
    const trivyDir = context.dependencyPlatform === 'wsl' ? 'staging' : 'internal';
    const trivyPath = path.join(context.resourcesDir, 'linux', trivyDir, 'trivy');

    // trivy.tgz files are top-level tarballs - not wrapped in a labelled directory :(
    await downloadTarGZ(trivyURL, trivyPath, { expectedChecksum: trivySHA });
  }
}

export class Steve extends GlobalDependency(GitHubDependency) {
  readonly name = 'steve';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-steve';
  readonly releaseFilter = 'published-pre';

  async download(context: DownloadContext): Promise<void> {
    const steveURLBase = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.versions.steve }`;
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const steveExecutable = `steve-${ context.goPlatform }-${ arch }`;
    const steveURL = `${ steveURLBase }/${ steveExecutable }.tar.gz`;
    const stevePath = path.join(context.internalDir, exeName(context, 'steve'));
    const steveSHA = await findChecksum(`${ steveURL }.sha512sum`, `${ steveExecutable }.tar.gz`);

    await downloadTarGZ(
      steveURL,
      stevePath,
      {
        expectedChecksum:  steveSHA,
        checksumAlgorithm: 'sha512',
      });
  }
}

export class RancherDashboard extends GlobalDependency(GitHubDependency) {
  readonly name = 'rancherDashboard';
  readonly githubOwner = 'rancher-sandbox';
  readonly githubRepo = 'rancher-desktop-dashboard';
  readonly releaseFilter = 'custom';

  async download(context: DownloadContext): Promise<void> {
    const baseURL = `https://github.com/rancher-sandbox/${ this.githubRepo }/releases/download/desktop-v${ context.versions.rancherDashboard }`;
    const executableName = 'rancher-dashboard-desktop-embed';
    const url = `${ baseURL }/${ executableName }.tar.gz`;
    const destPath = path.join(context.resourcesDir, 'rancher-dashboard.tgz');
    const expectedChecksum = await findChecksum(`${ url }.sha512sum`, `${ executableName }.tar.gz`);
    const rancherDashboardDir = path.join(context.resourcesDir, 'rancher-dashboard');

    if (fs.existsSync(rancherDashboardDir)) {
      console.log(`${ rancherDashboardDir } already exists, not re-downloading.`);

      return;
    }

    await download(
      url,
      destPath,
      {
        expectedChecksum,
        checksumAlgorithm: 'sha512',
        access:            fs.constants.W_OK,
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

    await fs.promises.rm(destPath, { recursive: true, maxRetries: 10 });
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
    const version = context.versions.dockerProvidedCredentialHelpers;
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
      const expectedChecksum = await findChecksum(`${ baseURL }/checksums.txt`, fullBinName);
      const binName = context.platform.startsWith('win') ? `${ baseName }.exe` : baseName;
      const destPath = path.join(context.binDir, binName);
      // starting with the 0.7.0 the upstream releases have a broken ad-hoc signature
      const codesign = context.platform === 'darwin';

      promises.push(download(sourceURL, destPath, { expectedChecksum, codesign } ));
    }

    await Promise.all(promises);
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
    const sourceUrl = `${ baseUrl }/${ context.versions.ECRCredentialHelper }/${ ecrLoginPlatform }-${ arch }/${ binName }`;
    const destPath = path.join(context.binDir, binName);

    return await download(sourceUrl, destPath);
  }
}

export class WasmShims extends GlobalDependency(GitHubDependency) {
  readonly name = 'spinShim';
  readonly githubOwner = 'spinframework';
  readonly githubRepo = 'containerd-shim-spin';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'aarch64' : 'x86_64';
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.versions.spinShim }`;
    const url = `${ base }/containerd-shim-spin-v2-linux-${ arch }.tar.gz`;
    const destPath = path.join(context.resourcesDir, 'linux', 'internal', 'containerd-shim-spin-v2');

    await downloadTarGZ(url, destPath);
  }
}

export class CertManager extends GlobalDependency(GitHubDependency) {
  readonly name = 'certManager';
  readonly githubOwner = 'cert-manager';
  readonly githubRepo = 'cert-manager';

  async download(context: DownloadContext): Promise<void> {
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.versions.certManager }`;
    const filename = 'cert-manager.crds.yaml';

    await download(`${ base }/${ filename }`, path.join(context.resourcesDir, filename));

    const url = `https://charts.jetstack.io/charts/cert-manager-v${ context.versions.certManager }.tgz`;

    await download(url, path.join(context.resourcesDir, 'cert-manager.tgz'));
  }
}

export class SpinOperator extends GlobalDependency(GitHubDependency) {
  readonly name = 'spinOperator';
  readonly githubOwner = 'spinframework';
  readonly githubRepo = 'spin-operator';

  async download(context: DownloadContext): Promise<void> {
    const base = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.versions.spinOperator }`;
    let filename = 'spin-operator.crds.yaml';

    await download(`${ base }/${ filename }`, path.join(context.resourcesDir, filename));

    filename = `spin-operator-${ context.versions.spinOperator }.tgz`;
    await download(`${ base }/${ filename }`, path.join(context.resourcesDir, 'spin-operator.tgz'));
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
    const baseURL = `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ context.versions.spinCLI }`;
    const archiveName = `spin-v${ context.versions.spinCLI }-${ platform }-${ arch }${ context.goPlatform.startsWith('win') ? '.zip' : '.tar.gz' }`;
    const expectedChecksum = await findChecksum(`${ baseURL }/checksums-v${ context.versions.spinCLI }.txt`, archiveName);
    const entryName = exeName(context, 'spin');
    const options: ArchiveDownloadOptions = { expectedChecksum, entryName };
    const downloadFunc = context.platform.startsWith('win') ? downloadZip : downloadTarGZ;

    await downloadFunc(`${ baseURL }/${ archiveName }`, path.join(context.internalDir, entryName), options);
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
}
