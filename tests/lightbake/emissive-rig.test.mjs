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

test('every emitter rect.facing is a unit normal ⟂ to its plane, shining into the space it lights', () => {
  // The one-sided NEE guard: an emitter must shine into the space it lights, never backward.
  // Two cases: wall/ceiling SIGNS + down-fluo shine into the ROOM (toward centre); the ceiling
  // UP-WASH (a tube hung below the ceiling, facing +Y) shines onto the CEILING above it — it
  // legitimately points away from the room centre. A flipped emitter = backward light leak or a
  // dead emitter; a flipped up-wash would double-count the down-fluo and leave the ceiling dark.
  // This invariant would have caught the ceiling cross(e1,e2) winding flip.
  const rig = emissiveRig()
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const len = (a) => Math.hypot(a[0], a[1], a[2])
  const CENTER = [0, 1.4, 0] // room centre (≈ ROOM_HEIGHT/2, on the X/Z axis)
  for (const p of rig) {
    const { corner, edge1, edge2, facing } = p.rect
    assert.equal(facing.length, 3, `${p.name} facing is a vec3`)
    assert.ok(Math.abs(len(facing) - 1) < 1e-6, `${p.name} facing is unit (|f|=${len(facing)})`)
    assert.ok(Math.abs(dot(facing, edge1)) < 1e-6, `${p.name} facing ⟂ edge1`)
    assert.ok(Math.abs(dot(facing, edge2)) < 1e-6, `${p.name} facing ⟂ edge2`)
    const mid = [corner[0] + 0.5 * (edge1[0] + edge2[0]), corner[1] + 0.5 * (edge1[1] + edge2[1]), corner[2] + 0.5 * (edge1[2] + edge2[2])]
    if (facing[1] > 0.9) {
      // Ceiling up-wash: must point UP (toward the ceiling it lights) and sit in the upper half.
      assert.ok(mid[1] > CENTER[1], `${p.name} up-wash sits above room centre (y=${mid[1].toFixed(2)})`)
    } else {
      const toCenter = [CENTER[0] - mid[0], CENTER[1] - mid[1], CENTER[2] - mid[2]]
      assert.ok(dot(facing, toCenter) > 0, `${p.name} facing points into the room (dot=${dot(facing, toCenter).toFixed(3)})`)
    }
  }
})
