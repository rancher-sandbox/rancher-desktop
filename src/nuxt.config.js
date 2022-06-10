'use strict';

import _ from 'lodash';
import babelConfig from '../babel.config';
import * as packageMeta from '../package.json';

const isDevelopment = /^dev/i.test(process.env.NODE_ENV);
const corejsVersion = parseFloat(/\d+\.\d+/.exec(packageMeta.dependencies['core-js']));
const modifiedBabelConfig = _.cloneDeep(babelConfig);

modifiedBabelConfig.presets.unshift(['@nuxt/babel-preset-app', { corejs: { version: corejsVersion } }]);

export default {
  build: {
    babel:     modifiedBabelConfig,
    devtools:  isDevelopment,
    transpile: ['yaml'],
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
      webpackConfig.module.rules.push({
        test:   /(?:^|[/\\])assets[/\\]scripts[/\\]/,
        loader:  'raw-loader',
      });
    },
  },
  buildDir:     '../dist/nuxt',
  buildModules: [
    '@nuxtjs/router-extras',
    '@nuxtjs/style-resources',
    '@nuxt/typescript-build',
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
    '~/plugins/tooltip',
    '~/plugins/v-select',

    // First-party
    '~/plugins/i18n',
    '~/plugins/directives',
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
    hoistUseStatements: true,
    scss:               [
      '~assets/styles/base/_variables.scss',
      '~assets/styles/base/_functions.scss',
      '~assets/styles/base/_mixins.scss',
    ],
  },
  target:    'static',
  telemetry: false,
};
