/**
 * Lightbake Phase 2 — SH-L1 projection/reconstruction contract. The lobe MUST point toward the lit
 * direction, or runtime irradiance lights the wrong side (a silent failure, no crash). This pins
 * the axis convention shared by the bake (probeBake.ts) and the runtime TSL (shReconstruct.ts).
 *
 * Run: node --test tests/lightbake/sh-projection.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { newShAcc, projectSampleL1, finalizeL1, reconstructE } from '../../src/lib/lightbake/probeGrid.ts'

test('SH-L1 lobe points toward the lit direction (+X bright → E(+X) > E(-X))', () => {
  const acc = newShAcc()
  const N = 256
  // One strong white sample arriving from +X; the rest dark. The single sample weight N
  // cancels the finalize 1/N so it dominates the projection.
  for (let i = 0; i < N; i++) {
    const dir = i === 0 ? [1, 0, 0] : [0, 0, 0]
    const L = i === 0 ? [N, N, N] : [0, 0, 0]
    projectSampleL1(acc, dir, L)
  }
  finalizeL1(acc, N)
  const ePlusX = reconstructE(acc, [1, 0, 0])
  const eMinusX = reconstructE(acc, [-1, 0, 0])
  assert.ok(ePlusX[0] > eMinusX[0], `E(+X).r ${ePlusX[0]} should exceed E(-X).r ${eMinusX[0]}`)
  assert.ok(ePlusX[0] > 0, 'lit side positive')
  assert.ok(eMinusX[0] >= 0, 'reconstruct clamps negative irradiance to 0')
})

test('SH-L1 lobe resolves the Y axis too (+Y bright → E(+Y) > E(-Y))', () => {
  const acc = newShAcc()
  const N = 256
  for (let i = 0; i < N; i++) {
    const dir = i === 0 ? [0, 1, 0] : [0, 0, 0]
    const L = i === 0 ? [N, N, N] : [0, 0, 0]
    projectSampleL1(acc, dir, L)
  }
  finalizeL1(acc, N)
  assert.ok(reconstructE(acc, [0, 1, 0])[1] > reconstructE(acc, [0, -1, 0])[1], 'Y lobe')
})
