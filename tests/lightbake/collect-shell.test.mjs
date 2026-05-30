/**
 * Lightbake — collectShell: partition a shell group into lightmapped (by SHELL_SLOTS
 * order, matched by name = bake-<slot>) vs occluders (every other mesh).
 *
 * Run: node --test tests/lightbake/collect-shell.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { collectShell } from '../../src/lib/lightbake/collectShell.ts'
import { SHELL_SLOTS, bakeName } from '../../src/lib/lightbake/shellUv1.ts'

function mesh(name) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1))
  if (name) m.name = name
  return m
}

test('collectShell returns lightmapped in SHELL_SLOTS order + the rest as occluders', () => {
  const root = new THREE.Group()
  // add lightmapped shuffled to prove ordering is by SHELL_SLOTS, not scene order
  root.add(mesh(bakeName('wall-south')))
  root.add(mesh(bakeName('floor')))
  const occ1 = mesh('wallshelf-back'); root.add(occ1)
  root.add(mesh(bakeName('ceiling')))
  root.add(mesh(bakeName('wall-north')))
  root.add(mesh(bakeName('wall-left')))
  root.add(mesh(bakeName('wall-right')))
  const occ2 = mesh('island-body'); root.add(occ2)

  const { lightmapped, occluders } = collectShell(root)
  assert.equal(lightmapped.length, 6)
  assert.deepEqual(lightmapped.map((m) => m.name), SHELL_SLOTS.map(bakeName))
  assert.equal(occluders.length, 2)
  assert.ok(occluders.includes(occ1) && occluders.includes(occ2))
})

test('collectShell throws if a lightmapped slot mesh is missing', () => {
  const root = new THREE.Group()
  root.add(mesh(bakeName('floor')))
  assert.throws(() => collectShell(root), /missing lightmapped/)
})
