/**
 * This root-level nuxt.config manages configuration for @rancher/shell and
 * supports Rancher Extensions development.
 */
import path from 'path';

import config from '@rancher/shell/nuxt.config';

const c = config(__dirname, {
  excludes:   [],
  autoImport: [],
});

// Paths to the shell folder when it is included as a node dependency
const SHELL = './node_modules/@rancher/shell';

c.dir = {
  assets:     path.posix.join(SHELL, 'assets'),
  layouts:    path.posix.join(SHELL, 'layouts'),
  middleware: path.posix.join(SHELL, 'middleware'),
  pages:      path.posix.join(SHELL, 'pages'),
  static:     path.posix.join(SHELL, 'static'),
  store:      path.posix.join(SHELL, 'store'),
};

export default c;
