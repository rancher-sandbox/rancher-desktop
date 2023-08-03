const path = require('path');

const _ = require('lodash');
const webpack = require('webpack');

const babelConfig = require('../../babel.config');
const packageMeta = require('../../package.json');

const rootDir = path.resolve(__dirname, '..', '..');
const isDevelopment = /^(?:dev|test)/.test(process.env.NODE_ENV ?? '');
const mode = isDevelopment ? 'development' : 'production';
const corejsVersion = parseFloat(/\d+\.\d+/.exec(packageMeta.dependencies['core-js']));
const modifiedBabelConfig = _.cloneDeep(babelConfig);

modifiedBabelConfig.presets.unshift(['@vue/cli-plugin-babel/preset', { corejs: { version: corejsVersion } }]);

module.exports = {
  publicPath:          '/',
  outputDir:           path.resolve(rootDir, 'dist', 'app'),
  productionSourceMap: false,

  chainWebpack: (config) => {
    config.mode(mode);
    config.target('electron-renderer');
    config.resolve.alias.set('@pkg', path.resolve(rootDir, 'pkg', 'rancher-desktop'));

    config.module.rule('yaml')
      .test(/\.ya?ml(?:\?[a-z0-9=&.]+)?$/)
      .use('js-yaml-loader')
      .loader('js-yaml-loader')
      .options({ name: '[path][name].[ext]' });

    config.module.rule('raw')
      .test(/(?:^|[/\\])assets[/\\]scripts[/\\]/)
      .use('raw-loader')
      .loader('raw-loader');

    config.plugin('define-plugin').use(webpack.DefinePlugin, [{
      'process.client':       JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),

      'nuxt.publicRuntimeConfig': JSON.stringify({
        featureDiagnosticsFixes: process.env.RD_ENV_DIAGNOSTICS_FIXES === '1',
        featureExtensions:       true,
      }),
    }]);
  },

  css: {
    loaderOptions: {
      sass: {
        additionalData: `
          @use 'sass:math';
          @import "@pkg/assets/styles/base/_variables.scss";
          @import "@pkg/assets/styles/base/_functions.scss";
          @import "@pkg/assets/styles/base/_mixins.scss";
        `,
      },
    },
  },

  pluginOptions: {
    i18n: {
      locale:         'en',
      fallbackLocale: 'en',
      localeDir:      'locales',
      enableInSFC:    false,
    },
  },

  transpileDependencies: ['yaml'],

  pages: {
    index: {
      entry:    path.join(__dirname, 'nuxt', 'client.js'),
      template: path.join(__dirname, 'public', 'index.html'),
    },
  },
};
