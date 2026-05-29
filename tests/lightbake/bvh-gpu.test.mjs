/**
 * Lightbake — GPU BVH storage-buffer helpers.
 *
 * Run: node --test tests/lightbake/bvh-gpu.test.mjs
 * Only packBvhBuffers + WGSL_HELPERS are node-testable (pure). gpuStorages needs a
 * WebGPU context → validated in the browser at Task 3 (/radiosity-spike?mode=uvbake).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { packBvhBuffers, WGSL_HELPERS } from '../../src/lib/lightbake/bvhGpu.ts'

test('packBvhBuffers yields index/position triplet counts + non-empty nodes', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed()
  const n = geo.attributes.position.count
  const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  const bvh = new MeshBVH(geo)
  const b = packBvhBuffers(geo, bvh)
  assert.equal(b.indexCount, n / 3)        // triangles
  assert.equal(b.positionCount, n)
  assert.ok(b.nodeFloats % 8 === 0 && b.nodeFloats > 0) // 8 floats / node
})

test('WGSL_HELPERS carries the proven rndHash + hemiSample snippets', () => {
  assert.match(WGSL_HELPERS, /fn rndHash/)
  assert.match(WGSL_HELPERS, /fn hemiSample/)
})
