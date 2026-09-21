import js from '@eslint/js'
import globals from 'globals'
import next from '@next/eslint-plugin-next'
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
  // Bloc sans `files:` — uniquement pour que `next build` trouve le plugin.
  // Sa sonde fait un calculateConfigForFile() sur package.json (cf.
  // next/dist/lib/eslint/runLintCheck.js) : un plugin déclaré seulement dans un
  // bloc limité à **/*.{ts,tsx} lui reste invisible, et il avertit alors « The
  // Next.js plugin was not detected ». Même référence d'objet que celle
  // enregistrée par flatConfig.coreWebVitals ci-dessous, donc pas de conflit.
  // Les règles, elles, restent portées par le bloc ts/tsx.
  //
  // Le `rules: {}` n'est PAS décoratif : une fois le plugin détecté, la sonde
  // fait Object.entries(completeConfig.rules) sur ce même calcul. Sans la clé,
  // elle jette « ESLint: Cannot convert undefined or null to object » et le
  // build saute silencieusement tout le lint — zéro warning affiché, zéro
  // vérification faite.
  { plugins: { '@next/next': next.default }, rules: {} },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      // Sans ce plugin, `next build` avertit à chaque fois « The Next.js plugin
      // was not detected in your ESLint configuration ». Il apporte surtout des
      // règles bug-class propres au framework (no-sync-scripts,
      // no-async-client-component, no-document-import-in-page…).
      next.flatConfig.coreWebVitals,
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
      // des warnings : 113 au total, sur 23 fichiers. Tout le reste du dépôt est à zéro.
      //
      // Le compte était de 23 sur 12 fichiers avec eslint-plugin-react-hooks 7.0.1 ;
      // la 7.1.1 détecte les mêmes classes bien plus largement (vérifié cas par cas :
      // aucune catégorie nouvelle, refs et preserve-manual-memoization se mettent
      // simplement à parler). Le gros des hits est concentré sur la 3D —
      // CassetteInstances (17), VHSPlayer (11), VHSCaseOverlay (11), LaZoneCRT (10).
      //
      // immutability (36) et purity (14) : le modèle R3F / Three.js lui-même —
      // Math.random() pour semer un système de particules, écriture directe dans les
      // Float32Array d'un BufferAttribute, mutation d'un matériau par instance.
      // set-state-in-effect (33) : « init depuis un effet » ou synchronisation d'un
      // objet impératif (scène ExteriorScene, élément <video>, timer d'inactivité).
      // refs (23) : lecture d'une ref impérative dans le useMemo qui construit les
      // buffers d'instances — c'est le point d'entrée du GPU, pas du rendu React.
      // preserve-manual-memoization (6), globals (1) : idem, code de scène.
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
      // Les deux règles Next ci-dessous ne s'appliquent pas à ce projet :
      //
      // no-img-element pousse vers next/image. Le dépôt ne l'utilise nulle part
      // (11 <img> natifs) et c'est délibéré : les jaquettes passent par le proxy
      // maison /api/poster (cache disque 30 j) ou finissent en texture WebGPU
      // dans l'atlas de CassetteTextureArray. next/image n'apporterait rien et
      // rallumerait /_next/image, une surface d'attaque qu'on n'a pas besoin
      // d'ouvrir (c'est là qu'était la RCE AVIF de next < 15.5.24).
      '@next/next/no-img-element': 'off',
      // no-page-custom-font raisonne en Pages Router : il veut la police dans
      // pages/_document.js. Le <link> VT323 est dans app/layout.tsx, le root
      // layout App Router — il vaut donc bien pour toute l'app. Faux positif.
      '@next/next/no-page-custom-font': 'off',
    },
  },
])
