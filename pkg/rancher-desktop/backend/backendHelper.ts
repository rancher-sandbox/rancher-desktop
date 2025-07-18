import path from 'path';

import Electron from 'electron';
import merge from 'lodash/merge';
import semver from 'semver';
import yaml from 'yaml';

import CERT_MANAGER from '@pkg/assets/scripts/cert-manager.yaml';
import INSTALL_CONTAINERD_SHIMS_SCRIPT from '@pkg/assets/scripts/install-containerd-shims';
import CONTAINERD_CONFIG from '@pkg/assets/scripts/k3s-containerd-config.toml';
import SPIN_OPERATOR from '@pkg/assets/scripts/spin-operator.yaml';
import { BackendSettings, VMExecutor } from '@pkg/backend/backend';
import { LockedFieldError } from '@pkg/config/commandLineOptions';
import { ContainerEngine, Settings } from '@pkg/config/settings';
import * as settingsImpl from '@pkg/config/settingsImpl';
import SettingsValidator from '@pkg/main/commandServer/settingsValidator';
import { minimumUpgradeVersion, SemanticVersionEntry } from '@pkg/utils/kubeVersions';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { jsonStringifyWithWhiteSpace } from '@pkg/utils/stringify';
import { showMessageBox } from '@pkg/window';

const CONTAINERD_CONFIG_TOML = '/etc/containerd/config.toml';
const DOCKER_DAEMON_JSON = '/etc/docker/daemon.json';

const MANIFEST_DIR = '/var/lib/rancher/k3s/server/manifests';

// Manifests are applied in sort order, so use a prefix to load them last, in the required sequence.
// Names should start with `z` followed by a digit, so that `install-k3s` cleans them up on restart.
export const MANIFEST_RUNTIMES = 'z100-runtimes';
export const MANIFEST_CERT_MANAGER_CRDS = 'z110-cert-manager.crds';
export const MANIFEST_CERT_MANAGER = 'z115-cert-manager';
export const MANIFEST_SPIN_OPERATOR_CRDS = 'z120-spin-operator.crds';
export const MANIFEST_SPIN_OPERATOR = 'z125-spin-operator';

const STATIC_DIR = '/var/lib/rancher/k3s/server/static/rancher-desktop';
const STATIC_CERT_MANAGER_CHART = `${ STATIC_DIR }/cert-manager.tgz`;
const STATIC_SPIN_OPERATOR_CHART = `${ STATIC_DIR }/spin-operator.tgz`;

const console = Logging.kube;

export default class BackendHelper {
  /**
   * Workaround for upstream error https://github.com/containerd/nerdctl/issues/1308
   * Nerdctl client (version 0.22.0 +) wants a populated auths field when credsStore gives credentials.
   * Note that we don't have to actually provide credentials in the value part of the `auths` field.
   * The code currently wants to see a `ServerURL` that matches the well-known docker hub registry URL,
   * even though it isn't needed, because at that point the code knows it's using the well-known registry.
   */
  static ensureDockerAuth(existingConfig: Record<string, any>): Record<string, any> {
    return merge({ auths: { 'https://index.docker.io/v1/': {} } }, existingConfig);
  }

  /**
   * Replacer function for string.replaceAll(/(\\*)(")/g, this.escapeChar)
   * It will backslash-escape the specified character unless it is already
   * preceded by an odd number of backslashes.
   */
  private static escapeChar(_: any, slashes: string, char: string) {
    if (slashes.length % 2 === 0) {
      slashes += '\\';
    }

    return `${ slashes }${ char }`;
  }

  /**
   * Turn allowedImages patterns into a list of nginx regex rules.
   */
  static createAllowedImageListConf(allowedImages: BackendSettings['containerEngine']['allowedImages']): string {
    /**
     * The image allow list config file consists of one line for each pattern using nginx pattern matching syntax.
     * It starts with '~*' for case-insensitive matching, followed by a regular expression, which should be
     * anchored to the beginning and end of the string with '^...$'. The pattern must be followed by ' 0;' and
     * a newline. The '0' means that this pattern is **not** forbidden (the table defaults to '1').
     */

    // TODO: remove hard-coded defaultSandboxImage from cri-dockerd
    let patterns = '"~*^registry\\.k8s\\.io(:443)?/v2/pause/manifests/[^/]+$" 0;\n';

    // TODO: remove hardcoded CDN redirect target for registry.k8s.io
    patterns += '"~*^[^./]+\\.pkg\\.dev(:443)?/v2/.+/manifests/[^/]+$" 0;\n';

    // TODO: remove hard-coded sandbox_image from our /etc/containerd/config.toml
    patterns += '"~*^registry-1\\.docker\\.io(:443)?/v2/rancher/mirrored-pause/manifests/[^/]+$" 0;\n';

    for (const pattern of allowedImages.patterns) {
      let host = 'registry-1.docker.io';
      // escape all unescaped double-quotes because the final pattern will be quoted to avoid nginx syntax errors
      let repo = pattern.replaceAll(/(\\*)(")/g, this.escapeChar).split('/');

      // no special cases for 'localhost' and 'host-without-dot:port'; they won't work within the VM
      if (repo[0].includes('.')) {
        host = repo.shift()!;
        if (host === 'docker.io') {
          host = 'registry-1.docker.io';
          // 'docker.io/busybox' means 'registry-1.docker.io/library/busybox'
          if (repo.length === 1) {
            repo.unshift('library');
          }
        }
        // registry without repo is the same as 'registry//'
        if (repo.length === 0) {
          repo = ['', ''];
        }
      } else if (repo.length < 2) {
        repo.unshift('library');
      }

      // all dots in the host name are literal dots, but don't escape them if they are already escaped
      host = host.replaceAll(/(\\*)(\.)/g, this.escapeChar);
      // matching against http_host header, which may or may not include the port
      if (!host.includes(':')) {
        host += '(:443)?';
      }

      // match for "image:tag@digest" (tag and digest are both optional)
      const match = /^(?<image>.*?)(:(?<tag>.*?))?(@(?<digest>.*))?$/.exec(repo[repo.length - 1]);
      let tag = '[^/]+';

      // Strip tag and digest from last fragment of the image name.
      // `match` and `match.groups` can't be `null` because the regular expression will match the empty string,
      // but TypeScript can't know that.
      if (match?.groups?.tag || match?.groups?.digest) {
        repo.pop();
        repo.push(match.groups.image);
        // actual tag is ignored when a digest is specified
        tag = match.groups.digest || match.groups.tag;
      }

      // special wildcard rules: 'foo//' means 'foo/.+' and 'foo/' means 'foo/[^/]+'
      if (repo[repo.length - 1] === '') {
        repo.pop();
        if (repo.length > 0 && repo[repo.length - 1] === '') {
          repo.pop();
          repo.push('.+');
        } else {
          repo.push('[^/]+');
        }
      }
      patterns += `"~*^${ host }/v2/${ repo.join('/') }/manifests/${ tag }$" 0;\n`;
    }

    return patterns;
  }

  static requiresCRIDockerd(engineName: string, kubeVersion: string | semver.SemVer): boolean {
    if (engineName !== ContainerEngine.MOBY) {
      return false;
    }
    const ranges = [
      // versions 1.24.1 to 1.24.3 don't support the --docker option
      '1.24.1 - 1.24.3',
      // cri-dockerd bundled with k3s is not compatible with docker 25.x (using API 1.44)
      // see https://github.com/k3s-io/k3s/issues/9279
      '1.26.8 - 1.26.13',
      '1.27.5 - 1.27.10',
      '1.28.0 - 1.28.6',
      '1.29.0 - 1.29.1',
    ];

    return semver.satisfies(kubeVersion, ranges.join('||'));
  }

  static checkForLockedVersion(newVersion: semver.SemVer, cfg: BackendSettings, sv: SettingsValidator): void {
    const [, errors] = sv.validateSettings(cfg as Settings, { kubernetes: { version: newVersion.raw } }, settingsImpl.getLockedSettings());

    if (errors.length > 0) {
      if (errors.some(err => /field ".*" is locked/.exec(err))) {
        throw new LockedFieldError(`Error in deployment profiles:\n${ errors.join('\n') }`);
      } else {
        throw new Error(`Validation errors for requested version ${ newVersion }: ${ errors.join('\n') }`);
      }
    }
  }

  /**
   * Validate the cfg.kubernetes.version string
   * If it's valid and available, use it.
   * Otherwise fall back to the minimum upgrade version (highest patch release of lowest available version).
   */
  static async getDesiredVersion(cfg: BackendSettings, availableVersions: SemanticVersionEntry[], noModalDialogs: boolean, settingsWriter: (_: any) => void): Promise<semver.SemVer> {
    const currentConfigVersionString = cfg?.kubernetes?.version;
    let storedVersion: semver.SemVer | null;
    let matchedVersion: SemanticVersionEntry | undefined;
    const invalidK8sVersionMainMessage = `Requested kubernetes version '${ currentConfigVersionString }' is not a supported version.`;
    const sv = new SettingsValidator();
    const lockedSettings = settingsImpl.getLockedSettings();
    const versionIsLocked = lockedSettings.kubernetes?.version ?? false;

    // If we're here either there's no existing cfg.k8s.version, or it isn't valid
    if (!availableVersions.length) {
      if (currentConfigVersionString) {
        console.log(invalidK8sVersionMainMessage);
      } else {
        console.log('Internal error: no available kubernetes versions found.');
      }
      throw new Error('No kubernetes version available.');
    }

    const upgradeVersion = minimumUpgradeVersion(availableVersions);

    if (!upgradeVersion) {
      // This should never be reached, as `availableVersions` isn't empty.
      throw new Error('Failed to find upgrade version.');
    }

    sv.k8sVersions = availableVersions.map(v => v.version.version);
    if (currentConfigVersionString) {
      storedVersion = semver.parse(currentConfigVersionString);
      if (storedVersion) {
        matchedVersion = availableVersions.find((v) => {
          try {
            return semver.eq(v.version, storedVersion!);
          } catch (err: any) {
            console.error(`Can't compare versions ${ storedVersion } and ${ v }: `, err);
            if (!(err instanceof TypeError)) {
              return false;
            }
            // We haven't seen a non-TypeError exception here, but it would be worthwhile to have it reported.
            // This throw will cause the exception to appear in a non-fatal error reporting dialog box.
            throw err;
          }
        });
        if (matchedVersion) {
          // This throws a LockedFieldError if it fails.
          this.checkForLockedVersion(matchedVersion.version, cfg, sv);

          return matchedVersion.version;
        } else if (versionIsLocked) {
          // This is a bit subtle. If we're here, the user specified a nonexistent version in the locked manifest.
          // We can't switch to the default version, so throw a fatal error.
          throw new LockedFieldError(`Locked kubernetes version ${ currentConfigVersionString } isn't available.`);
        }
      } else if (versionIsLocked) {
        // If we're here, the user specified a non-version in the locked manifest.
        // We can't switch to the default version, so throw a fatal error.
        throw new LockedFieldError(`Locked kubernetes version '${ currentConfigVersionString }' isn't a valid version.`);
      }
      const message = invalidK8sVersionMainMessage;
      const detail = `Falling back to recommended minimum upgrade version of ${ upgradeVersion.version.version }`;

      if (noModalDialogs) {
        console.log(`${ message } ${ detail }`);
      } else {
        const options: Electron.MessageBoxOptions = {
          message,
          detail,
          type:    'warning',
          buttons: ['OK'],
          title:   'Invalid Kubernetes Version',
        };

        await showMessageBox(options, true);
      }
    }
    // No (valid) stored version; save the default one.
    // Because no version was specified, there can't be a locked version field, so no need to call checkForLockedVersion.
    settingsWriter({ kubernetes: { version: upgradeVersion.version.version } });

    return upgradeVersion.version;
  }

  /**
   * Return a dictionary of all containerd shims installed in /usr/local/bin.
   * Keys are the shim names and values are the filenames.
   */
  static async containerdShims(vmx: VMExecutor): Promise<Record<string, string>> {
    const shims: Record<string, string> = {};

    try {
      const files = await vmx.execCommand({ capture: true }, '/bin/ls', '-1', '-p', '/usr/local/bin');

      for (const file of files.split(/\n/)) {
        const match = /^containerd-shim-([-a-z]+)-v\d+$/.exec(file);

        if (match) {
          shims[match[1]] = file;
        }
      }
    } catch (e: any) {
      console.log('containerdShims: Got exception:', e);
      throw e;
    }

    return shims;
  }

  private static manifestFilename(manifest: string): string {
    return `${ MANIFEST_DIR }/${ manifest }.yaml`;
  }

  /**
   * Write a k3s manifest to define a runtime class for each installed containerd shim.
   */
  static async configureRuntimeClasses(vmx: VMExecutor) {
    const runtimes = [];

    for (const shim in await BackendHelper.containerdShims(vmx)) {
      runtimes.push({
        apiVersion: 'node.k8s.io/v1',
        kind:       'RuntimeClass',
        metadata:   { name: shim },
        handler:    shim,
      });
    }

    // Don't let k3s define runtime classes, only use the ones defined by Rancher Desktop.
    await vmx.execCommand({ root: true }, 'touch', `${ MANIFEST_DIR }/runtimes.yaml.skip`);

    if (runtimes.length > 0) {
      const manifest = runtimes.map(r => yaml.stringify(r)).join('---\n');

      await vmx.writeFile(this.manifestFilename(MANIFEST_RUNTIMES), manifest, 0o644);
    }
  }

  /**
   * Write k3s manifests to install cert-manager and spinkube operator
   */
  static async configureSpinOperator(vmx: VMExecutor) {
    await Promise.all([
      vmx.copyFileIn(path.join(paths.resources, 'cert-manager.crds.yaml'), this.manifestFilename(MANIFEST_CERT_MANAGER_CRDS)),
      vmx.copyFileIn(path.join(paths.resources, 'cert-manager.tgz'), STATIC_CERT_MANAGER_CHART),
      vmx.writeFile(this.manifestFilename(MANIFEST_CERT_MANAGER), CERT_MANAGER, 0o644),

      vmx.copyFileIn(path.join(paths.resources, 'spin-operator.crds.yaml'), this.manifestFilename(MANIFEST_SPIN_OPERATOR_CRDS)),
      vmx.copyFileIn(path.join(paths.resources, 'spin-operator.tgz'), STATIC_SPIN_OPERATOR_CHART),
      vmx.writeFile(this.manifestFilename(MANIFEST_SPIN_OPERATOR), SPIN_OPERATOR, 0o644),
    ]);
  }

  /**
   * Install containerd-wasm shims into /usr/local/containerd-shims (and symlinks into /usr/local/bin).
   */
  static async installContainerdShims(vmx: VMExecutor, configureWASM: boolean) {
    // Calling install-containerd-shims without source dirs will remove the symlinks from /usr/local/bin.
    const sourceDirs: string[] = [];

    if (configureWASM) {
      sourceDirs.push(
        // Copy shims bundled with the app itself first, user-managed shims may override.
        path.join(paths.resources, 'linux', 'internal'),
        paths.containerdShims,
      );
    }
    await vmx.execCommand({ root: true }, 'mkdir', '-p', '/root');
    await vmx.writeFile('/root/install-containerd-shims', INSTALL_CONTAINERD_SHIMS_SCRIPT, 'a+x');
    await vmx.execCommand({ root: true }, '/root/install-containerd-shims', ...sourceDirs);
  }

  /**
   * Write the containerd config file. If WASM is enabled, include a runtime definition
   * for each installed containerd shim.
   */
  static async writeContainerdConfig(vmx: VMExecutor, configureWASM: boolean): Promise<void> {
    let config = CONTAINERD_CONFIG;

    if (configureWASM) {
      const shims = await BackendHelper.containerdShims(vmx);

      for (const shim in shims) {
        config += '\n';
        config += `[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.${ shim }]\n`;
        config += `  runtime_type = "/usr/local/bin/${ shims[shim] }"\n`;
      }
    }

    await vmx.writeFile(CONTAINERD_CONFIG_TOML, config);
  }

  /**
   * Configure the Moby containerd-snapshotter feature if WASM support is requested.
   */
  static async writeMobyConfig(vmx: VMExecutor, configureWASM: boolean) {
    let config: Record<string, any>;

    try {
      config = JSON.parse(await vmx.readFile(DOCKER_DAEMON_JSON));
    } catch (err: any) {
      await vmx.execCommand({ root: true }, 'mkdir', '-p', path.dirname(DOCKER_DAEMON_JSON));
      config = {};
    }
    config['features'] ??= {};
    config['features']['containerd-snapshotter'] = configureWASM;
    await vmx.writeFile(DOCKER_DAEMON_JSON, jsonStringifyWithWhiteSpace(config), 0o644);
  }

  static async configureContainerEngine(vmx: VMExecutor, configureWASM: boolean) {
    await BackendHelper.installContainerdShims(vmx, configureWASM);
    await BackendHelper.writeContainerdConfig(vmx, configureWASM);
    await BackendHelper.writeMobyConfig(vmx, configureWASM);
  }
}
