// @ts-check
import vm from 'node:vm';

import { TS_EXT_TO_TREAT_AS_ESM, ESM_TS_TRANSFORM_PATTERN } from 'ts-jest';

// Without --experimental-vm-modules the suites compile as CommonJS, and every
// file using top-level await or import.meta fails with a TypeScript error
// naming the module option, which reports as a broken tsconfig rather than a
// missing flag.
if (!vm.SourceTextModule) {
  throw new Error('Run the tests with `yarn test:unit:jest`; jest needs --experimental-vm-modules to load these suites as ES modules.');
}

/** @type {import('jest').Config} */
export default {
  transform: {
    [ESM_TS_TRANSFORM_PATTERN]: ['ts-jest', { useESM: true }],
    '^.+\\.vue$':               './pkg/rancher-desktop/utils/testUtils/vue-jest.js',
  },
  transformIgnorePatterns: [],
  extensionsToTreatAsEsm:  [...TS_EXT_TO_TREAT_AS_ESM, '.vue'],
  moduleFileExtensions:    [
    'js',
    'json',
    'node', // For native modules, e.g. @napi-rs/xattr
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
    '^@/(.*)$':      '<rootDir>/$1',
  },
  setupFiles: [
    '<rootDir>/pkg/rancher-desktop/utils/testUtils/setupVue.ts',
  ],
  testEnvironment:        'jsdom',
  testEnvironmentOptions: {
    customExportConditions: [
      'node',
      'node-addons',
    ],
  },
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/pkg/rancher-desktop/sudo-prompt/',
  ],
};
