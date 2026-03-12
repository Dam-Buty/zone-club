import { useMemo, useEffect, Suspense, memo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGLTF, useTexture } from '@react-three/drei'
import { generateKentTileTextures } from '../../utils/KentTileTexture'
import { LaZoneCRT } from './LaZoneCRT'
import { BoardMesh } from './BoardMesh'

// Composant pour chargement async des modèles 3D
function AsyncModel({ url, position, scale = 1, rotation = [0, 0, 0] }: {
  url: string
  position: [number, number, number]
  scale?: number | [number, number, number]
  rotation?: [number, number, number]
}) {
  const { scene } = useGLTF(url, true)
  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true)
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = true
      }
    })
    return cloned
  }, [scene])

  return (
    <primitive
      object={clonedScene}
      position={position}
      scale={scale}
      rotation={rotation}
    />
  )
}
// Preload shelf model at module level (downloaded at JS parse time, not component mount)
useGLTF.preload('/models/shelf.glb', true)
useGLTF.preload('/models/board.glb', true)

import { useKTX2Textures } from '../../hooks/useKTX2Textures'
import { WallShelf, SHELF_DEPTH, SHELF_TILT, SHELF_PIVOT_Y, WALL_SHELF_ROWS } from './WallShelf'
import {
  IslandShelf,
  ISLAND_SHELF_BASE_WIDTH,
  ISLAND_SHELF_CASSETTE_ROWS,
  ISLAND_SHELF_CASSETTE_TILT,
  ISLAND_SHELF_FIRST_PLANK_BASE_Y,
  ISLAND_SHELF_HEIGHT,
  ISLAND_SHELF_PLANK_OFFSET,
  ISLAND_SHELF_PLANK_THICKNESS,
  ISLAND_SHELF_ROW_HEIGHT,
  ISLAND_SHELF_TOP_WIDTH,
} from './IslandShelf'
import { CassetteInstances } from './CassetteInstances'
import { CASSETTE_DIMENSIONS, CASSETTE_COLORS } from './Cassette'
import { GenreSectionPanel, GenrePanelAnimator, GENRE_CONFIG } from './GenreSectionPanel'
import { PosterWall } from './Poster'
import { Storefront } from './Storefront'
import { InteractiveTVDisplay } from './InteractiveTVDisplay'
import { Manager3D } from './Manager3D'
import { ServiceBell } from './ServiceBell'
import { DustParticles } from './DustParticles'
import type { Film, AisleType } from '../../types'
import type { CassetteInstanceData } from '../../utils/CassetteTextureArray'

interface AisleProps {
  films: Film[]
  filmsByAisle: Record<AisleType, Film[]>
}

// Dimensions de la pièce (basées sur le plan PDF, réduites de 30%)
const ROOM_WIDTH = 9  // x axis
const ROOM_DEPTH = 8.5 // z axis
const ROOM_HEIGHT = 2.8
const WALL_SHELF_OFFSET = 0.15 // distance from wall to shelf center (accounts for depth + tilt)

// Set to true once KTX2 textures have been generated via scripts/convert-textures-ktx2.sh
// KTX2 UASTC = 4x less VRAM, hardware decompression, zero shader cost
const USE_KTX2 = true

// Hook pour charger un set de textures PBR avec tiling
// When USE_KTX2 is true, swap this function body to use useKTX2Textures instead.
const usePBRTextures = USE_KTX2 ? useKTX2Textures : function usePBRTexturesJPEG(
  basePath: string,
  repeatX: number,
  repeatY: number,
  hasAO = false
): Record<string, THREE.Texture> {
  const paths: Record<string, string> = {
    map: `${basePath}/color.jpg`,
    normalMap: `${basePath}/normal.jpg`,
    roughnessMap: `${basePath}/roughness.jpg`,
  }
  if (hasAO) {
    paths.aoMap = `${basePath}/ao.jpg`
  }

  const textures = useTexture(paths)

  useMemo(() => {
    Object.values(textures).forEach((tex) => {
      const t = tex as THREE.Texture
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.repeat.set(repeatX, repeatY)
      t.anisotropy = 16
      if (t === (textures as Record<string, THREE.Texture>).map) {
        t.colorSpace = THREE.SRGBColorSpace
      } else {
        t.colorSpace = THREE.LinearSRGBColorSpace
      }
    })
  }, [textures, repeatX, repeatY])

  return textures as Record<string, THREE.Texture>
}

// Créer la texture pour l'écriteau PRIVÉE
function createPrivateSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const ctx = canvas.getContext('2d')!

  // Fond beige/crème
  ctx.fillStyle = '#f5f0e6'
  ctx.fillRect(0, 0, 256, 96)

  // Bordure noire
  ctx.strokeStyle = '#1a1a1a'
  ctx.lineWidth = 4
  ctx.strokeRect(4, 4, 248, 88)

  // Texte PRIVÉE en noir
  ctx.font = 'bold 42px "Arial Black", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#1a1a1a'
  ctx.fillText('PRIVÉE', 128, 48)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

// Composant écriteau PRIVÉE
function PrivateSign({ position }: { position: [number, number, number] }) {
  const texture = useMemo(() => createPrivateSignTexture(), [])

  useEffect(() => {
    return () => texture.dispose()
  }, [texture])

  return (
    <mesh position={position}>
      <planeGeometry args={[0.35, 0.13]} />
      <meshStandardMaterial map={texture} roughness={0.8} />
    </mesh>
  )
}

function MergedWalls({ wallTextures, roomWidth, roomDepth, roomHeight }: {
  wallTextures: Record<string, THREE.Texture>
  roomWidth: number
  roomDepth: number
  roomHeight: number
}) {
  const geometry = useMemo(() => {
    // Mur du fond (nord): face +Z, position [0, H/2, -D/2]
    const wallBack = new THREE.PlaneGeometry(roomWidth, roomHeight)
    wallBack.translate(0, roomHeight / 2, -roomDepth / 2)

    // Mur gauche (ouest): face +X, position [-W/2, H/2, 0], rotation Y=PI/2
    const wallLeft = new THREE.PlaneGeometry(roomDepth, roomHeight)
    wallLeft.rotateY(Math.PI / 2)
    wallLeft.translate(-roomWidth / 2, roomHeight / 2, 0)

    // Mur droit (est): face -X, position [W/2, H/2, 0], rotation Y=-PI/2
    const wallRight = new THREE.PlaneGeometry(roomDepth, roomHeight)
    wallRight.rotateY(-Math.PI / 2)
    wallRight.translate(roomWidth / 2, roomHeight / 2, 0)

    return mergeGeometries([wallBack, wallLeft, wallRight])!
  }, [roomWidth, roomDepth, roomHeight])

  const material = useMemo(() => {
    // Interior walls should read as painted smooth plaster, not raw concrete.
    // Keep the warm storefront-inspired hue, but drop the heavy PBR relief.
    const next = new THREE.MeshPhysicalMaterial({
      color: '#d4b080',
      roughness: 0.38,
      metalness: 0.0,
      envMapIntensity: 0.70,
      clearcoat: 0.22,
      clearcoatRoughness: 0.45,
    })
    return next
  }, [wallTextures])

  useEffect(() => {
    return () => { geometry.dispose() }
  }, [geometry])

  useEffect(() => {
    return () => { material.dispose() }
  }, [material])

  return <mesh geometry={geometry} material={material} receiveShadow />
}

// Shared VHS tape geometry & material for desk pile and storage cabinet
const DESK_VHS_GEO = new THREE.BoxGeometry(0.168, 0.03, 0.228)
const DESK_VHS_MAT = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.4 })

// ===== CASSETTE POSITION PRE-COMPUTATION =====
// Pure functions that compute cassette instance data synchronously in useMemo,
// eliminating the 2-frame delay from the previous shelf callback cascade
// (mount → useEffect → callback → wait-for-all-6 → setState → re-render).

// WallShelf constants (must match WallShelf.tsx — SHELF_DEPTH, SHELF_TILT, SHELF_PIVOT_Y imported)
const PLANK_DEPTH = 0.07  // must match WallShelf.tsx PLANK_DEPTH
const WALL_ROWS = WALL_SHELF_ROWS
const WALL_ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.04  // must match WallShelf.tsx ROW_HEIGHT
const WALL_CASSETTE_SPACING = CASSETTE_DIMENSIONS.width + 0.02

// Pre-computed tilt quaternion for cassette positioning (same tilt as WallShelf inner group)
const _tiltQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-SHELF_TILT, 0, 0))

// IslandShelf constants — sourced from IslandShelf.tsx so cassette placement
// stays locked to the real shelf geometry.
const ISLAND_ROWS = ISLAND_SHELF_CASSETTE_ROWS
const ISLAND_CASSETTES_PER_ROW = 21
const ISLAND_CASSETTE_SPACING = CASSETTE_DIMENSIONS.width + 0.02
const SECTION_GAP = 0.12

function dedupeFilms(films: Film[]): Film[] {
  const seen = new Set<number>()
  return films.filter((film) => {
    if (seen.has(film.id)) return false
    seen.add(film.id)
    return true
  })
}


function expandFilmsByStock(films: Film[]): Film[] {
  const expanded: Film[] = []

  for (const film of films) {
    const copies = Math.max(1, film.stock ?? 1)
    for (let copy = 0; copy < copies; copy++) {
      expanded.push(film)
    }
  }

  return expanded
}

function buildDisplaySequence(films: Film[], capacity: number, repeatWhenShort = true, maxCopies = Infinity): Film[] {
  if (films.length === 0 || capacity <= 0) return []

  let expanded: Film[]
  if (maxCopies < Infinity) {
    expanded = []
    const counts = new Map<number, number>()
    for (const film of expandFilmsByStock(films)) {
      const c = counts.get(film.id) ?? 0
      if (c < maxCopies) { expanded.push(film); counts.set(film.id, c + 1) }
    }
  } else {
    expanded = expandFilmsByStock(films)
  }
  if (expanded.length === 0) return []

  if (!repeatWhenShort && expanded.length <= capacity) {
    return expanded
  }

  return Array.from({ length: capacity }, (_, index) => expanded[index % expanded.length])
}

function computeWallShelfCassettes(
  position: [number, number, number],
  rotation: [number, number, number],
  length: number,
  films: Film[],
  repeatWhenShort = true,
  maxCopies = 1
): CassetteInstanceData[] {
  if (films.length === 0) return []

  const cassettesPerRow = Math.floor((length - 0.1) / WALL_CASSETTE_SPACING)
  const totalCapacity = cassettesPerRow * WALL_ROWS
  const displayFilms = buildDisplaySequence(films, totalCapacity, repeatWhenShort, maxCopies)
  const data: CassetteInstanceData[] = []

  const baseQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0], rotation[1], rotation[2])
  )
  // Combined quaternion: parent rotation × shelf tilt
  const parentQuat = baseQuat.clone().multiply(_tiltQuat)
  const parentPos = new THREE.Vector3(position[0], position[1], position[2])

  for (let index = 0; index < totalCapacity; index++) {
    const row = Math.floor(index / cassettesPerRow)
    const col = index % cassettesPerRow
    if (row >= WALL_ROWS) continue

    const film = displayFilms[index]
    if (!film) continue

    const localX = (col - cassettesPerRow / 2 + 0.5) * WALL_CASSETTE_SPACING
    // Align with WallShelf planks: plank i at y = 0.12 + i * ROW_HEIGHT
    // K7 sit on planks i=2..6 (i=1 is bottom, not visible). Cassette center = plankY + 0.0125 + height/2
    const plankI = row + 1
    const localY = 0.12 + plankI * WALL_ROW_HEIGHT + 0.0125 + CASSETTE_DIMENSIONS.height / 2
    const localZ = SHELF_DEPTH / 2 + PLANK_DEPTH / 2  // centered on the plank

    // Apply tilt: translate to pivot, rotate, translate back
    // Tilt pivot is at (0, SHELF_PIVOT_Y, 0) in shelf local space
    const tiltedPos = new THREE.Vector3(localX, localY - SHELF_PIVOT_Y, localZ)
    tiltedPos.applyQuaternion(_tiltQuat)
    tiltedPos.y += SHELF_PIVOT_Y

    // Then apply parent rotation + translation to world space
    tiltedPos.applyQuaternion(baseQuat)
    tiltedPos.add(parentPos)

    const cassetteKey = `wall-${position[0].toFixed(1)}-${position[2].toFixed(1)}-${row}-${col}`
    const posterUrl = film.poster_path
      ? `https://image.tmdb.org/t/p/w185${film.poster_path}`
      : null

    data.push({
      cassetteKey,
      filmId: film.id,
      worldPosition: tiltedPos,
      worldQuaternion: parentQuat.clone(),
      hoverOffsetZ: 0.08,
      posterUrl,
      fallbackColor: CASSETTE_COLORS[film.id % CASSETTE_COLORS.length],
    })
  }

  return data
}

function computeIslandShelfCassettes(
  position: [number, number, number],
  rotation: [number, number, number],
  filmsLeft: Film[],
  filmsRight: Film[],
  keyPrefix = 'island',
  repeatWhenShort = true,
  maxCopies = 1
): CassetteInstanceData[] {
  if (filmsLeft.length === 0 && filmsRight.length === 0) return []

  const totalCapacityPerSide = ISLAND_CASSETTES_PER_ROW * ISLAND_ROWS
  const data: CassetteInstanceData[] = []

  const parentQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0], rotation[1], rotation[2])
  )
  const parentPos = new THREE.Vector3(position[0], position[1], position[2])

  const addCassettes = (films: Film[], side: 'left' | 'right', maxCopies = 1) => {
    const displayFilms = buildDisplaySequence(films, totalCapacityPerSide, repeatWhenShort, maxCopies)
    const sideTilt = side === 'left' ? -ISLAND_SHELF_CASSETTE_TILT : ISLAND_SHELF_CASSETTE_TILT
    const sideTiltQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sideTilt))
    const sideFaceQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, side === 'left' ? Math.PI / 2 : -Math.PI / 2, 0)
    )
    const faceQuat = sideTiltQuat.clone().multiply(sideFaceQuat)
    const plankNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(sideTiltQuat)

    for (let index = 0; index < totalCapacityPerSide; index++) {
      const row = Math.floor(index / ISLAND_CASSETTES_PER_ROW)
      const col = index % ISLAND_CASSETTES_PER_ROW
      if (row >= ISLAND_ROWS) continue

      const film = displayFilms[index]
      if (!film) continue

      const plankIndex = row + 1
      const plankY = ISLAND_SHELF_FIRST_PLANK_BASE_Y + plankIndex * ISLAND_SHELF_ROW_HEIGHT
      const widthAtHeight = ISLAND_SHELF_BASE_WIDTH - (ISLAND_SHELF_BASE_WIDTH - ISLAND_SHELF_TOP_WIDTH) * (plankY / ISLAND_SHELF_HEIGHT)

      const plankCenterX =
        side === 'left'
          ? -widthAtHeight / 2 - ISLAND_SHELF_PLANK_OFFSET
          : widthAtHeight / 2 + ISLAND_SHELF_PLANK_OFFSET
      const localZ = (col - ISLAND_CASSETTES_PER_ROW / 2 + 0.5) * ISLAND_CASSETTE_SPACING
      const worldQuat = parentQuat.clone().multiply(faceQuat)

      const localPos = new THREE.Vector3(plankCenterX, plankY, localZ)
      localPos.addScaledVector(
        plankNormal,
        ISLAND_SHELF_PLANK_THICKNESS / 2 + CASSETTE_DIMENSIONS.height / 2 + 0.002
      )
      localPos.applyQuaternion(parentQuat)
      localPos.add(parentPos)

      const cassetteKey = `${keyPrefix}-${side}-${row}-${col}`
      const posterUrl = film.poster_path
        ? `https://image.tmdb.org/t/p/w185${film.poster_path}`
        : null

      data.push({
        cassetteKey,
        filmId: film.id,
        worldPosition: localPos,
        worldQuaternion: worldQuat,
        hoverOffsetZ: -0.08,
        posterUrl,
        fallbackColor: CASSETTE_COLORS[film.id % CASSETTE_COLORS.length],
      })
    }
  }

  addCassettes(filmsLeft, 'left', maxCopies)
  addCassettes(filmsRight, 'right', maxCopies)

  return data
}

export const Aisle = memo(function Aisle({ films, filmsByAisle }: AisleProps) {
  // ===== DISTRIBUTION PAR SECTION =====
  // Chaque section affiche exactement les films assignés à son allée en DB.
  // Pas de dérivation automatique — l'admin assigne manuellement via l'interface.
  const {
    nouveautesFilms, horreurSlice, sfSlice, classiquesSlice, bizarreSlice,
    animationSlice, actionSlice, aventureSlice, thrillerSlice, policierSlice,
    comedieSlice, romanceSlice, drameSlice,
  } = useMemo(() => ({
    nouveautesFilms: dedupeFilms(filmsByAisle.nouveautes),
    horreurSlice: dedupeFilms(filmsByAisle.horreur),
    sfSlice: dedupeFilms(filmsByAisle.sf),
    classiquesSlice: dedupeFilms(filmsByAisle.classiques),
    bizarreSlice: dedupeFilms(filmsByAisle.bizarre),
    animationSlice: dedupeFilms(filmsByAisle.animation),
    actionSlice: dedupeFilms(filmsByAisle.action),
    aventureSlice: dedupeFilms(filmsByAisle.aventure),
    thrillerSlice: dedupeFilms(filmsByAisle.thriller),
    policierSlice: dedupeFilms(filmsByAisle.policier),
    comedieSlice: dedupeFilms(filmsByAisle.comedie),
    romanceSlice: dedupeFilms(filmsByAisle.romance),
    drameSlice: dedupeFilms(filmsByAisle.drame),
  }), [filmsByAisle])

  // Poster image preloading is handled at module level in App.tsx
  // (starts as soon as TMDB API data arrives, before the user enters the store).

  // ===== TEXTURES =====
  const fireExtinguisherPanelTexture = useTexture('/panneau-extincteur.png')

  // Sol — Carrelage Kent octogone+cabochon noir 33×33cm (procédural Canvas2D)
  // 9m / 0.33m ≈ 27 carreaux en X, 8.5m / 0.33m ≈ 26 en Y
  const floorTextures = useMemo(() => generateKentTileTextures(27, 26, 256, 6), [])
  // Textures PBR - Murs (alignées sur la matière perçue depuis la devanture)
  const wallTextures = usePBRTextures('/textures/storefront', 4, 1.5, true)
  // Textures PBR - Bois (pour comptoir)
  const woodTextures = usePBRTextures('/textures/wood', 2, 1)

  // Textures PBR - Plafond (faux plafond dalles 60×60cm, généré Canvas2D)
  // Génère color + normal + roughness pour une seule dalle, tilé 15×14 sur la pièce
  const ceilingTextures = useMemo(() => {
    const SIZE = 512
    const GROOVE = 6 // groove width in pixels (T-bar joint)
    const BEVEL = 3  // bevel transition pixels

    // --- Helper: create canvas ---
    const makeCanvas = () => {
      const c = document.createElement('canvas')
      c.width = SIZE
      c.height = SIZE
      return c
    }

    // --- COLOR MAP: light cream tile + dark grooves + subtle speckle ---
    const colorCanvas = makeCanvas()
    const cCtx = colorCanvas.getContext('2d')!
    // Base tile color (light warm off-white, typical mineral fiber tile)
    cCtx.fillStyle = '#e2ddd6'
    cCtx.fillRect(0, 0, SIZE, SIZE)
    // Add subtle noise/speckle for mineral fiber texture
    const cImgData = cCtx.getImageData(0, 0, SIZE, SIZE)
    for (let i = 0; i < cImgData.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 18
      cImgData.data[i] = Math.max(0, Math.min(255, cImgData.data[i] + noise))
      cImgData.data[i + 1] = Math.max(0, Math.min(255, cImgData.data[i + 1] + noise))
      cImgData.data[i + 2] = Math.max(0, Math.min(255, cImgData.data[i + 2] + noise))
    }
    cCtx.putImageData(cImgData, 0, 0)
    // T-bar grooves (slightly metallic white/gray)
    cCtx.fillStyle = '#b0aaa0'
    cCtx.fillRect(0, 0, GROOVE, SIZE)         // left edge
    cCtx.fillRect(0, 0, SIZE, GROOVE)         // top edge
    // Groove shadow line (inner edge = darker)
    cCtx.fillStyle = '#8a857e'
    cCtx.fillRect(GROOVE, GROOVE, 1, SIZE - GROOVE)    // left inner shadow
    cCtx.fillRect(GROOVE, GROOVE, SIZE - GROOVE, 1)    // top inner shadow

    const colorTex = new THREE.CanvasTexture(colorCanvas)
    colorTex.wrapS = THREE.RepeatWrapping
    colorTex.wrapT = THREE.RepeatWrapping
    colorTex.repeat.set(15, 14)
    colorTex.colorSpace = THREE.SRGBColorSpace

    // --- NORMAL MAP: flat tile surface + indented grooves ---
    const normalCanvas = makeCanvas()
    const nCtx = normalCanvas.getContext('2d')!
    // Flat surface: (128, 128, 255) = straight up
    nCtx.fillStyle = 'rgb(128, 128, 255)'
    nCtx.fillRect(0, 0, SIZE, SIZE)
    // Groove normals — left groove
    // Left face of groove: normal points right (+X = R>128)
    nCtx.fillStyle = 'rgb(200, 128, 255)'
    nCtx.fillRect(GROOVE, 0, BEVEL, SIZE)
    // Top face of groove: normal points down (+Y = G>128)
    nCtx.fillStyle = 'rgb(128, 200, 255)'
    nCtx.fillRect(0, GROOVE, SIZE, BEVEL)
    // Inside groove: pointing up-left (recessed)
    nCtx.fillStyle = 'rgb(80, 80, 200)'
    nCtx.fillRect(0, 0, GROOVE, GROOVE)
    // Add very subtle noise to tile surface normal for micro-texture
    const nImgData = nCtx.getImageData(0, 0, SIZE, SIZE)
    for (let y = GROOVE + BEVEL; y < SIZE; y++) {
      for (let x = GROOVE + BEVEL; x < SIZE; x++) {
        const idx = (y * SIZE + x) * 4
        nImgData.data[idx] += (Math.random() - 0.5) * 6     // slight X perturbation
        nImgData.data[idx + 1] += (Math.random() - 0.5) * 6 // slight Y perturbation
      }
    }
    nCtx.putImageData(nImgData, 0, 0)

    const normalTex = new THREE.CanvasTexture(normalCanvas)
    normalTex.wrapS = THREE.RepeatWrapping
    normalTex.wrapT = THREE.RepeatWrapping
    normalTex.repeat.set(15, 14)

    // --- ROUGHNESS MAP: matte tiles (bright = rough) + smoother grooves ---
    const roughCanvas = makeCanvas()
    const rCtx = roughCanvas.getContext('2d')!
    // Tile surface: roughness ~0.85 (matte mineral fiber)
    rCtx.fillStyle = 'rgb(217, 217, 217)'
    rCtx.fillRect(0, 0, SIZE, SIZE)
    // Grooves: slightly smoother (painted metal T-bar)
    rCtx.fillStyle = 'rgb(140, 140, 140)'
    rCtx.fillRect(0, 0, GROOVE, SIZE)
    rCtx.fillRect(0, 0, SIZE, GROOVE)

    const roughTex = new THREE.CanvasTexture(roughCanvas)
    roughTex.wrapS = THREE.RepeatWrapping
    roughTex.wrapT = THREE.RepeatWrapping
    roughTex.repeat.set(15, 14)

    return { map: colorTex, normalMap: normalTex, roughnessMap: roughTex }
  }, [])

  useEffect(() => {
    return () => {
      Object.values(ceilingTextures).forEach(t => (t as THREE.Texture).dispose())
    }
  }, [ceilingTextures])

  // Îlot 2: SF + Classiques
  const sfIslandLeft = useMemo(() => sfSlice, [sfSlice])
  const classiquesIslandRight = useMemo(() => classiquesSlice, [classiquesSlice])
  const nouveautesLeft = useMemo(() => {
    const half = Math.ceil(nouveautesFilms.length / 2)
    return nouveautesFilms.slice(0, half)
  }, [nouveautesFilms])
  const nouveautesRight = useMemo(() => {
    const half = Math.ceil(nouveautesFilms.length / 2)
    return nouveautesFilms.slice(half)
  }, [nouveautesFilms])

  // Extraire les poster_path pour les affiches murales
  const posterPaths = useMemo(() => {
    return films
      .filter(f => f.poster_path)
      .slice(0, 12)
      .map(f => f.poster_path)
  }, [films])

  const leftLongLength = (3.5 - SECTION_GAP) / 2
  const leftLongOffset = leftLongLength / 2 + SECTION_GAP / 2
  const leftMediumLength = (2.5 - SECTION_GAP) / 2
  const leftMediumOffset = leftMediumLength / 2 + SECTION_GAP / 2
  const leftEqualSectionLength = (leftLongLength + leftMediumLength) / 2
  const leftEqualSectionOffset = leftEqualSectionLength / 2 + SECTION_GAP / 2
  const horreurExtraWidth = WALL_CASSETTE_SPACING
  const horreurLength = leftEqualSectionLength + horreurExtraWidth
  const horreurCenterZ = -1.80 - leftEqualSectionOffset - horreurExtraWidth / 2
  const bizarreCenterZ = -1.80 + leftEqualSectionOffset
  const northLongLength = (3.5 - SECTION_GAP) / 2
  const northLongOffset = northLongLength / 2 + SECTION_GAP / 2
  const northMediumLength = (2.5 - SECTION_GAP) / 2
  const northMediumOffset = northMediumLength / 2 + SECTION_GAP / 2
  const rightLongLength = (4 - SECTION_GAP) / 2
  const rightLongOffset = rightLongLength / 2 + SECTION_GAP / 2
  // Keep wall panels close to the wall, but still in front of the wall-shelf planks.
  // Shelf front face from wall = WALL_SHELF_OFFSET + SHELF_DEPTH/2 + PLANK_DEPTH - PLANK_OVERLAP.
  // Add a small safety margin so the suspended sign does not get hidden behind the K7 rows.
  const wallPanelInset = WALL_SHELF_OFFSET + SHELF_DEPTH / 2 + PLANK_DEPTH - 0.005 + 0.06
  const panelWidthLong = 1.215
  const panelWidthMedium = 1.0125
  const panelWidthPolar = 1.12
  const panelWidthIsland = 1.44
  const panelWidthBizarre = 1.42
  const wallPanelY = 2.36 * 0.95
  const islandPanelY = 2.36 * 0.95

  // Storefront vitrine posters — handpicked iconic films (right-to-left from inside = left-to-right local)
  // Top row (6): Shining, Scream, Parasite, Back to the Future, Die Hard, Terminator 2
  // Bottom row (3): Demolition Man, Apocalypto, A Clockwork Orange
  const vitrinePosterPaths = useMemo(() => [
    '/uAR0AWqhQL1hQa69UDEbb2rE5Wx.jpg', // The Shining
    '/lr9ZIrmuwVmZhpZuTCW8D9g0ZJe.jpg', // Scream
    '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', // Parasite
    '/vN5B5WgYscRGcQpVhHl6p9DDTP0.jpg', // Back to the Future
    '/7Bjd8kfmDSOzpmhySpEhkUyK2oH.jpg', // Die Hard
    '/jFTVD4XoWQTcg7wdyJKa8PEds5q.jpg', // Terminator 2
    '/6TbMfJueFlfwdn8pURQdcugjUFC.jpg', // Demolition Man
    '/cRY25Q32kDNPFDkFkxAs6bgCq3L.jpg', // Apocalypto
    '/4sHeTAp65WrSSuc05nRBKddhBxO.jpg', // A Clockwork Orange
  ], [])

  // ===== CASSETTE INSTANCE DATA — PRE-COMPUTED IN USEMEMO =====
  // All cassette positions are computed synchronously here, eliminating the
  // previous 2-frame delay from the shelf callback cascade (mount → useEffect → callback → setState).
  const allCassetteData = useMemo(() => {
    const all: CassetteInstanceData[] = []

    // WallShelf: Horreur + Bizarre
    all.push(...computeWallShelfCassettes(
      [-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, horreurCenterZ], [0, Math.PI / 2, 0], horreurLength, horreurSlice
    ))
    all.push(...computeWallShelfCassettes(
      [-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, bizarreCenterZ], [0, Math.PI / 2, 0], leftEqualSectionLength, bizarreSlice
    ))

    // WallShelf: Polar + Thriller (positions inverted)
    all.push(...computeWallShelfCassettes(
      [-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, 1.29 - leftEqualSectionOffset], [0, Math.PI / 2, 0], leftEqualSectionLength, policierSlice
    ))
    all.push(...computeWallShelfCassettes(
      [-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, 1.29 + leftEqualSectionOffset], [0, Math.PI / 2, 0], leftEqualSectionLength, thrillerSlice
    ))

    // WallShelf: Action + Aventure
    all.push(...computeWallShelfCassettes(
      [-2.25 - northLongOffset, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET], [0, 0, 0], northLongLength, actionSlice
    ))
    all.push(...computeWallShelfCassettes(
      [-2.25 + northLongOffset, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET], [0, 0, 0], northLongLength, aventureSlice
    ))

    // WallShelf: Animation + Drame (positions inverted)
    all.push(...computeWallShelfCassettes(
      [1.25 - northMediumOffset, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET], [0, 0, 0], northMediumLength, animationSlice
    ))
    all.push(...computeWallShelfCassettes(
      [1.25 + northMediumOffset, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET], [0, 0, 0], northMediumLength, drameSlice
    ))

    // WallShelf: Comédie + Romance
    all.push(...computeWallShelfCassettes(
      [ROOM_WIDTH / 2 - WALL_SHELF_OFFSET, 0, -1.5 - rightLongOffset], [0, -Math.PI / 2, 0], rightLongLength, comedieSlice
    ))
    all.push(...computeWallShelfCassettes(
      [ROOM_WIDTH / 2 - WALL_SHELF_OFFSET, 0, -1.5 + rightLongOffset], [0, -Math.PI / 2, 0], rightLongLength, romanceSlice
    ))

    // IslandShelf: Nouveautés (2 copies per film)
    all.push(...computeIslandShelfCassettes(
      [-2.1, 0, 0], [0, 0, 0], nouveautesLeft, nouveautesRight, 'island', true, 2
    ))
    // IslandShelf 2: SF (left) + Classiques (right)
    all.push(...computeIslandShelfCassettes(
      [0.15, 0, 0], [0, 0, 0], sfIslandLeft, classiquesIslandRight, 'island2'
    ))

    return all
  // ROOM_WIDTH & ROOM_DEPTH in deps: ensures recomputation when room dimensions change (HMR cache fix)
  }, [actionSlice, animationSlice, aventureSlice, bizarreCenterZ, bizarreSlice, classiquesIslandRight, comedieSlice, drameSlice, horreurCenterZ, horreurLength, horreurSlice, leftEqualSectionLength, northLongLength, northLongOffset, northMediumLength, northMediumOffset, nouveautesLeft, nouveautesRight, policierSlice, rightLongLength, rightLongOffset, romanceSlice, sfIslandLeft, ROOM_WIDTH, ROOM_DEPTH])

  return (
    <group>
      {/* ===== SOL ===== */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial
          map={floorTextures.map}
          normalMap={floorTextures.normalMap}
          color="#c8c0b8"
          roughness={0.13}
          metalness={0.02}
          envMapIntensity={0.55}
          normalScale={[0.8, 0.8] as unknown as THREE.Vector2}
        />
      </mesh>

      {/* ===== PLAFOND — Faux plafond dalles 60×60cm (Canvas2D procedural) ===== */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM_HEIGHT, 0]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial
          map={ceilingTextures.map}
          normalMap={ceilingTextures.normalMap}
          roughnessMap={ceilingTextures.roughnessMap}
          color="#c0b8b0"
          roughness={0.95}
          normalScale={[0.6, 0.6] as unknown as THREE.Vector2}
        />
      </mesh>

      {/* ===== MURS ===== */}

      {/* Mur d'entrée (sud) avec vitrine 3D — PBR wall + glass + posters + neon */}
      <Storefront
        position={[0, 0, ROOM_DEPTH / 2]}
        roomWidth={ROOM_WIDTH}
        roomHeight={ROOM_HEIGHT}
        posterPaths={vitrinePosterPaths}
      />

      {/* 3 murs (nord + gauche + droit) fusionnés en 1 mesh — mergeGeometries */}
      <MergedWalls
        wallTextures={wallTextures}
        roomWidth={ROOM_WIDTH}
        roomDepth={ROOM_DEPTH}
        roomHeight={ROOM_HEIGHT}
      />

      {/* Consolidated animation loop for all genre panels (7 useFrame → 1) */}
      <GenrePanelAnimator />

      {/* ========================================= */}
      {/* ===== SECTION HORREUR + BIZARRE - MUR GAUCHE ===== */}
      {/* ========================================= */}
      <group>
        {/* Panneau HORREUR suspendu */}
        <GenreSectionPanel
          genre="Horreur"
          position={[-ROOM_WIDTH / 2 + wallPanelInset, wallPanelY, horreurCenterZ]}
          rotation={[0, Math.PI / 2, 0]}
          color={GENRE_CONFIG.horreur.color}
          width={panelWidthLong}
          hanging={true}
          intensityScale={0.85}
        />

        <GenreSectionPanel
          genre="Bizarre"
          position={[-ROOM_WIDTH / 2 + wallPanelInset, wallPanelY, bizarreCenterZ]}
          rotation={[0, Math.PI / 2, 0]}
          color={GENRE_CONFIG.bizarre.color}
          width={panelWidthBizarre}
          hanging={true}
          intensityScale={0.9}
        />

        {/* Étagères Horreur */}
        <WallShelf
          position={[-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, horreurCenterZ]}
          rotation={[0, Math.PI / 2, 0]}
          length={horreurLength}
          woodTextures={woodTextures}
        />

        {/* Étagères Bizarre */}
        <WallShelf
          position={[-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, bizarreCenterZ]}
          rotation={[0, Math.PI / 2, 0]}
          length={leftEqualSectionLength}
          woodTextures={woodTextures}
        />
      </group>

      {/* ========================================== */}
      {/* ===== SECTION THRILLER + POLICIER - MUR GAUCHE ===== */}
      {/* ========================================== */}
      <group>
        <GenreSectionPanel
          genre="Polar"
          position={[-ROOM_WIDTH / 2 + wallPanelInset, wallPanelY, 1.29 - leftEqualSectionOffset]}
          rotation={[0, Math.PI / 2, 0]}
          color={GENRE_CONFIG.policier.color}
          width={panelWidthPolar}
          hanging={true}
        />

        <GenreSectionPanel
          genre="Thriller"
          position={[-ROOM_WIDTH / 2 + wallPanelInset, wallPanelY, 1.29 + leftEqualSectionOffset]}
          rotation={[0, Math.PI / 2, 0]}
          color={GENRE_CONFIG.thriller.color}
          width={panelWidthMedium}
          hanging={true}
        />

        {/* Étagères Thriller */}
        <WallShelf
          position={[-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, 1.29 - leftEqualSectionOffset]}
          rotation={[0, Math.PI / 2, 0]}
          length={leftEqualSectionLength}
          woodTextures={woodTextures}
        />

        {/* Étagères Policier */}
        <WallShelf
          position={[-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, 1.29 + leftEqualSectionOffset]}
          rotation={[0, Math.PI / 2, 0]}
          length={leftEqualSectionLength}
          woodTextures={woodTextures}
        />
      </group>

      {/* ======================================== */}
      {/* ===== SECTION ACTION + AVENTURE - MUR DU FOND ===== */}
      {/* ======================================== */}
      <group>
        <GenreSectionPanel
          genre="Action"
          position={[-2.25 - northLongOffset, wallPanelY, -ROOM_DEPTH / 2 + wallPanelInset]}
          rotation={[0, 0, 0]}
          color={GENRE_CONFIG.action.color}
          width={panelWidthLong}
          hanging={true}
          intensityScale={0.80}
        />

        <GenreSectionPanel
          genre="Aventure"
          position={[-2.25 + northLongOffset, wallPanelY, -ROOM_DEPTH / 2 + wallPanelInset]}
          rotation={[0, 0, 0]}
          color={GENRE_CONFIG.aventure.color}
          width={panelWidthLong}
          hanging={true}
          intensityScale={0.82}
        />

        {/* Étagères Action */}
        <WallShelf
          position={[-2.25 - northLongOffset, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET]}
          rotation={[0, 0, 0]}
          length={northLongLength}
          woodTextures={woodTextures}
        />

        {/* Étagères Aventure */}
        <WallShelf
          position={[-2.25 + northLongOffset, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET]}
          rotation={[0, 0, 0]}
          length={northLongLength}
          woodTextures={woodTextures}
        />
      </group>

      {/* ===== EXTINCTEUR - ENTRE ACTION ET DRAME ===== */}
      <group position={[-0.26, 0, -ROOM_DEPTH / 2 + 0.1]}>
        {/* Panneau extincteur */}
        <mesh position={[0, 1.7, 0]}>
          <planeGeometry args={[0.3, 0.3]} />
          <meshStandardMaterial map={fireExtinguisherPanelTexture} />
        </mesh>
        {/* Extincteur 3D - lazy loading */}
        <Suspense fallback={null}>
          <AsyncModel
            url="/models/fire_extinguisher.glb"
            position={[0, 1.0, 0.15]}
            scale={0.0015}
          />
        </Suspense>
      </group>

      {/* ======================================= */}
      {/* ===== SECTION DRAME + ANIMATION - MUR DU FOND ===== */}
      {/* ======================================= */}
      <group>
        <GenreSectionPanel
          genre="Anim & Cie"
          position={[1.25 - northMediumOffset, wallPanelY, -ROOM_DEPTH / 2 + wallPanelInset]}
          rotation={[0, 0, 0]}
          color={GENRE_CONFIG.animation.color}
          width={panelWidthMedium}
          hanging={true}
          intensityScale={0.85}
        />

        <GenreSectionPanel
          genre="Drame"
          position={[1.25 + northMediumOffset, wallPanelY, -ROOM_DEPTH / 2 + wallPanelInset]}
          rotation={[0, 0, 0]}
          color={GENRE_CONFIG.drame.color}
          width={panelWidthMedium}
          hanging={true}
          intensityScale={0.80}
        />

        {/* Étagères Drame */}
        <WallShelf
          position={[1.25 - northMediumOffset, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET]}
          rotation={[0, 0, 0]}
          length={northMediumLength}
          woodTextures={woodTextures}
        />

        {/* Étagères Animation */}
        <WallShelf
          position={[1.25 + northMediumOffset, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET]}
          rotation={[0, 0, 0]}
          length={northMediumLength}
          woodTextures={woodTextures}
        />
      </group>

      {/* ========================================= */}
      {/* ===== SECTION COMÉDIE + ROMANCE - MUR DROIT ===== */}
      {/* ========================================= */}
      <group>
        <GenreSectionPanel
          genre="Comédie"
          position={[ROOM_WIDTH / 2 - wallPanelInset, wallPanelY, -1.5 - rightLongOffset]}
          rotation={[0, -Math.PI / 2, 0]}
          color={GENRE_CONFIG.comedie.color}
          width={panelWidthLong}
          hanging={true}
        />

        <GenreSectionPanel
          genre="Romance"
          position={[ROOM_WIDTH / 2 - wallPanelInset, wallPanelY, -1.5 + rightLongOffset]}
          rotation={[0, -Math.PI / 2, 0]}
          color={GENRE_CONFIG.romance.color}
          width={panelWidthLong}
          hanging={true}
          intensityScale={0.84}
        />

        {/* Étagères Comédie */}
        <WallShelf
          position={[ROOM_WIDTH / 2 - WALL_SHELF_OFFSET, 0, -1.5 - rightLongOffset]}
          rotation={[0, -Math.PI / 2, 0]}
          length={rightLongLength}
          woodTextures={woodTextures}
        />

        {/* Étagères Romance */}
        <WallShelf
          position={[ROOM_WIDTH / 2 - WALL_SHELF_OFFSET, 0, -1.5 + rightLongOffset]}
          rotation={[0, -Math.PI / 2, 0]}
          length={rightLongLength}
          woodTextures={woodTextures}
        />
      </group>

      {/* ===== ÎLOT CENTRAL - NOUVEAUTÉS (MEILLEURS FILMS TMDB) ===== */}
      {/* Top films TMDB des 10 dernières années par note (fallback: catalogue local) */}
      <IslandShelf
        position={[-2.1, 0, 0]}
        woodTextures={woodTextures}
      />

      {/* Panneau NOUVEAUTÉS double face — fixé au plafond au-dessus de l'îlot */}
      {/* Face visible depuis la droite (+X) */}
      <GenreSectionPanel
        genre="Nouveautés"
        position={[-2.08, islandPanelY, 0]}
        rotation={[0, Math.PI / 2, 0]}
        color="#ff00ff"
        width={panelWidthIsland}
        hanging={true}
      />
      {/* Face visible depuis la gauche (-X) */}
      <GenreSectionPanel
        genre="Nouveautés"
        position={[-2.12, islandPanelY, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        color="#ff00ff"
        width={panelWidthIsland}
        hanging={true}
      />

      {/* ===== ÎLOT 2 - SF + CLASSIQUES ===== */}
      <IslandShelf
        position={[0.15, 0, 0]}
        woodTextures={woodTextures}
      />
      {/* Panneau SF — fixé au plafond */}
      <GenreSectionPanel
        genre="Sf"
        position={[0.13, islandPanelY, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        color="#00ccff"
        width={panelWidthIsland}
        hanging={true}
        intensityScale={0.90}
      />
      {/* Panneau CLASSIQUES — fixé au plafond */}
      <GenreSectionPanel
        genre="Classiques"
        position={[0.17, islandPanelY, 0]}
        rotation={[0, Math.PI / 2, 0]}
        color="#d4af37"
        width={panelWidthIsland}
        hanging={true}
      />


      {/* ===== COMPTOIR MANAGER ===== */}
      <group position={[ROOM_WIDTH / 2 - 2.3, 0, ROOM_DEPTH / 2 - 1.28]}>
        {/* Comptoir simple — longueur 2.7m, largeur 0.49m */}
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.7, 1, 0.49]} />
          <meshPhysicalMaterial
            map={woodTextures.map}
            normalMap={woodTextures.normalMap}
            roughnessMap={woodTextures.roughnessMap}
            color="#6b4c33"
            roughness={0.25}
            clearcoat={0.45}
            clearcoatRoughness={0.12}
            normalScale={[0.7, 0.7] as unknown as THREE.Vector2}
          />
        </mesh>
        <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.7, 0.05, 0.63]} />
          <meshPhysicalMaterial
            map={woodTextures.map}
            normalMap={woodTextures.normalMap}
            roughnessMap={woodTextures.roughnessMap}
            color="#3d2a1a"
            roughness={0.20}
            clearcoat={0.50}
            normalScale={[0.7, 0.7] as unknown as THREE.Vector2}
          />
        </mesh>

        {/* Caisse enregistreuse */}
        <group position={[0.8, 1.08, 0]}>
          <mesh position={[0, 0.1, 0]}>
            <boxGeometry args={[0.35, 0.2, 0.3]} />
            <meshStandardMaterial color="#2a2a2e" metalness={0.15} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.25, 0.05]}>
            <boxGeometry args={[0.25, 0.08, 0.02]} />
            <meshStandardMaterial color="#00ff00" emissive="#00ff00" emissiveIntensity={0.3} />
          </mesh>
          <mesh position={[0, 0.02, 0.18]}>
            <boxGeometry args={[0.3, 0.04, 0.06]} />
            <meshStandardMaterial color="#444444" roughness={0.6} metalness={0.2} />
          </mesh>
        </group>

        {/* Sonnette sur le comptoir */}
        <ServiceBell position={[0.2, 1.08, 0.25]} rotation={[0, Math.PI, 0]} />

        {/* Moniteur de surveillance */}
        <group position={[-0.9, 1.08, -0.1]}>
          <mesh position={[0, 0.12, 0]}>
            <boxGeometry args={[0.3, 0.22, 0.2]} />
            <meshStandardMaterial color="#1a1a20" metalness={0.10} roughness={0.30} />
          </mesh>
          <mesh position={[0, 0.12, 0.11]}>
            <planeGeometry args={[0.25, 0.18]} />
            <meshStandardMaterial color="#1a1a2a" emissive="#0044aa" emissiveIntensity={0.2} />
          </mesh>
        </group>

        {/* Pile de 3 K7 VHS noires empilées à plat */}
        <group position={[-0.3, 1.08, 0.15]}>
          {[0, 1, 2].map((i) => (
            <mesh key={`return-${i}`} position={[0, i * 0.032, 0]} rotation={[0, [-0.08, 0.05, -0.12][i], 0]} geometry={DESK_VHS_GEO} material={DESK_VHS_MAT} />
          ))}
        </group>

        {/* RICK - Le Gérant 3D */}
        <Manager3D position={[0, 0, 0.8]} rotation={[0, Math.PI, 0]} />
      </group>

      {/* ===== ÉTAGÈRE CONTRE MUR FAÇADE ===== */}
      <group position={[ROOM_WIDTH / 2 - 0.15, 0, ROOM_DEPTH / 2 - 0.05]} rotation={[0, -Math.PI / 2, 0]}>
        <AsyncModel url="/models/shelf.glb" position={[0, 0, 0]} scale={1} />
      </group>

      {/* ===== LABEL "La Zone TV" au-dessus de la CRT ===== */}
      <mesh position={[ROOM_WIDTH / 2 - 0.3, 2.42, ROOM_DEPTH / 2 - 0.3]} rotation={[0, (65 + 180) * Math.PI / 180, 0]}>
        <planeGeometry args={[0.6, 0.18]} />
        <meshBasicMaterial transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide}>
          <canvasTexture
            attach="map"
            image={(() => {
              const canvas = document.createElement('canvas')
              canvas.width = 512
              canvas.height = 128
              const ctx = canvas.getContext('2d')!
              ctx.font = 'bold 48px monospace'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.shadowColor = '#00ffcc'
              ctx.shadowBlur = 4
              ctx.fillStyle = '#00ffcc'
              ctx.fillText('La Zone TV', 256, 44)
              ctx.font = 'bold 52px monospace'
              ctx.shadowColor = '#ff44aa'
              ctx.shadowBlur = 4
              ctx.fillStyle = '#ff44aa'
              ctx.fillText('▼', 256, 100)
              return canvas
            })()}
          />
        </meshBasicMaterial>
      </mesh>

      {/* ===== CRT TV La Zone TV — coin façade/droite ===== */}
      <LaZoneCRT
        position={[ROOM_WIDTH / 2 - 0.3, 1.8, ROOM_DEPTH / 2 - 0.3]}
        rotation={[0, 65 * Math.PI / 180, 0]}
        tilt={-10}
      />

      {/* ===== PORTE PRIVÉE ===== */}
      <group position={[ROOM_WIDTH / 2 - 1.05, 0, -ROOM_DEPTH / 2 + 0.08]}>
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[0.8, 2, 0.08]} />
          <meshStandardMaterial
            map={woodTextures.map}
            normalMap={woodTextures.normalMap}
            roughnessMap={woodTextures.roughnessMap}
            color="#5a1a1a"
            roughness={0.6}
            normalScale={[0.5, 0.5] as unknown as THREE.Vector2}
          />
        </mesh>
        {/* Écriteau PRIVÉE */}
        <PrivateSign position={[0, 1.5, 0.05]} />
      </group>

      {/* ===== PORTE D'ENTRÉE (indication) ===== */}
      <group position={[-ROOM_WIDTH / 2 + 1.26, 0, ROOM_DEPTH / 2 - 0.08]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -0.4]}>
          <planeGeometry args={[1.5, 0.8]} />
          <meshStandardMaterial color="#2a4a2a" roughness={0.5} />
        </mesh>
      </group>

      {/* ===== AFFICHES DE FILMS ===== */}
      <PosterWall
        position={[ROOM_WIDTH / 2 - 1.05, 2.39, -ROOM_DEPTH / 2 + 0.15]}
        rotation={[0, 0, 0]}
        posterPaths={posterPaths.slice(3, 6)}
        spacing={0.55}
      />


      {/* ===== TV DISPLAY INTERACTIVE ===== */}
      <InteractiveTVDisplay
        position={[ROOM_WIDTH / 2 - 0.275, 0, 1.2]}
        rotation={[0, -Math.PI / 2, 0]}
      />

      {/* ===== BOARD — behind TV, against wall (interactive) ===== */}
      <Suspense fallback={null}>
        <BoardMesh
          position={[ROOM_WIDTH / 2 - 0.02, 1.25, 1.4]}
          scale={0.7}
          rotation={[0, -Math.PI / 2, 0]}
        />
      </Suspense>

      {/* ===== DÉTAILS DU SOL — Paillasson d'entrée ===== */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-ROOM_WIDTH / 2 + 1.33, 0.005, ROOM_DEPTH / 2 - 0.8]}>
        <planeGeometry args={[2, 1.2]} />
        <meshStandardMaterial
          color="#3a2215"
          roughness={0.95}
        />
      </mesh>

      {/* ===== CORBEILLE À PAPIER — métal brossé ===== */}
      <group position={[ROOM_WIDTH / 2 - 1, 0, ROOM_DEPTH / 2 - 0.8]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.15, 0.12, 0.4, 8]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.4} />
        </mesh>
      </group>

      {/* ===== PULP FICTION - À l'entrée, avant la section Thriller ===== */}
      <Suspense fallback={null}>
        <AsyncModel
          url="/models/pulp_fiction.glb"
          position={[-ROOM_WIDTH / 2 + 0.45, 0, 3.33]}
          scale={0.05}
          rotation={[0, Math.PI, 0]}
        />
      </Suspense>

      {/* ===== SPOT LIGHT au-dessus de Pulp Fiction ===== */}
      <Suspense fallback={null}>
        <AsyncModel
          url="/models/spot_light.glb"
          position={[-ROOM_WIDTH / 2 + 0.15, 1.575, 3.33]}
          scale={0.3}
          rotation={[0, 0, -Math.PI / 12]}
        />
      </Suspense>

      {/* ===== TOUTES LES CASSETTES — InstancedMesh avec atlas 2D ===== */}
      {allCassetteData.length > 0 && (
        <CassetteInstances
          instances={allCassetteData}
        />
      )}

      {/* ===== PARTICULES DE POUSSIÈRE — atmosphère intérieure ===== */}
      <DustParticles count={250} />
    </group>
  )
})
