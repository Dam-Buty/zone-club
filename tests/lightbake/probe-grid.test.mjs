/**
 * Lightbake Phase 2 — probe grid math: world↔uvw mapping for the SH-L1 Data3DTexture.
 * The grid is the bake↔runtime contract; a wrong mapping silently mirrors/shifts the volume.
 *
 * Run: node --test tests/lightbake/probe-grid.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { G, PROBE_COUNT, probeWorld, worldToUvwHalfTexel, flatIndex } from '../../src/lib/lightbake/probeGrid.ts'

test('grid is 11×6×11 = 726 probes', () => {
  assert.deepEqual([...G], [11, 6, 11])
  assert.equal(PROBE_COUNT, 726)
})

test('flatIndex matches x + y*GX + z*GX*GY', () => {
  assert.equal(flatIndex(0, 0, 0), 0)
  assert.equal(flatIndex(1, 0, 0), 1)
  assert.equal(flatIndex(0, 1, 0), 11)
  assert.equal(flatIndex(0, 0, 1), 66)
  assert.equal(flatIndex(10, 5, 10), 725)
})

test('probeWorld(i) → worldToUvwHalfTexel round-trips to the probe texel centre (i+0.5)/G', () => {
  for (const [i, j, k] of [[0, 0, 0], [5, 3, 5], [10, 5, 10]]) {
    const w = probeWorld(i, j, k)
    const uvw = worldToUvwHalfTexel(w)
    assert.ok(Math.abs(uvw[0] - (i + 0.5) / G[0]) < 1e-6, `u ${uvw[0]} vs ${(i + 0.5) / G[0]}`)
    assert.ok(Math.abs(uvw[1] - (j + 0.5) / G[1]) < 1e-6, `v ${uvw[1]} vs ${(j + 0.5) / G[1]}`)
    assert.ok(Math.abs(uvw[2] - (k + 0.5) / G[2]) < 1e-6, `w ${uvw[2]} vs ${(k + 0.5) / G[2]}`)
  }
})

test('worldToUvwHalfTexel clamps a point past the margin into [halfTexel, 1-halfTexel]', () => {
  const uvw = worldToUvwHalfTexel([100, 100, 100])
  assert.ok(uvw[0] <= 1 - 0.5 / G[0] + 1e-9 && uvw[0] >= 0.5 / G[0] - 1e-9, `u clamped ${uvw[0]}`)
  const uvwLow = worldToUvwHalfTexel([-100, -100, -100])
  assert.ok(uvwLow[1] >= 0.5 / G[1] - 1e-9, `v clamped low ${uvwLow[1]}`)
})
