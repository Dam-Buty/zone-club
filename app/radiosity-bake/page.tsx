'use client'

// ── BAKE HARNESS — radiosity lightmap of the real shell (Task 5, grayscale-first) ──
// Builds the 6 lightmapped surfaces in WORLD space (same PlaneGeometry args + transforms
// as Aisle.tsx → identical vertices → the procedural uv1 matches the runtime meshes), adds
// the néon-noir emissive rig as non-lightmapped emitters, bakes, and previews from an
// in-room camera. Grayscale = emitter emission forced to luminance (neutral but colour-ready).

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three/webgpu'
import { uv, texture } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, SAH } from 'three-mesh-bvh'
import { ROOM_WIDTH as W, ROOM_DEPTH as D, ROOM_HEIGHT as H } from '../../src/components/interior/constants'
import { SHELL_SLOTS, applyShellUv1, ATLAS_SLOT_COUNT } from '../../src/lib/lightbake/shellUv1'
import { emissiveRig } from '../../src/lib/lightbake/emissiveRig'
import { radiosityBake } from '../../src/lib/lightbake/radiosityBake'

function setVec3(geo: THREE.BufferGeometry, name: string, rgb: [number, number, number]) {
  const n = geo.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = rgb[0]; a[i * 3 + 1] = rgb[1]; a[i * 3 + 2] = rgb[2] }
  geo.setAttribute(name, new THREE.BufferAttribute(a, 3))
}
function setConstUv1(geo: THREE.BufferGeometry, u: number, v: number) {
  const n = geo.attributes.position.count
  const a = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) { a[i * 2] = u; a[i * 2 + 1] = v }
  geo.setAttribute('uv1', new THREE.BufferAttribute(a, 2))
}
function reindex(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = geo.attributes.position.count
  const idx = new Uint32Array(c)
  for (let i = 0; i < c; i++) idx[i] = i
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  return geo
}
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

// Centre of the first EMPTY atlas slot (no lightmapped surface) → black at textureLoad.
const emptyUv = (() => {
  const grid = Math.round(Math.sqrt(ATLAS_SLOT_COUNT))
  const s = SHELL_SLOTS.length // first free slot index
  return [((s % grid) + 0.5) / grid, (Math.floor(s / grid) + 0.5) / grid] as [number, number]
})()

// The 6 lightmapped surfaces in WORLD space, matching Aisle.tsx geometry construction.
function shellSurfaces(): { name: string; geo: THREE.BufferGeometry }[] {
  const ALBEDO: [number, number, number] = [0.55, 0.55, 0.55]
  const mk = (geo: THREE.BufferGeometry) => {
    const g = geo.toNonIndexed()
    setVec3(g, 'color', ALBEDO)
    setVec3(g, 'emission', [0, 0, 0])
    return g
  }
  return [
    { name: 'floor', geo: mk(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2)) },
    { name: 'ceiling', geo: mk(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2).translate(0, H, 0)) },
    { name: 'wall-north', geo: mk(new THREE.PlaneGeometry(W, H).translate(0, H / 2, -D / 2)) },
    { name: 'wall-south', geo: mk(new THREE.PlaneGeometry(W, H).rotateY(Math.PI).translate(0, H / 2, D / 2)) },
    { name: 'wall-left', geo: mk(new THREE.PlaneGeometry(D, H).rotateY(Math.PI / 2).translate(-W / 2, H / 2, 0)) },
    { name: 'wall-right', geo: mk(new THREE.PlaneGeometry(D, H).rotateY(-Math.PI / 2).translate(W / 2, H / 2, 0)) },
  ]
}

function buildBakeScene(grayscale: boolean): { render: THREE.BufferGeometry; bvhGeo: THREE.BufferGeometry } {
  const surfaces = shellSurfaces()
  for (const s of surfaces) applyShellUv1(s.geo, SHELL_SLOTS.indexOf(s.name as (typeof SHELL_SLOTS)[number]), ATLAS_SLOT_COUNT)
  const lit = surfaces.map((s) => s.geo)

  // Emitters: néon-noir rig as non-lightmapped emitters (uv1 → empty slot).
  const emitters = emissiveRig().map((e) => {
    const g = e.geometry.toNonIndexed()
    setVec3(g, 'color', [0, 0, 0])
    const [er, eg, eb] = e.emission
    const em = grayscale ? lum(er, eg, eb) : 0
    setVec3(g, 'emission', grayscale ? [em, em, em] : [er, eg, eb])
    setConstUv1(g, emptyUv[0], emptyUv[1])
    return g
  })

  const render = reindex(mergeGeometries(lit.map((g) => g.clone()), false)!)
  const bvhGeo = reindex(mergeGeometries([...lit, ...emitters], false)!)
  return { render, bvhGeo }
}

async function runBake(canvas: HTMLCanvasElement, setS: (s: string) => void, isDisposed: () => boolean) {
  const params = new URLSearchParams(window.location.search)
  const grayscale = params.get('color') !== '1'
  const bounces = parseInt(params.get('bounces') || '4', 10)
  const Wd = 1000, Ht = 640
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: false })
  renderer.setSize(Wd, Ht, false)
  await renderer.init()
  setS('webgpu OK, building shell…')

  const { render, bvhGeo } = buildBakeScene(grayscale)
  const bvh = new MeshBVH(bvhGeo, { maxLeafSize: 1, strategy: SAH })
  setS(`baking shell lightmap (${grayscale ? 'grayscale' : 'colour'}, ${bounces} bounces)…`)

  const sky: [number, number, number] = grayscale ? [0.02, 0.02, 0.02] : [0.008, 0.012, 0.025]
  const lightmap = await radiosityBake(renderer, render, bvhGeo, bvh, {
    resolution: 1024, samples: 256, bounces, sky, blur: 3,
  })
  if (isDisposed()) return
  setS('baked, previewing…')

  // ?view=atlas → raw atlas; else re-apply onto the shell from an in-room camera.
  if (params.get('view') === 'atlas') {
    const m = new THREE.MeshBasicNodeMaterial()
    m.colorNode = texture(lightmap).sample(uv())
    const q = new THREE.BufferGeometry()
    q.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
    const mesh = new THREE.Mesh(q, m); mesh.frustumCulled = false
    const sc = new THREE.Scene(); sc.add(mesh)
    await renderer.renderAsync(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1))
  } else {
    const viewMat = new THREE.MeshBasicNodeMaterial()
    viewMat.side = THREE.DoubleSide
    viewMat.colorNode = texture(lightmap).sample(uv(1)).mul(1.6) // lightMapIntensity preview
    const mesh = new THREE.Mesh(render, viewMat)
    mesh.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(mesh)
    const camera = new THREE.PerspectiveCamera(78, Wd / Ht, 0.05, 50)
    // overview from near the entrance, slightly angled → north wall + left wall + floor + ceiling
    camera.position.set(1.8, 1.5, 3.2)
    camera.lookAt(-1.5, 1.05, -4.25)
    camera.updateMatrixWorld()
    await renderer.renderAsync(scene, camera)
  }
  if (isDisposed()) return
  ;(window as unknown as { __bake?: unknown }).__bake = { lightmap, done: true }
  ;(window as unknown as { __bakeExport?: () => string }).__bakeExport = () => canvas.toDataURL('image/png')
  setS('done')
}

export default function RadiosityBake() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('init')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    const setS = (s: string) => {
      setStatus(s)
      ;(window as unknown as { __bake?: unknown }).__bake = { status: s }
    }
    ;(async () => {
      try { await runBake(canvas, setS, () => disposed) }
      catch (e) { setS('error: ' + String(e)); console.error('[radiosity-bake]', e) }
    })()
    return () => { disposed = true }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 10, left: 12, color: '#0f0', fontFamily: 'monospace', fontSize: 14, zIndex: 10 }}>
        radiosity-bake · {status}
      </div>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%' }} />
    </div>
  )
}
