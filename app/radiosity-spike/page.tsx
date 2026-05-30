'use client'

// ── SPIKE — WebGPU/TSL radiosity ─────────────────────────────────────────────
// mode=camera (default): 1-bounce GI gather IN CAMERA SPACE — proves colour bleed
//   (red wall → reddish floor) by reading per-vertex colour at hits. Milestone 1+2.
// mode=uvbake (Task 3): the SAME gather but baked into a uv1 LIGHTMAP TEXTURE, then
//   re-applied to the geometry from a normal camera. If the floor near the red wall
//   is reddish in the *baked* texture (reload-stable, not live shading) → UV-space
//   radiosity works. The wall is an EMITTER here; bounce 1 reads `emission` at hits.

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three/webgpu'
import { uv, uniform, wgslFn, wgsl, storage, texture } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, SAH } from 'three-mesh-bvh'
import { ndcToCameraRay, bvhIntersectFirstHit, getVertexAttribute } from 'three-mesh-bvh/webgpu'
import { applyShellUv1 } from '../../src/lib/lightbake/shellUv1'
import { radiosityBake } from '../../src/lib/lightbake/radiosityBake'

// Add a uniform per-vertex vec3 attribute to a geometry part.
function withAttr(geo: THREE.BufferGeometry, name: string, rgb: [number, number, number]): THREE.BufferGeometry {
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = rgb[0]; arr[i * 3 + 1] = rgb[1]; arr[i * 3 + 2] = rgb[2] }
  geo.setAttribute(name, new THREE.BufferAttribute(arr, 3))
  return geo
}
const withColor = (g: THREE.BufferGeometry, rgb: [number, number, number]) => withAttr(g, 'color', rgb)
const withEmission = (g: THREE.BufferGeometry, rgb: [number, number, number]) => withAttr(g, 'emission', rgb)

function reindex(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = geo.attributes.position.count
  const index = new Uint32Array(count)
  for (let i = 0; i < count; i++) index[i] = i
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  return geo
}

// CAMERA-space test geometry (albedo only).
function buildTestGeometry(): THREE.BufferGeometry {
  const floor = withColor(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2).toNonIndexed(), [0.82, 0.82, 0.82])
  const wall = withColor(new THREE.PlaneGeometry(6, 3).translate(0, 1.5, -3).toNonIndexed(), [0.90, 0.05, 0.05]) // RED
  const box = withColor(new THREE.BoxGeometry(1, 1, 1).translate(-1, 0.5, -0.5).toNonIndexed(), [0.82, 0.82, 0.82])
  const merged = mergeGeometries([floor, wall, box], false)
  merged.computeVertexNormals()
  return reindex(merged)
}

// UV-BAKE test geometry: albedo + emission + per-part uv1 atlas slot.
function buildBakeGeometry(): THREE.BufferGeometry {
  const prep = (g: THREE.BufferGeometry, albedo: [number, number, number], emission: [number, number, number], slot: number) => {
    withColor(g, albedo); withEmission(g, emission); applyShellUv1(g, slot, 4); return g
  }
  const floor = prep(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2).toNonIndexed(), [0.82, 0.82, 0.82], [0, 0, 0], 0)
  const wall = prep(new THREE.PlaneGeometry(6, 3).translate(0, 1.5, -3).toNonIndexed(), [0.90, 0.05, 0.05], [3.0, 0.06, 0.06], 1) // RED EMITTER
  const box = prep(new THREE.BoxGeometry(1, 1, 1).translate(-1, 0.5, -0.5).toNonIndexed(), [0.82, 0.82, 0.82], [0, 0, 0], 2)
  const merged = mergeGeometries([floor, wall, box], false)
  merged.computeVertexNormals()
  return reindex(merged)
}

async function runCameraSpike(canvas: HTMLCanvasElement, setS: (s: string) => void, isDisposed: () => boolean) {
  const W = 900, H = 650
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: false })
  renderer.setSize(W, H, false)
  await renderer.init()
  setS('webgpu OK, building BVH…')

  const geometry = buildTestGeometry()
  const bvh = new MeshBVH(geometry, { maxLeafSize: 1, strategy: SAH })

  const geom_index = new THREE.StorageBufferAttribute(geometry.index!.array as Uint32Array, 3)
  const geom_position = new THREE.StorageBufferAttribute(geometry.attributes.position.array as Float32Array, 3)
  const geom_normals = new THREE.StorageBufferAttribute(geometry.attributes.normal.array as Float32Array, 3)
  const geom_color = new THREE.StorageBufferAttribute(geometry.attributes.color.array as Float32Array, 3)
  const bvhNodes = new THREE.StorageBufferAttribute(new Float32Array((bvh as unknown as { _roots: ArrayBuffer[] })._roots[0]), 8)
  setS(`BVH OK (${geom_index.count} tris, ${bvhNodes.count} nodes), compiling…`)

  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100)
  camera.position.set(2.5, 2.2, 4.5)
  camera.lookAt(0, 0.8, -1)
  camera.updateMatrixWorld()

  const uInvProj = uniform(camera.projectionMatrixInverse)
  const uCamToModel = uniform(camera.matrixWorld)

  const helpers = wgsl(/* wgsl */`
    fn rndHash(p: vec2f, i: u32) -> vec2f {
      let s = p + vec2f(f32(i) * 0.1234, f32(i) * 0.5678);
      let x = fract(sin(dot(s, vec2f(127.1, 311.7))) * 43758.5453);
      let y = fract(sin(dot(s, vec2f(269.5, 183.3))) * 43758.5453);
      return vec2f(x, y);
    }
    fn hemiSample(n: vec3f, u: vec2f) -> vec3f {
      let sgn = select(-1.0, 1.0, n.z >= 0.0);
      let a = -1.0 / (sgn + n.z);
      let b = n.x * n.y * a;
      let b1 = vec3f(1.0 + sgn * n.x * n.x * a, sgn * b, -sgn * n.x);
      let b2 = vec3f(b, sgn + n.y * n.y * a, -n.y);
      let r = sqrt(u.x);
      let th = 6.2831853 * u.y;
      return r * cos(th) * b1 + r * sin(th) * b2 + sqrt(max(0.0, 1.0 - u.x)) * n;
    }
  `)

  const shade = wgslFn(/* wgsl */`
    fn shade(
      fragUv: vec2f,
      invProj: mat4x4f,
      camToModel: mat4x4f,
      geom_position: ptr<storage, array<vec3f>, read>,
      geom_index: ptr<storage, array<vec3u>, read>,
      geom_normals: ptr<storage, array<vec3f>, read>,
      geom_color: ptr<storage, array<vec3f>, read>,
      bvh: ptr<storage, array<BVHNode>, read>,
    ) -> vec3f {
      let ndc = fragUv * 2.0 - vec2f(1.0);
      var ray = ndcToCameraRay(ndc, camToModel * invProj);
      let hit = bvhIntersectFirstHit(geom_index, geom_position, bvh, ray);
      if (!hit.didHit) { return vec3f(0.0366, 0.0813, 0.1057); }

      let P = ray.origin + ray.direction * hit.dist;
      let N = normalize(getVertexAttribute(hit.barycoord, hit.indices.xyz, geom_normals));
      let albedo = getVertexAttribute(hit.barycoord, hit.indices.xyz, geom_color);

      var indirect = vec3f(0.0);
      let SAMPLES = 64;
      for (var i = 0; i < SAMPLES; i = i + 1) {
        let u = rndHash(fragUv, u32(i));
        let dir = hemiSample(N, u);
        var r2 = Ray(P + N * 0.003, dir);
        let h2 = bvhIntersectFirstHit(geom_index, geom_position, bvh, r2);
        if (h2.didHit) {
          indirect = indirect + getVertexAttribute(h2.barycoord, h2.indices.xyz, geom_color);
        }
      }
      indirect = indirect / f32(SAMPLES);
      return albedo * (vec3f(0.06) + indirect * 2.4);
    }
  `, [ndcToCameraRay, bvhIntersectFirstHit, getVertexAttribute, helpers])

  const material = new THREE.MeshBasicNodeMaterial()
  material.colorNode = shade({
    fragUv: uv(),
    invProj: uInvProj,
    camToModel: uCamToModel,
    geom_position: storage(geom_position, 'vec3', geom_position.count).toReadOnly(),
    geom_index: storage(geom_index, 'uvec3', geom_index.count).toReadOnly(),
    geom_normals: storage(geom_normals, 'vec3', geom_normals.count).toReadOnly(),
    geom_color: storage(geom_color, 'vec3', geom_color.count).toReadOnly(),
    bvh: storage(bvhNodes, 'BVHNode', bvhNodes.count).toReadOnly(),
  })

  const quadGeom = new THREE.BufferGeometry()
  quadGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  quadGeom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
  const quad = new THREE.Mesh(quadGeom, material)
  quad.frustumCulled = false
  const fsScene = new THREE.Scene()
  fsScene.add(quad)
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  await renderer.renderAsync(fsScene, fsCam)
  if (isDisposed()) return
  setS('done')
}

async function runUvBake(canvas: HTMLCanvasElement, setS: (s: string) => void, isDisposed: () => boolean) {
  const W = 900, H = 650
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: false })
  renderer.setSize(W, H, false)
  await renderer.init()
  setS('webgpu OK, building bake geometry…')

  const geometry = buildBakeGeometry()
  const bvh = new MeshBVH(geometry, { maxLeafSize: 1, strategy: SAH })
  const bounces = parseInt(new URLSearchParams(window.location.search).get('bounces') || '3', 10)
  setS(`baking uv1 lightmap (${bounces} bounce${bounces > 1 ? 's' : ''})…`)

  const lightmap = await radiosityBake(renderer, geometry, bvh, {
    resolution: 1024, samples: 96, bounces, sky: [0.015, 0.025, 0.05],
  })
  if (isDisposed()) return
  setS('lightmap baked, re-applying via uv1…')

  // DEBUG: ?view=atlas shows the raw baked lightmap atlas fullscreen.
  if (new URLSearchParams(window.location.search).get('view') === 'atlas') {
    const atlasMat = new THREE.MeshBasicNodeMaterial()
    atlasMat.colorNode = texture(lightmap).sample(uv())
    const q = new THREE.BufferGeometry()
    q.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
    const qm = new THREE.Mesh(q, atlasMat); qm.frustumCulled = false
    const sc = new THREE.Scene(); sc.add(qm)
    await renderer.renderAsync(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1))
    if (isDisposed()) return
    setS('done')
    return
  }

  // Re-apply the BAKED lightmap (sampled via uv1) onto the geometry, normal camera.
  const viewMat = new THREE.MeshBasicNodeMaterial()
  viewMat.side = THREE.DoubleSide
  viewMat.colorNode = texture(lightmap).sample(uv(1))

  const mesh = new THREE.Mesh(geometry, viewMat)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)

  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100)
  camera.position.set(2.5, 2.2, 4.5)
  camera.lookAt(0, 0.8, -1)
  camera.updateMatrixWorld()

  await renderer.renderAsync(scene, camera)
  if (isDisposed()) return
  // expose the lightmap for optional inspection
  ;(window as unknown as { __spikeLightmap?: unknown }).__spikeLightmap = lightmap
  setS('done')
}

export default function RadiositySpike() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('init')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    const isDisposed = () => disposed
    const setS = (s: string) => {
      setStatus(s)
      ;(window as unknown as { __spike?: unknown }).__spike = { status: s }
    }

    const mode = new URLSearchParams(window.location.search).get('mode') || 'camera'

    ;(async () => {
      try {
        if (mode === 'uvbake') await runUvBake(canvas, setS, isDisposed)
        else await runCameraSpike(canvas, setS, isDisposed)
      } catch (e) {
        setS('error: ' + String(e))
        console.error('[radiosity-spike]', e)
      }
    })()

    return () => { disposed = true }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 10, left: 12, color: '#0f0', fontFamily: 'monospace', fontSize: 14, zIndex: 10 }}>
        radiosity-spike · {status}
      </div>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%' }} />
    </div>
  )
}
