'use strict';

import * as packageMeta from '../package.json';

const isDevelopment = /^dev/i.test(process.env.NODE_ENV);
const corejsVersion = parseFloat(/\d+\.\d+/.exec(packageMeta.dependencies['core-js']));
const electronVersion = parseInt(/\d+/.exec(packageMeta.devDependencies.electron), 10);

export default {
  build: {
    babel: {
      presets({ isDev }, [preset, options]) {
        (() => { })(isDev, preset); // Disable lint warning about unused variable.
        options.targets = { electron: electronVersion, esmodules: true };
        options.corejs = corejsVersion;
      },
      plugins: [
        ['@babel/plugin-proposal-logical-assignment-operators'],
        ['@babel/plugin-proposal-nullish-coalescing-operator'],
        ['@babel/plugin-proposal-optional-chaining'],
        ['@babel/plugin-proposal-private-methods'],
        ['@babel/plugin-proposal-class-properties'],
      ],
    },
    devtools: isDevelopment,
    extend(webpackConfig) {
      // Override the webpack target, so that we get the correct mix of
      // electron (chrome) + nodejs modules (for ipcRenderer).
      webpackConfig.target = 'electron-renderer';
      // Set a resolver alias for `./@` so that we can load things from @ in CSS
      webpackConfig.resolve.alias['./@'] = __dirname;

      // Add necessary loaders
      webpackConfig.module.rules.push({
        test:    /\.ya?ml(?:\?[a-z0-9=&.]+)?$/,
        loader:  'js-yaml-loader',
        options: { name: '[path][name].[ext]' },
      });
    },
  },
  buildDir:     '../dist/nuxt',
  buildModules: [
    '@nuxtjs/router-extras',
    '@nuxtjs/style-resources',
  ],
  // Global CSS
  css: [
    '@/assets/styles/app.scss',
  ],
  generate:         { devtools: isDevelopment },
  head:             { meta: [{ charset: 'utf-8' }] },
  loading:          false,
  loadingIndicator: false,
  modules:          [
    'cookie-universal-nuxt',
  ],
  plugins:          [
    // Third-party
    { src: '~/plugins/shortkey', ssr: false },

    // First-party
    '~/plugins/i18n',
    { src: '~/plugins/extend-router' },
  ],
  router: {
    mode:          'hash',
    prefetchLinks: false,
    middleware:    ['i18n', 'indexRedirect'],
  },
  ssr:            false,
  styleResources: {
    // only import functions, mixins, or variables, NEVER import full styles https://github.com/nuxt-community/style-resources-module#warning
    scss: [
      '~assets/styles/base/_variables.scss',
      '~assets/styles/base/_functions.scss',
      '~assets/styles/base/_mixins.scss',
    ],
  },
  target:    'static',
  telemetry: false,
};
