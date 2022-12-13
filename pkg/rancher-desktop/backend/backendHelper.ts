import merge from 'lodash/merge';

import { BackendSettings } from '@pkg/backend/backend';

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
   * Replacer function for string.replaceAll(/(\\*)(")/g, this.#escapeChar)
   * It will backslash-escape the specified character unless it is already
   * preceded by an odd number of backslashes.
   */
  static #escapeChar(match: any, slashes: string, char: string) {
    if (slashes.length % 2 === 0) {
      slashes += '\\';
    }

    return `${ slashes }${ char }`;
  }

  /**
   * Turn imageAllowList patterns into a list of nginx regex rules.
   */
  static createImageAllowListConf(imageAllowList: BackendSettings['containerEngine']['imageAllowList']): string {
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

    for (const pattern of imageAllowList.patterns) {
      let host = 'registry-1.docker.io';
      // escape all unescaped double-quotes because the final pattern will be quoted to avoid nginx syntax errors
      let repo = pattern.replaceAll(/(\\*)(")/g, this.#escapeChar).split('/');

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
      host = host.replaceAll(/(\\*)(\.)/g, this.#escapeChar);
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
}
