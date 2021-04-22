const packageJson = require('./package.json');

const electronVersion = parseInt(/\d+/.exec(packageJson.devDependencies.electron), 10);

module.exports = {
  presets: [
    [
      '@babel/preset-env', { targets: { electron: electronVersion } },
      '@babel/preset-typescript',
    ],
  ],
  plugins: [
    '@babel/plugin-proposal-class-properties',
    '@babel/plugin-proposal-nullish-coalescing-operator',
    '@babel/plugin-proposal-optional-chaining',
    '@babel/plugin-proposal-private-methods',
  ],
};
