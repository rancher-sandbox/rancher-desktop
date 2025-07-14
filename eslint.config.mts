import path from 'path';

import { includeIgnoreFile } from '@eslint/compat';
import eslint from '@eslint/js';
import { standardTypeChecked } from '@vue/eslint-config-standard-with-typescript';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default defineConfigWithVueTs(
  eslint.configs.recommended,
  pluginVue.configs['flat/recommended'],
  standardTypeChecked.map(entry => {
    // Avoid issues with redefining plugins:
    // `Config "typescript-eslint/base": Key "plugins": Cannot redefine plugin "@typescript-eslint".`
    if (entry.plugins) {
      delete entry.plugins['@typescript-eslint'];
    }
    return entry;
  }),
  vueTsConfigs.recommendedTypeChecked,
  vueTsConfigs.stylisticTypeChecked,
  includeIgnoreFile(path.resolve('.gitignore')),
  {
    name: 'rancher-desktop',
    languageOptions: {
      sourceType: 'commonjs'
    },
    rules: {
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/indent': ['warn', 2, { SwitchCase: 0 }],
      '@stylistic/key-spacing': ['warn', {
        align: {
          beforeColon: false,
          afterColon: true,
          on: 'value',
          mode: 'minimum'
        },
        multiLine: {
          beforeColon: false,
          afterColon: true
        }
      }],
      '@stylistic/no-multi-spaces': ['error', { ignoreEOLComments: true, exceptions: { Property: true, ImportAttribute: true, TSTypeAnnotation: true }}],
      '@stylistic/quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      '@stylistic/semi': ['error', 'always', {
        omitLastInOneLineBlock: true,
        omitLastInOneLineClassBody: true,
      }],
      '@stylistic/space-before-function-paren': ['error', 'never'],
      '@stylistic/space-in-parens': 'off',
      '@stylistic/template-curly-spacing': ['error', 'always'],
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/no-explicit-any': 'off', // We do need `any` sometimes
      '@typescript-eslint/no-unused-vars': ['warn', {
        args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_.'
      }],
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'import-x/order': ['error', {
        alphabetize: { order: 'asc' },
        groups: ['builtin', 'external', ['parent', 'sibling', 'index'], 'internal', 'object', 'type'],
        'newlines-between': 'always',
        pathGroupsExcludedImportTypes: ['builtin', 'object'],
        pathGroups: [
          {
            pattern: '@pkg/**',
            group: 'internal'
          }
        ]
      }],
      'new-cap': 'off',
      // This one assumes all callbacks have errors in the first argument, which isn't likely.
      'n/no-callback-literal': 'off',
      'no-global-assign': ['error', { exceptions: ['console'] }],
    }
  },
  {
    name: 'rancher-desktop-vue',
    files: ['**/*.vue'],
    languageOptions: {
      sourceType: 'module'
    }
  },
  {
    // Disable TypeScript-specific rules in JavaScript files.
    name: 'rancher-desktop-js',
    files: ['**/*.js', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': ['off']
    }
  },
  {
    // Disable lints not needed in tests (mostly global imports).
    name: 'rancher-desktop-spec',
    files: ['**/*.spec.js', '**/*.spec.ts'],
    languageOptions: {
      globals: globals.jest,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'import-x/first': 'off', // Often needed for mocks
    }
  },
  {
    // Files we imported from Rancher Dashboard.
    name: 'rancher-dashboard-imports',
    files: [
      'pkg/rancher-desktop/plugins/*.js',
      'pkg/rancher-desktop/utils/*.js',
    ],
    languageOptions: {
      globals: globals.browser
    },
  },
  {
    // Compatibility: disable lints during the ESLint transition.
    name: 'rancher-desktop-compatibility',
    extends: [
      {
        // Files we imported from Rancher Dashboard.
        name: 'rancher-dashboard-imports',
        files: [
          'pkg/rancher-desktop/components/SortableTable/**',
        ],
        rules: {
          'vue/eqeqeq': 'off',
          'vue/space-infix-ops': 'off',
          'vue/comma-spacing': 'off',
        }
      },
      {
        // Files in workflows were previously excluded from linting
        name: 'rancher-desktop-workflows',
        ignores: ['.github/workflows/**'],
      },
    ],
    rules: {
      '@stylistic/block-spacing': 'off',
      '@stylistic/comma-dangle': 'off',
      '@stylistic/generator-star-spacing': 'off',
      '@stylistic/indent': 'off',
      '@stylistic/key-spacing': 'off',
      '@stylistic/multiline-ternary': 'off',
      '@stylistic/object-curly-newline': 'off',
      '@stylistic/object-curly-spacing': 'off',
      '@stylistic/object-property-newline': 'off',
      '@stylistic/quote-props': 'off',
      '@stylistic/semi-spacing': 'off',
      '@stylistic/space-infix-ops': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/class-literal-property-style': 'off',
      '@typescript-eslint/consistent-generic-constructors': 'off',
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/prefer-find': 'off',
      '@typescript-eslint/prefer-for-of': 'off',
      '@typescript-eslint/prefer-includes': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/prefer-regexp-exec': 'off',
      '@typescript-eslint/prefer-string-starts-ends-with': 'off',
      'array-callback-return': 'off',
      'no-constant-binary-expression': 'off',
      'no-use-before-define': 'off',
      'no-useless-escape': 'off',
      'prefer-rest-params': 'off',
      'prefer-spread': 'off',
      'vue/block-lang': 'off',
      'vue/comma-dangle': 'off',
      'vue/component-definition-name-casing': 'off',
      'vue/html-self-closing': 'off',
      'vue/key-spacing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'off',
      'vue/object-curly-spacing': 'off',
      'vue/object-shorthand': 'off',
      'vue/quote-props': 'off',
      'vue/space-infix-ops': 'off',
      'vue/template-curly-spacing': 'off',
    }
  },
);
