/**
 * Lightbake — deterministic procedural uv1 (atlas slot + planar projection).
 *
 * Run: node --test tests/lightbake/shell-uv1.test.mjs
 * (Node 24 strips/imports the pure .ts module natively.)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { applyShellUv1, SHELL_SLOTS, ATLAS_SLOT_COUNT } from '../../src/lib/lightbake/shellUv1.ts'

test('uv1 is in [0,1], lands inside the mesh slot, deterministic', () => {
  const g = new THREE.PlaneGeometry(4, 3).toNonIndexed()
  applyShellUv1(g, 5, 16) // slot 5 of a 4x4 atlas
  const uv1 = g.getAttribute('uv1')
  assert.ok(uv1, 'uv1 written')
  // slot 5 in a 4x4 grid → col 1, row 1 → x in [0.25,0.5], y in [0.25,0.5]
  for (let i = 0; i < uv1.count; i++) {
    const x = uv1.getX(i), y = uv1.getY(i)
    assert.ok(x >= 0.25 - 1e-4 && x <= 0.5 + 1e-4, `x ${x} in slot`)
    assert.ok(y >= 0.25 - 1e-4 && y <= 0.5 + 1e-4, `y ${y} in slot`)
  }
  // determinism
  const g2 = new THREE.PlaneGeometry(4, 3).toNonIndexed()
  applyShellUv1(g2, 5, 16)
  const a = g.getAttribute('uv1').array, b = g2.getAttribute('uv1').array
  for (let i = 0; i < a.length; i++) assert.equal(a[i], b[i])
})

test('SHELL_SLOTS lists the v1 lightmapped surfaces (6 big surfaces)', () => {
  assert.equal(SHELL_SLOTS.length, 6)
  assert.ok(SHELL_SLOTS.includes('floor'))
  assert.ok(SHELL_SLOTS.includes('ceiling'))
  assert.equal(SHELL_SLOTS.filter((n) => n.startsWith('wall-')).length, 4)
  // v1 scope: shelf backs + island bodies are OCCLUDERS only (extension / probe volume later)
  assert.equal(SHELL_SLOTS.filter((n) => n.startsWith('shelfback-')).length, 0)
  assert.equal(SHELL_SLOTS.filter((n) => n.startsWith('island-')).length, 0)
})

test('ATLAS_SLOT_COUNT is a perfect square that fits all slots', () => {
  const g = Math.sqrt(ATLAS_SLOT_COUNT)
  assert.equal(g, Math.round(g), 'perfect square')
  assert.ok(ATLAS_SLOT_COUNT >= SHELL_SLOTS.length, 'fits SHELL_SLOTS')
})
