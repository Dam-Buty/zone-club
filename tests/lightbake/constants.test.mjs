/**
 * Lightbake — bake constants + shell membership.
 *
 * Run: node --test tests/lightbake/constants.test.mjs
 * (Node 24 strips/imports the pure .ts module natively.)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BAKE_SHELL, LIGHTMAP_RESOLUTION, LIGHTMAP_SCALE, SAMPLES_PER_LIGHT } from '../../src/lib/lightbake/constants.ts'

test('BAKE_SHELL lists floor/ceiling/4 walls/8 shelves/2 islands', () => {
  assert.ok(BAKE_SHELL.includes('floor'))
  assert.ok(BAKE_SHELL.includes('ceiling'))
  assert.equal(BAKE_SHELL.filter((n) => n.startsWith('wall-')).length, 4)
  assert.equal(BAKE_SHELL.filter((n) => n.startsWith('shelf-')).length, 8)
  assert.equal(BAKE_SHELL.filter((n) => n.startsWith('island-')).length, 2)
  assert.equal(BAKE_SHELL.length, 16)
})

test('bake constants are sane', () => {
  assert.equal(LIGHTMAP_RESOLUTION, 2048)
  assert.equal(LIGHTMAP_SCALE, 4.0)
  assert.ok(SAMPLES_PER_LIGHT >= 64)
})
