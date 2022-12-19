/**
 * This root-level nuxt.config manages configuration for @rancher/shell and
 * supports Rancher Extensions development.
 */
import path from 'path';

import config from '@rancher/shell/nuxt.config';

// Paths to the shell folder when it is included as a node dependency
const SHELL = './node_modules/@rancher/shell';
const SHELL_ABS = path.join(__dirname, 'node_modules/@rancher/shell');

const c = config(__dirname, {
  excludes:   [],
  autoImport: [],
});

/**
 * c.dir modifications to make use of the posix path allows @rancher/shell to
 * properly build and run on Windows.
 * See https://github.com/rancher/dashboard/pull/7234 for more details.
 */
c.dir = {
  assets:     path.posix.join(SHELL, 'assets'),
  layouts:    path.posix.join(SHELL, 'layouts'),
  middleware: path.posix.join(SHELL, 'middleware'),
  pages:      path.posix.join(SHELL, 'pages'),
  static:     path.posix.join(SHELL, 'static'),
  store:      path.posix.join(SHELL, 'store'),
};

c.build.extend = (config, { isClient, isDev }) => {
  /**
   * BEGIN Rancher Desktop customization to @rancher/shell configuration
   * Override the webpack target, so that we get the correct mix of
   * electron (chrome) + nodejs modules (for ipcRenderer).
   */
  config.target = 'electron-renderer';
  // Set a resolver alias for `./@pkg` so that we can load things from @ in CSS
  config.resolve.alias['./@pkg'] = path.resolve(__dirname, 'pkg', 'rancher-desktop');
  /**
   * END Rancher Desktop customization to @rancher/shell configuration
   */

  /**
   * BEGIN original @rancher/shell configuration
   */
  if ( isDev ) {
    config.devtool = 'cheap-module-source-map';
  } else {
    config.devtool = 'source-map';
  }

  // Remove default image handling rules
  for ( let i = config.module.rules.length - 1 ; i >= 0 ; i-- ) {
    if ( /svg/.test(config.module.rules[i].test) ) {
      config.module.rules.splice(i, 1);
    }
  }

  config.resolve.symlinks = false;

  // Ensure we process files in the @rancher/shell folder
  config.module.rules.forEach((r) => {
    if ('test.js'.match(r.test)) {
      if (r.exclude) {
        const orig = r.exclude;

        r.exclude = function(modulePath) {
          if (modulePath.indexOf(SHELL_ABS) === 0) {
            return false;
          }

          return orig(modulePath);
        };
      }
    }
  });

  // And substitute our own loader for images
  config.module.rules.unshift({
    test: /\.(png|jpe?g|gif|svg|webp)$/,
    use:  [
      {
        loader:  'url-loader',
        options: {
          name:     '[path][name].[ext]',
          limit:    1,
          esModule: false,
        },
      },
    ],
  });

  // Handler for yaml files (used for i18n files, for example)
  config.module.rules.unshift({
    test:    /\.ya?ml$/i,
    loader:  'js-yaml-loader',
    options: { name: '[path][name].[ext]' },
  });

  // Handler for csv files (e.g. ec2 instance data)
  config.module.rules.unshift({
    test:    /\.csv$/i,
    loader:  'csv-loader',
    options: {
      dynamicTyping:  true,
      header:         true,
      skipEmptyLines: true,
    },
  });

  // Ensure there is a fallback for browsers that don't support web workers
  config.module.rules.unshift({
    test:    /web-worker.[a-z-]+.js/i,
    loader:  'worker-loader',
    options: { inline: 'fallback' },
  });

  // Prevent warning in log with the md files in the content folder
  config.module.rules.push({
    test: /\.md$/,
    use:  [
      {
        loader:  'frontmatter-markdown-loader',
        options: { mode: ['body'] },
      },
    ],
  });
  /**
   * END original @rancher/shell configuration
   */
};

export default c;
