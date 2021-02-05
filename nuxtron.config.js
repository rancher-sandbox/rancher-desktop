'use strict';

const fs = require('fs');
const path = require('path');
const packageMeta = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json')));
const electronVersion = parseInt(/\d+/.exec(packageMeta.devDependencies.electron), 10);

module.exports = {
  mainSrcDir: '.',
  rendererSrcDir: 'src',
  /**
   * Function to customize the main process webpack configuration.
   * @param {Object} userConfig The webpack configuration to customize.
   * @param {"development" | "production"} env The build configuration.
   */
  webpack: (userConfig, env) => {
    // Enable source map in development builds.
    userConfig.devtool = env === 'development' ? 'source-map' : false;

    // Set up the "@" module resolution.
    userConfig.resolve = userConfig.resolve || {};
    userConfig.resolve.alias = userConfig.resolve.alias || {};
    userConfig.resolve.alias['@'] = path.resolve(__dirname, 'src');

    userConfig.output.path = path.resolve(__dirname, 'app');

    // Fix babel configuration.
    /** @type Array<Object> */
    const rules = userConfig.module.rules;
    const babelConfig = rules.find(r => r.use.loader === 'babel-loader');
    babelConfig.use.options.presets = [
      ['@babel/preset-env', { targets: { electron: electronVersion } }]
    ];
    babelConfig.use.options.plugins = ['@babel/plugin-proposal-private-methods'];
    babelConfig.exclude.push(path.resolve(__dirname, 'dist'));
    return userConfig;
  }
};
