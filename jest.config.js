export default {
  transform: {
    '^.+\\.js$':  'babel-jest',
    '^.+\\.ts$':  'ts-jest',
    '^.+\\.vue$': '@vue/vue3-jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(yaml|jsonpath-plus|@kubernetes/client-node)/)',
  ],
  moduleFileExtensions: [
    'js',
    'json',
    'node', // For native modules, e.g. fs-xattr
    'ts',
    'vue',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/dist',
    '<rootDir>/pkg/rancher-desktop/dist',
    '<rootDir>/.git',
    '<rootDir>/e2e',
    '<rootDir>/screenshots',
  ],
  moduleNameMapper: {
    '\\.css$':       '<rootDir>/pkg/rancher-desktop/config/emptyStubForJSLinter.js',
    '^@pkg/assets/': '<rootDir>/pkg/rancher-desktop/config/emptyStubForJSLinter.js',
    '^@pkg/(.*)$':   '<rootDir>/pkg/rancher-desktop/$1',
  },
  preset:     'ts-jest/presets/js-with-babel',
  setupFiles: [
    '<rootDir>/pkg/rancher-desktop/utils/testUtils/setupElectron.ts',
  ],
  testEnvironment:        'jsdom',
  testEnvironmentOptions: {
    customExportConditions: [
      'node',
      'node-addons'
    ],
  },
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/pkg/rancher-desktop/sudo-prompt/',
  ],
};
