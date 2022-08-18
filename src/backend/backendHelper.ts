import merge from 'lodash/merge';

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
}
