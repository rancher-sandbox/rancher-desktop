import merge from 'lodash/merge';

import { BackendSettings } from '~/backend/backend';

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
   * Turn imageAllowList patterns into a list of nginx regex rules.
   */
  static createImageAllowListConf(imageAllowList: BackendSettings['containerEngine']['imageAllowList']): string {
    if (!imageAllowList.enabled) {
      return '~*^.*$ 0;\n';
    }

    // TODO: remove hard-coded defaultSandboxImage from cri-dockerd
    let patterns = '~*^registry.k8s.io(:443)?/pause:[^/]+$ 0;\n';

    // TODO: remove hard-coded sandbox_image from our /etc/containerd/config.toml
    patterns += '~*^registry-1.docker.io(:443)?/rancher/mirrored-pause:[^/]+$ 0;\n';

    for (const pattern of imageAllowList.patterns) {
      let host = 'registry-1.docker.io';
      let repo = pattern.split('/');

      // no special cases for 'localhost' and 'host-without-dot:port'; they won't work within the VM
      if (repo[0].includes('.')) {
        host = repo.shift() as string;
        if (host === 'docker.io') {
          host = 'registry-1.docker.io';
        }
        // registry without repo is the same as 'registry//'
        if (repo.length === 0) {
          repo = ['', ''];
        }
      } else if (repo.length < 2) {
        repo.unshift('library');
      }

      // matching against http_host header, which may or may not include the port
      if (!host.includes(':')) {
        host += '(:443)?';
      }

      // match for "image:tag@digest" (tag and digest are both optional)
      const match = repo[repo.length - 1].match(/^(?<image>.*?)(:(?<tag>.*?))?(@(?<digest>.*))?$/);
      let tag = '[^/]+';

      // strip tag and digest from last fragment of the image name
      // `match` and `match.groups` can't be `null`, but TypeScript doesn't know
      if (match && match.groups && (match.groups.tag || match.groups.digest)) {
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
      patterns += `~*^${ [host, 'v2', ...repo, 'manifests', tag].join('/') }$ 0;\n`;
    }

    return patterns;
  }
}
