/**
 * Lightbake — emissiveRig: the néon-noir emitter proxy quads (world-space geometry +
 * linear HDR emission) that drive the bake gather.
 *
 * Run: node --test tests/lightbake/emissive-rig.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { emissiveRig } from '../../src/lib/lightbake/emissiveRig.ts'

test('emissiveRig builds the main néon-noir emitters with positive linear emission', () => {
  const rig = emissiveRig()
  // 4 ceiling fluo + 2 island overhead + comptoir + vitrine cold = at least 8
  assert.ok(rig.length >= 8, `got ${rig.length} emitters`)
  for (const p of rig) {
    const pos = p.geometry.getAttribute('position')
    assert.ok(pos && pos.count > 0, `${p.name} has geometry`)
    assert.equal(p.emission.length, 3)
    assert.ok(p.emission.some((v) => v > 0), `${p.name} emits`)
  }
})

test('vitrine is the cold blue emitter (blue channel dominant)', () => {
  const vitrine = emissiveRig().find((p) => p.name === 'vitrine')
  assert.ok(vitrine, 'vitrine emitter present')
  assert.ok(vitrine.emission[2] > vitrine.emission[0], 'blue > red')
})
