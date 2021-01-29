'use strict';

const isDevelopment = /^dev/i.test(process.env.NODE_ENV);

const fs = require('fs');
const path = require('path');
const packageMeta = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json')));
const corejsVersion = parseFloat(/\d+\.\d+/.exec(packageMeta.dependencies["core-js"]));
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
        ["@babel/plugin-proposal-logical-assignment-operators"],
        ["@babel/plugin-proposal-nullish-coalescing-operator"],
        ["@babel/plugin-proposal-optional-chaining"],
        ["@babel/plugin-proposal-private-methods"],
        ["@babel/plugin-proposal-class-properties"],
      ]
    },
    devtools: isDevelopment,
    extend(webpackConfig) {
      // Override the webpack target, so that we get the correct mix of
      // electron (chrome) + nodejs modules (for ipcRenderer).
      webpackConfig.target = "electron-renderer";
      // Set a resolver alias for `./@` so that we can load things from @ in CSS
      webpackConfig.resolve.alias['./@'] = __dirname;
    },
  },
  buildModules: ['@nuxtjs/router-extras'],
  generate: {
    devtools: isDevelopment,
  },
  loading: false,
  loadingIndicator: false,
  router: { mode: 'hash', prefetchLinks: false },
  ssr: false,
  target: "static",
  telemetry: false,
};
