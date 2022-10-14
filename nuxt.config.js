/**
 * This root-level nuxt.config manages configuration for @rancher/shell and
 * supports Rancher Extensions development.
 */
import config from '@rancher/shell/nuxt.config';

export default config(__dirname, {
  excludes:   [],
  autoImport: [],
});
