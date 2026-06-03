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
import { radiosityBake, type NeeEmitter } from '../../src/lib/lightbake/radiosityBake'

function setVec3(geo: THREE.BufferGeometry, name: string, rgb: [number, number, number]) {
  const n = geo.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = rgb[0]; a[i * 3 + 1] = rgb[1]; a[i * 3 + 2] = rgb[2] }
  geo.setAttribute(name, new THREE.BufferAttribute(a, 3))
}
function reindex(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = geo.attributes.position.count
  const idx = new Uint32Array(c)
  for (let i = 0; i < c; i++) idx[i] = i
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  return geo
}

// ?rig=center — a single warm-white glowing cube at room centre (6 outward one-sided faces),
// a clean omni-ish source to OBSERVE how light reflects/bounces onto every surface, instead of
// the busy 21-emitter wall rig. Not in the BVH (a light must not occlude its own shadow rays).
function centerLightRig(): NeeEmitter[] {
  const cx = 0, cy = H / 2, cz = 0, s = 0.25, E = 6.0
  const emission: [number, number, number] = [E, E * 0.96, E * 0.88] // warm white
  const x0 = cx - s, x1 = cx + s, y0 = cy - s, y1 = cy + s, z0 = cz - s, z1 = cz + s, d = 2 * s
  const faces: { facing: [number, number, number]; corner: [number, number, number]; edge1: [number, number, number]; edge2: [number, number, number] }[] = [
    { facing: [1, 0, 0], corner: [x1, y0, z0], edge1: [0, 0, d], edge2: [0, d, 0] }, // +X
    { facing: [-1, 0, 0], corner: [x0, y0, z0], edge1: [0, d, 0], edge2: [0, 0, d] }, // -X
    { facing: [0, 1, 0], corner: [x0, y1, z0], edge1: [d, 0, 0], edge2: [0, 0, d] }, // +Y (up)
    { facing: [0, -1, 0], corner: [x0, y0, z0], edge1: [0, 0, d], edge2: [d, 0, 0] }, // -Y (down)
    { facing: [0, 0, 1], corner: [x0, y0, z1], edge1: [d, 0, 0], edge2: [0, d, 0] }, // +Z
    { facing: [0, 0, -1], corner: [x0, y0, z0], edge1: [0, d, 0], edge2: [d, 0, 0] }, // -Z
  ]
  return faces.map((f) => ({ emission, rect: { corner: f.corner, edge1: f.edge1, edge2: f.edge2, facing: f.facing } }))
}

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

function buildBakeScene(): { render: THREE.BufferGeometry; bvhGeo: THREE.BufferGeometry } {
  const surfaces = shellSurfaces()
  for (const s of surfaces) applyShellUv1(s.geo, SHELL_SLOTS.indexOf(s.name as (typeof SHELL_SLOTS)[number]), ATLAS_SLOT_COUNT)
  const lit = surfaces.map((s) => s.geo)
  // Emitters are NOT in the BVH (a light must not occlude its own shadow rays) — they are
  // sampled directly via emissiveRig().rect inside radiosityBake (NEE). The BVH = the surfaces
  // (occluders like shelves get added here later). render = the same surfaces, unwrapped.
  const render = reindex(mergeGeometries(lit.map((g) => g.clone()), false)!)
  const bvhGeo = reindex(mergeGeometries(lit.map((g) => g.clone()), false)!)
  return { render, bvhGeo }
}

async function runBake(canvas: HTMLCanvasElement, setS: (s: string) => void, isDisposed: () => boolean) {
  const params = new URLSearchParams(window.location.search)
  const grayscale = params.get('color') !== '1'
  const centerMode = params.get('rig') === 'center' // single central source to read the bounce
  const bounces = parseInt(params.get('bounces') || '4', 10)
  const Wd = 1000, Ht = 640
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: false })
  renderer.setSize(Wd, Ht, false)
  await renderer.init()
  setS('webgpu OK, building shell…')

  const { render, bvhGeo } = buildBakeScene()
  const bvh = new MeshBVH(bvhGeo, { maxLeafSize: 1, strategy: SAH })
  const rig: NeeEmitter[] = centerMode ? centerLightRig() : emissiveRig()
  setS(`baking — NEE (${centerMode ? 'CENTER light' : grayscale ? 'grayscale' : 'colour'}, ${bounces} bounces)…`)

  // NEE does the direct lighting (low variance) → far fewer indirect hemisphere samples needed.
  // Center mode → zero sky so the ONLY light is the central source + its bounces (pure GI read).
  const sky: [number, number, number] = centerMode ? [0, 0, 0] : grayscale ? [0.02, 0.02, 0.02] : [0.008, 0.012, 0.025]
  const { lightmap } = await radiosityBake(renderer, render, bvhGeo, bvh, rig, {
    resolution: 1024, samples: 48, neeSamples: 8, bounces, sky, blur: 2, grayscale,
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
    const exposure = parseFloat(params.get('exp') || '1.0')
    viewMat.colorNode = texture(lightmap).sample(uv(1)).mul(exposure) // lightMapIntensity preview
    const mesh = new THREE.Mesh(render, viewMat)
    mesh.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(mesh)
    const camera = new THREE.PerspectiveCamera(60, Wd / Ht, 0.05, 50)
    // URL-driven framing (?cam=x,y,z&look=x,y,z). Default = stand mid-room facing the LEFT
    // wall (green horreur / magenta bizarre / cyan polar / orange thriller signs + their
    // coloured pools on wall and floor) — the real néon-noir test, not the washed centre floor.
    const parseVec = (s: string | null, dflt: [number, number, number]): [number, number, number] => {
      const p = (s ?? '').split(',').map(Number)
      return p.length === 3 && p.every((n) => Number.isFinite(n)) ? [p[0], p[1], p[2]] : dflt
    }
    const camPos = parseVec(params.get('cam'), [1.4, 1.55, -1.0])
    const camLook = parseVec(params.get('look'), [-4.5, 1.25, -1.2])
    camera.position.set(camPos[0], camPos[1], camPos[2])
    camera.lookAt(camLook[0], camLook[1], camLook[2])
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
