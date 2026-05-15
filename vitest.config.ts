import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // One worker per file: lib/db.ts is a module-level singleton, and each test
    // file points DATABASE_PATH to its own /tmp file. Forks avoid threads
    // sharing module caches, so each suite gets its own SQLite handle.
    pool: 'forks',
  },
})
