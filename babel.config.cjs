const packageJson = require('./package.json');

const electronVersion = parseInt(/\d+/.exec(packageJson.devDependencies.electron), 10);

module.exports = {
  presets: [
    [
      '@vue/cli-plugin-babel/preset',
      { useBuiltIns: false },
    ],
    [
      '@babel/preset-env',
      {
        targets: {
          node:     'current',
          electron: electronVersion,
        },
      },
    ],
  ],
  env: {
    test: {
      presets: [
        ['@babel/env',
          { targets: { node: 'current' } },
        ],
      ],
    },
  },
  plugins: [
    '@babel/plugin-proposal-class-properties',
    '@babel/plugin-proposal-nullish-coalescing-operator',
    '@babel/plugin-proposal-optional-chaining',
    '@babel/plugin-proposal-private-methods',
    '@babel/plugin-proposal-private-property-in-object',
  ],
};
