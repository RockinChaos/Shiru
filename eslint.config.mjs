import { fixupConfigRules } from '@eslint/compat'
import stylistic from '@stylistic/eslint-plugin'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import js from '@eslint/js'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/build/**',
      '**/dist/**',
      '**/public/**',
      '**/android/**',
      '**/git_modules/**',
      '**/*.min.*',
      '**/*.build.*'
    ]
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error'
    }
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,cjs,mjs}'],
    plugins: {
      '@stylistic': stylistic
    },
    rules: {
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/arrow-spacing': ['error', { before: true, after: true }],
      '@stylistic/block-spacing': ['error', 'always'],
      '@stylistic/comma-spacing': ['error', { before: false, after: true }],
      '@stylistic/computed-property-spacing': ['error', 'never'],
      '@stylistic/keyword-spacing': ['error', { before: true, after: true }],
      '@stylistic/space-before-blocks': ['error', 'always'],
      '@stylistic/space-in-parens': ['error', 'never'],
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/template-curly-spacing': ['error', 'never'],
      'no-duplicate-imports': 'error'
    }
  },
  {
    files: ['**/*.{js,cjs,mjs,svelte}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
        ...globals.serviceworker,
        launchQueue: 'readonly',
        FileSystemHandle: 'readonly',
        FileSystemFileHandle: 'readonly',
        FileSystemDirectoryHandle: 'readonly',
        FileSystemWritableFileStream: 'readonly',
        ClipboardItem: 'readonly',
        queryLocalFonts: 'readonly'
      }
    },
    rules: {
      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'guard-for-in': 'error',
      'no-eval': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-assign': ['error', 'except-parens'],
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unneeded-ternary': ['error', { defaultAssignment: false }],
      'no-unreachable-loop': 'error',
      'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, vars: 'all' }],
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
      'no-var': 'warn',
      'prefer-const': ['error', { destructuring: 'all' }],
      'prefer-promise-reject-errors': 'error',
      'prefer-regex-literals': ['error', { disallowRedundantWrapping: true }]
    }
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs'
    }
  },
  ...fixupConfigRules(svelte.configs['flat/recommended']),
  {
    files: ['**/*.svelte'],
    rules: {
      'no-self-assign': 'off',
      'no-use-before-define': 'off',
      'svelte/button-has-type': 'error',
      'svelte/no-target-blank': 'error'
    }
  }
]