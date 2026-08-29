import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    '.next', '.next*', 'node_modules',
    // Régénéré par Next à chaque build — la directive triple-slash n'est pas la nôtre.
    'next-env.d.ts',
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
      // Les règles react-hooks v7 ci-dessous sont les SEULES qui produisent encore
      // des warnings : 23 au total, sur 12 fichiers. Tout le reste du dépôt est à zéro.
      //
      // set-state-in-effect (10) : « init depuis un effet » ou synchronisation d'un
      // objet impératif (scène ExteriorScene, élément <video>, timer d'inactivité).
      // purity (7) et immutability (5) : le modèle R3F / Three.js lui-même —
      // Math.random() pour semer un système de particules, écriture directe dans les
      // Float32Array d'un BufferAttribute, mutation d'un matériau par instance.
      // globals (1) : un drapeau de nettoyage de scène au niveau module.
      //
      // Aucune n'est un bug : les corriger demande de restructurer du code 3D qui
      // marche, ce qui ne se valide qu'à l'œil. Gardées en warn pour rester visibles
      // et migrables plutôt que masquées par des eslint-disable dispersés.
      'react-hooks/set-state-in-effect': 'warn',
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
