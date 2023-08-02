
import { BackendSettings } from '@pkg/backend/backend';
import { LockedFieldError } from '@pkg/config/commandLineOptions';
import { ContainerEngine, Settings } from '@pkg/config/settings';
import * as settingsImpl from '@pkg/config/settingsImpl';
import SettingsValidator from '@pkg/main/commandServer/settingsValidator';
import Logging from '@pkg/utils/logging';
import { showMessageBox } from '@pkg/window';
import Electron from 'electron';
import merge from 'lodash/merge';
import semver from 'semver';

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
  private static escapeChar(match: any, slashes: string, char: string) {
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
        host = repo.shift() as string;
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
      const match = repo[repo.length - 1].match(/^(?<image>.*?)(:(?<tag>.*?))?(@(?<digest>.*))?$/);
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

  /**
   * k3s versions 1.24.1 to 1.24.3 don't support the --docker option and need to talk to
   * a cri_dockerd endpoint when using the moby engine.
   */
  static requiresCRIDockerd(engineName: string, kubeVersion: string | semver.SemVer): boolean {
    return engineName === ContainerEngine.MOBY && semver.gte(kubeVersion, '1.24.1') && semver.lte(kubeVersion, '1.24.3');
  }

  static checkForLockedVersion(newVersion: semver.SemVer, cfg: BackendSettings, sv: SettingsValidator): void {
    const [, errors] = sv.validateSettings(cfg as Settings, { kubernetes: { version: newVersion.raw } }, settingsImpl.getLockedSettings());

    if (errors.length > 0) {
      if (errors.some(err => err.match(/field ".*" is locked/))) {
        throw new LockedFieldError(`Error in deployment profiles:\n${ errors.join('\n') }`);
      } else {
        throw new Error(`Validation errors for requested version ${ newVersion }: ${ errors.join('\n') }`);
      }
    }
  }

  /**
   * Validate the cfg.kubernetes.version string
   * If it's valid and available, use it.
   * Otherwise fall back to the first (recommended) available version.
   */
  static async getDesiredVersion(cfg: BackendSettings, availableVersions: semver.SemVer[], noModalDialogs: boolean, settingsWriter: (_: any) => void): Promise<semver.SemVer> {
    const currentConfigVersionString = cfg?.kubernetes?.version;
    let storedVersion: semver.SemVer|null;
    let matchedVersion: semver.SemVer|undefined;
    const invalidK8sVersionMainMessage = `Requested kubernetes version '${ currentConfigVersionString }' is not a valid version.`;
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

    sv.k8sVersions = availableVersions.map(v => v.version);
    if (currentConfigVersionString) {
      storedVersion = semver.parse(currentConfigVersionString);
      if (storedVersion) {
        matchedVersion = availableVersions.find((v) => {
          try {
            return v.compare(storedVersion as semver.SemVer) === 0;
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
          this.checkForLockedVersion(matchedVersion, cfg, sv);

          return matchedVersion;
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
      const detail = `Falling back to the most recent stable version of ${ availableVersions[0] }`;

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
    // Because no version was specified, there can't be a locked version field, so no need to call checkForLockedVersion
    settingsWriter({ kubernetes: { version: availableVersions[0].version } });

    return availableVersions[0];
  }
}
