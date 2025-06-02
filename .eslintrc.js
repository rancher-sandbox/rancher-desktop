module.exports = {
  root: true,
  env:  {
    browser: true,
    node:    true,
    jest:    true,
  },
  parser:        'vue-eslint-parser',
  parserOptions: {
    parser:     'babel-eslint',
    sourceType: 'module',
  },
  extends: [
    'standard',
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
    'plugin:vue/recommended',
  ],
  // add your custom rules here
  rules: {
    'dot-notation':             'off',
    'generator-star-spacing':   'off',
    'guard-for-in':             'off',
    'linebreak-style':          'off',
    'new-cap':                  'off',
    'no-empty':                 'off',
    'no-extra-boolean-cast':    'off',
    'no-new':                   'off',
    'no-plusplus':              'off',
    'no-useless-escape':        'off',
    'semi-spacing':             'off',
    'space-in-parens':          'off',
    strict:                     'off',
    'unicorn/no-new-buffer':    'off',
    'vue/html-self-closing':    'off',
    'vue/no-unused-components': 'warn',
    'vue/no-v-html':            'off',
    'wrap-iife':                'off',

    'array-bracket-spacing':         'warn',
    'arrow-parens':                  'warn',
    'arrow-spacing':                 ['warn', { before: true, after: true }],
    'block-spacing':                 ['warn', 'always'],
    'brace-style':                   ['warn', '1tbs'],
    'comma-dangle':                  ['warn', 'always-multiline'],
    'comma-spacing':                 'warn',
    curly:                           'warn',
    eqeqeq:                          'warn',
    'func-call-spacing':             ['warn', 'never'],
    'implicit-arrow-linebreak':      'warn',
    indent:                          ['warn', 2],
    'keyword-spacing':               'warn',
    'lines-between-class-members':   ['warn', 'always', { exceptAfterSingleLine: true }],
    'multiline-ternary':             ['warn', 'never'],
    'newline-per-chained-call':      ['warn', { ignoreChainWithDepth: 4 }],
    'no-caller':                     'warn',
    'no-cond-assign':                ['warn', 'except-parens'],
    'no-console':                    'warn',
    'no-debugger':                   'warn',
    'no-eq-null':                    'warn',
    'no-eval':                       'warn',
    'no-trailing-spaces':            'warn',
    'no-undef':                      'warn',
    'no-unused-vars':                'warn',
    'no-whitespace-before-property': 'warn',
    'object-curly-spacing':          ['warn', 'always'],
    'object-property-newline':       'warn',
    'object-shorthand':              'warn',
    'padded-blocks':                 ['warn', 'never'],
    'prefer-arrow-callback':         'warn',
    'prefer-template':               'warn',
    'quote-props':                   'warn',
    'rest-spread-spacing':           'warn',
    semi:                            ['warn', 'always'],
    'space-before-function-paren':   ['warn', 'never'],
    'space-infix-ops':               'warn',
    'spaced-comment':                'warn',
    'switch-colon-spacing':          'warn',
    'template-curly-spacing':        ['warn', 'always'],
    'yield-star-spacing':            ['warn', 'both'],

    'key-spacing': ['warn', {
      align: {
        beforeColon: false,
        afterColon:  true,
        on:          'value',
        mode:        'minimum',
      },
      multiLine: {
        beforeColon: false,
        afterColon:  true,
      },
    }],

    'object-curly-newline': ['warn', {
      ObjectExpression: {
        multiline:     true,
        minProperties: 3,
      },
      ObjectPattern: {
        multiline:     true,
        minProperties: 4,
      },
      ImportDeclaration: {
        multiline:     true,
        minProperties: 5,
      },
      ExportDeclaration: {
        multiline:     true,
        minProperties: 3,
      },
    }],

    'padding-line-between-statements': [
      'warn',
      {
        blankLine: 'always',
        prev:      '*',
        next:      'return',
      },
      {
        blankLine: 'always',
        prev:      'function',
        next:      'function',
      },
      // This configuration would require blank lines after every sequence of variable declarations
      {
        blankLine: 'always',
        prev:      ['const', 'let', 'var'],
        next:      '*',
      },
      {
        blankLine: 'any',
        prev:      ['const', 'let', 'var'],
        next:      ['const', 'let', 'var'],
      },
    ],

    quotes: [
      'warn',
      'single',
      {
        avoidEscape:           true,
        allowTemplateLiterals: true,
      },
    ],

    'space-unary-ops': [
      'warn',
      {
        words:    true,
        nonwords: false,
      },
    ],
  },
};

// Desktop additions
Object.assign(module.exports.parserOptions, {
  parser:              '@typescript-eslint/parser',
  project:             ['./tsconfig.json', './pkg/rancher-desktop/tsconfig.json'],
  extraFileExtensions: ['.vue', '.mjs'],
});
module.exports.plugins = ['@typescript-eslint', 'deprecation', 'unicorn', 'vue'];

Object.assign(module.exports.rules, {
  // Allow console.log &c.
  'no-console':                   'off',
  // Allow throw with non-error
  'no-throw-literal':             'off',
  // Allow rejection with non-error
  'prefer-promise-reject-errors': 'off',

  // These rules aren't enabled in dashboard (probably due to version differences
  // of the linter presets).
  'array-callback-return':                'off',
  'vue/component-definition-name-casing': 'off',

  // Disable the normal no-unused-vars, because it doesn't deal with TypeScript
  // correctly (it marks exported enums); there's a TypeScript version,
  // '@typescript-eslint/no-unused-vars', that is enabled by
  // plugin:@typescript-eslint/recommended.
  'no-unused-vars': 'off',

  // Disallow calling deprecated things.
  'deprecation/deprecation': 'error',

  // Enforce import order.
  'import/order': ['error', {
    alphabetize:        { order: 'asc' },
    groups:             ['builtin', 'external', ['parent', 'sibling', 'index'], 'internal', 'object', 'type'],
    'newlines-between': 'always',
    pathGroups:         [
      {
        pattern: '@pkg/**',
        group:   'internal',
      },
    ],
  }],

  // Existing code only follows a subset of settings for no-unused-vars.
  '@typescript-eslint/no-unused-vars': ['warn', {
    args: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_.',
  }],

  // Disable TypeScript rules that our code doesn't follow (yet).
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  '@typescript-eslint/no-var-requires':                'off',
  '@typescript-eslint/no-this-alias':                  'off',
  '@typescript-eslint/no-empty-function':              'off',
  // Allow using `any` in TypeScript, until the whole project is converted.
  '@typescript-eslint/no-explicit-any':                'off',

  // This setting came in with eslint-plugin-vue 8.x, default on, and is complaining
  // about single-word capitalized names like `Banner`.
  'vue/multi-word-component-names': 'off',

  // TypeScript rules that are in plugin:@typescript-eslint/recommended-requiring-type-checking
  // There's currently too many violations to turn all of it on at once.
  '@typescript-eslint/await-thenable': 'error',

  // Report missing semi-colons in non-js files
  '@typescript-eslint/semi': 'warn',

  // These next three directives are needed to ensure the disable-directives for them are actually used
  'import/first':                    'error',
  'valid-typeof':                    'error',
  '@typescript-eslint/no-namespace': 'error',

  // Rules from nuxt
  'arrow-parens':                           ['error', 'as-needed', { requireForBlockBody: true }],
  curly:                                    ['error', 'all'],
  'generator-star-spacing':                 'off',
  'import/no-mutable-exports':              'error',
  'import/no-unresolved':                   'off',
  'object-shorthand':                       'error',
  'no-lonely-if':                           'error',
  'no-useless-rename':                      'error',
  'no-var':                                 'error',
  'require-await':                          'error',
  'unicorn/error-message':                  'error',
  'unicorn/escape-case':                    'error',
  'unicorn/no-array-instanceof':            'error',
  'unicorn/no-new-buffer':                  'error',
  'unicorn/no-unsafe-regex':                'off',
  'unicorn/number-literal-case':            'error',
  'unicorn/prefer-exponentiation-operator': 'error',
  'unicorn/prefer-includes':                'error',
  'unicorn/prefer-starts-ends-with':        'error',
  'unicorn/prefer-text-content':            'error',
  'unicorn/prefer-type-error':              'error',
  'unicorn/throw-new-error':                'error',
  'vue/no-parsing-error':                   ['error', { 'x-invalid-end-tag': false }],
  'vue/max-attributes-per-line':            ['error', { singleline: 5 }],

  // destructuring: don't error if `a` is reassigned, but `b` is never reassigned
  'prefer-const': ['error', { destructuring: 'all' }],

  // This one assumes all callbacks have errors in the first argument, which isn't likely.
  'n/no-callback-literal': 'off',
});
module.exports.rules['key-spacing'][1].align.mode = 'strict';

module.exports.settings ??= {};
Object.assign(module.exports.settings, {
  'import/parsers':  { '@typescript-eslint/parser': ['.ts', '.tsx'] },
  'import/resolver': {
    node:       { extensions: ['.js', '.mjs'] },
    typescript: {},
  },
});

module.exports.overrides = [
  {
    files: ['*.ts', '*.tsx'],
    rules: {
      // For TypeScript, disable no-undef because the compiler checks it.
      // Also, it is unaware of TypeScript types.
      'no-undef':              'off',
      // For TypeScript, allow duplicate class members (function overloads).
      'no-dupe-class-members': 'off',
      // For TypeScript, allow redeclarations (interface vs class).
      'no-redeclare':          'off',
      // For TypeScript, TS does use-before-define statically.
      'no-use-before-define':  'off',
      // For TypeScript, turn of the base "semi" rule as it conflicts with the
      // TypeScript-specific one (and also TS/no-extra-semi).
      semi:                    'off',
    },
  },
];
