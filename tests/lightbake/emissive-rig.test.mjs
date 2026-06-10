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

test('every emitter rect.facing shines into the space it lights; |facing| encodes the cos^f focus', () => {
  // The one-sided NEE guard: an emitter must shine into the space it lights, never backward.
  // CONTRAT 10/06 : |facing| = exposant du lobe directionnel cos^f (≥1 ; les enseignes de genre
  // portent sfocus, le reste 1). La DIRECTION (facing normalisé) doit pointer vers la pièce ;
  // les enseignes sont en plus inclinées vers le BAS (stilt) → composante y < 0, plus ⟂ au quad.
  // Two cases: wall/ceiling SIGNS + down-fluo shine into the ROOM (toward centre); the ceiling
  // UP-WASH (a tube hung below the ceiling, facing +Y) shines onto the CEILING above it — it
  // legitimately points away from the room centre. A flipped emitter = backward light leak.
  const rig = emissiveRig({ sfocus: 2.5, stilt: 30 })
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const len = (a) => Math.hypot(a[0], a[1], a[2])
  const CENTER = [0, 1.4, 0] // room centre (≈ ROOM_HEIGHT/2, on the X/Z axis)
  for (const p of rig) {
    const { corner, edge1, edge2, facing } = p.rect
    assert.equal(facing.length, 3, `${p.name} facing is a vec3`)
    const f = len(facing)
    assert.ok(f >= 1 - 1e-6, `${p.name} |facing| ≥ 1 (exposant de focus, |f|=${f})`)
    const dir = [facing[0] / f, facing[1] / f, facing[2] / f]
    const isSign = Math.abs(f - 2.5) < 1e-6 // les enseignes portent sfocus
    if (isSign) {
      assert.ok(dir[1] < -0.3, `${p.name} enseigne inclinée vers le bas (dir.y=${dir[1].toFixed(2)})`)
    } else {
      assert.ok(Math.abs(dot(dir, edge1)) < 1e-6, `${p.name} facing ⟂ edge1`)
      assert.ok(Math.abs(dot(dir, edge2)) < 1e-6, `${p.name} facing ⟂ edge2`)
    }
    const mid = [corner[0] + 0.5 * (edge1[0] + edge2[0]), corner[1] + 0.5 * (edge1[1] + edge2[1]), corner[2] + 0.5 * (edge1[2] + edge2[2])]
    if (dir[1] > 0.9) {
      // Ceiling up-wash: must point UP (toward the ceiling it lights) and sit in the upper half.
      assert.ok(mid[1] > CENTER[1], `${p.name} up-wash sits above room centre (y=${mid[1].toFixed(2)})`)
    } else {
      // Vers la pièce : composante HORIZONTALE vers le centre (les enseignes inclinées plongent
      // vers le sol devant elles — le dot 3D avec le centre peut être faible, on teste en XZ).
      const toCenterXZ = [CENTER[0] - mid[0], 0, CENTER[2] - mid[2]]
      const dirXZ = [dir[0], 0, dir[2]]
      const isDownFacing = dir[1] < -0.9 // pools/fluos down : XZ ≈ 0, rien à tester
      if (!isDownFacing) {
        assert.ok(dot(dirXZ, toCenterXZ) > 0, `${p.name} facing points into the room (dotXZ=${dot(dirXZ, toCenterXZ).toFixed(3)})`)
      }
    }
  }
})
