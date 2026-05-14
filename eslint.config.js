import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    '.next', '.next*', 'node_modules',
    // Sub-projects with their own toolchains — keep them out of the main lint.
    'cinema-stream', 'zone-discord-bot', 'backend-zone-club', 'dist',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Rules tuned for this codebase — keep bug-class strict, downgrade
      // stylistic checks to warnings so `next build` does not fail on them.
      // Hard errors that catch real bugs:
      'react-hooks/rules-of-hooks': 'error',
      // set-state-in-effect flags ~12 legacy useEffect patterns spread
      // across 7 files. Each is a legitimate "init from effect" or
      // "transition handler" — refactoring them all is a multi-file sprint
      // of its own. Kept as warn so they stay visible and migratable.
      'react-hooks/set-state-in-effect': 'warn',
      // The seven react-hooks v7 strict rules below (purity, immutability,
      // refs, preserve-manual-memoization, globals) flag many *intentional*
      // mutations in R3F / Three.js / WebGPU code (e.g. cloning materials
      // per-instance, writing into GPU storage buffers, registering with the
      // module-level animation system). Downgraded to warnings so they stay
      // visible in editor without failing `next build`.
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/globals': 'warn',
      // Stylistic / pragmatic — `next build` should not fail when these fire.
      // Each can still be re-tightened per-file/per-rule later.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // Legacy compatibility — only used in a few WebGPU type declarations.
      '@typescript-eslint/triple-slash-reference': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'prefer-const': 'warn',
    },
  },
])
