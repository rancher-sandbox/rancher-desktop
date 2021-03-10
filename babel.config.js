const packageJson = require('./package.json');

const electronVersion = parseInt(/\d+/.exec(packageJson.devDependencies.electron), 10);

module.exports = {
  presets: [
    ['@babel/preset-env',
      { targets: { electron: electronVersion } }],
  ],
  plugins: [
    '@babel/plugin-proposal-class-properties',
    '@babel/plugin-proposal-logical-assignment-operators',
    '@babel/plugin-proposal-nullish-coalescing-operator',
    '@babel/plugin-proposal-optional-chaining',
    '@babel/plugin-proposal-private-methods',
  ],
};
