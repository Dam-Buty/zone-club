import { useMemo, useEffect, Suspense } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGLTF, useTexture } from '@react-three/drei'
import { generateKentTileTextures } from '../../utils/KentTileTexture'
import { LaZoneCRT } from './LaZoneCRT'

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
import { useKTX2Textures } from '../../hooks/useKTX2Textures'
import { WallShelf, SHELF_DEPTH, SHELF_TILT, SHELF_PIVOT_Y } from './WallShelf'
import { IslandShelf } from './IslandShelf'
import { CassetteInstances } from './CassetteInstances'
import { CASSETTE_DIMENSIONS } from './Cassette'
import { GenreSectionPanel, GenrePanelAnimator, GENRE_CONFIG, filterFilmsByGenre } from './GenreSectionPanel'
import { PosterWall } from './Poster'
import { Storefront } from './Storefront'
import { InteractiveTVDisplay } from './InteractiveTVDisplay'
import { Manager3D } from './Manager3D'
import { ServiceBell } from './ServiceBell'
import { DustParticles } from './DustParticles'
import type { Film } from '../../types'
import type { CassetteInstanceData } from '../../utils/CassetteTextureArray'

interface AisleProps {
  films: Film[]
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
    const next = new THREE.MeshStandardMaterial({ color: '#1e1e28' })
    next.map = wallTextures.map
    next.normalMap = wallTextures.normalMap
    next.roughnessMap = wallTextures.roughnessMap
    next.aoMap = wallTextures.aoMap ?? null
    next.normalScale.set(0.6, 0.6)
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
const PLANK_DEPTH = 0.10  // must match WallShelf.tsx PLANK_DEPTH
const WALL_ROWS = 5
const WALL_ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.12
const WALL_CASSETTE_SPACING = CASSETTE_DIMENSIONS.width + 0.02

// Pre-computed tilt quaternion for cassette positioning (same tilt as WallShelf inner group)
const _tiltQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-SHELF_TILT, 0, 0))

// IslandShelf constants (must match IslandShelf.tsx)
const ISLAND_ROWS = 4
const ISLAND_CASSETTES_PER_ROW = 12
const ISLAND_ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.08
const ISLAND_HEIGHT_CONST = 1.4
const ISLAND_BASE_WIDTH = 0.55
const ISLAND_TOP_WIDTH = 0.35
const ISLAND_CASSETTE_TILT = 0.15
const ISLAND_CASSETTE_SPACING = CASSETTE_DIMENSIONS.width + 0.02

const CASSETTE_COLORS = [
  '#1a1a2e', '#16213e', '#0f3460', '#533483',
  '#2c3e50', '#34495e', '#1e3d59', '#3d5a80'
]

function computeWallShelfCassettes(
  position: [number, number, number],
  rotation: [number, number, number],
  length: number,
  films: Film[]
): CassetteInstanceData[] {
  if (films.length === 0) return []

  const cassettesPerRow = Math.floor((length - 0.1) / WALL_CASSETTE_SPACING)
  const totalCapacity = cassettesPerRow * WALL_ROWS
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

    const filmIndex = index % Math.max(films.length, 1)
    const film = films[filmIndex]
    if (!film) continue

    const localX = (col - cassettesPerRow / 2 + 0.5) * WALL_CASSETTE_SPACING
    const localY = 0.25 + row * WALL_ROW_HEIGHT
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
      ? `https://image.tmdb.org/t/p/w200${film.poster_path}`
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
  keyPrefix = 'island'
): CassetteInstanceData[] {
  if (filmsLeft.length === 0 && filmsRight.length === 0) return []

  const totalCapacityPerSide = ISLAND_CASSETTES_PER_ROW * ISLAND_ROWS
  const data: CassetteInstanceData[] = []

  const parentQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0], rotation[1], rotation[2])
  )
  const parentPos = new THREE.Vector3(position[0], position[1], position[2])

  const addCassettes = (films: Film[], side: 'left' | 'right') => {
    for (let index = 0; index < totalCapacityPerSide; index++) {
      const row = Math.floor(index / ISLAND_CASSETTES_PER_ROW)
      const col = index % ISLAND_CASSETTES_PER_ROW
      if (row >= ISLAND_ROWS) continue

      const filmIndex = index % Math.max(films.length, 1)
      const film = films[filmIndex]
      if (!film) continue

      const y = 0.34 + row * ISLAND_ROW_HEIGHT
      const widthAtHeight = ISLAND_BASE_WIDTH - (ISLAND_BASE_WIDTH - ISLAND_TOP_WIDTH) * (y / ISLAND_HEIGHT_CONST)

      let localX: number
      let groupRotY: number
      let groupRotZ: number
      if (side === 'left') {
        localX = -widthAtHeight / 2 - 0.06
        groupRotY = Math.PI / 2
        groupRotZ = -ISLAND_CASSETTE_TILT
      } else {
        localX = widthAtHeight / 2 + 0.06
        groupRotY = -Math.PI / 2
        groupRotZ = ISLAND_CASSETTE_TILT
      }
      const localZ = (col - ISLAND_CASSETTES_PER_ROW / 2 + 0.5) * ISLAND_CASSETTE_SPACING

      const groupQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, groupRotY, groupRotZ)
      )
      const worldQuat = parentQuat.clone().multiply(groupQuat)

      const worldPos = new THREE.Vector3(localX, y, localZ)
      worldPos.applyQuaternion(parentQuat)
      worldPos.add(parentPos)

      const cassetteKey = `${keyPrefix}-${side}-${row}-${col}`
      const posterUrl = film.poster_path
        ? `https://image.tmdb.org/t/p/w200${film.poster_path}`
        : null

      data.push({
        cassetteKey,
        filmId: film.id,
        worldPosition: worldPos,
        worldQuaternion: worldQuat,
        hoverOffsetZ: -0.08,
        posterUrl,
        fallbackColor: CASSETTE_COLORS[film.id % CASSETTE_COLORS.length],
      })
    }
  }

  addCassettes(filmsLeft, 'left')
  addCassettes(filmsRight, 'right')

  return data
}

export function Aisle({ films }: AisleProps) {
  // ===== FILMS POUR NOUVEAUTÉS (ÎLOT CENTRAL) =====
  // Uses films from the store's "nouveautes" aisle (already fetched in App.tsx alongside other aisles).
  // No separate TMDB fetch — avoids a second allCassetteData recomputation that caused
  // the visual glitch (cassettes appear → go black → reload).
  const nouveautesFilms = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const tenYearsAgo = currentYear - 10

    return [...films]
      .filter(f => {
        if (!f.release_date) return true
        const releaseYear = new Date(f.release_date).getFullYear()
        return releaseYear >= tenYearsAgo
      })
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, 30)
  }, [films])

  // Poster image preloading is handled at module level in App.tsx
  // (starts as soon as TMDB API data arrives, before the user enters the store).

  // ===== TEXTURES =====
  const fireExtinguisherPanelTexture = useTexture('/panneau-extincteur.png')

  // Sol — Carrelage Kent octogone+cabochon noir 33×33cm (procédural Canvas2D)
  // 9m / 0.33m ≈ 27 carreaux en X, 8.5m / 0.33m ≈ 26 en Y
  const floorTextures = useMemo(() => generateKentTileTextures(27, 26, 256, 6), [])
  // Textures PBR - Murs (plâtre peint, tiling adapté par mur)
  const wallTextures = usePBRTextures('/textures/wall', 4, 2, true)
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

  // ===== FILTRER LES FILMS PAR GENRE =====
  // Memoize each genre slice individually to avoid new array refs on every render
  const filmsByGenre = useMemo(() => {
    const horreur = filterFilmsByGenre(films, 'horreur')
    const thriller = filterFilmsByGenre(films, 'thriller')
    const action = filterFilmsByGenre(films, 'action')
    const comedie = filterFilmsByGenre(films, 'comedie')
    const drame = filterFilmsByGenre(films, 'drame')
    const sf = filterFilmsByGenre(films, 'sf')
    const classiques = filterFilmsByGenre(films, 'classiques')
      .filter(f => {
        if (!f.release_date) return false
        return new Date(f.release_date).getFullYear() < 1990
      })

    return { horreur, thriller, action, comedie, drame, sf, classiques }
  }, [films])

  // Memoize sliced film arrays to prevent new refs each render (avoids infinite useEffect loops)
  const horreurSlice = useMemo(() => filmsByGenre.horreur.slice(0, 25), [filmsByGenre.horreur])
  const thrillerSlice = useMemo(() => filmsByGenre.thriller.slice(0, 18), [filmsByGenre.thriller])
  const actionSlice = useMemo(() => filmsByGenre.action.slice(0, 30), [filmsByGenre.action])
  const drameSlice = useMemo(() => filmsByGenre.drame.slice(0, 22), [filmsByGenre.drame])
  const comedieSlice = useMemo(() => filmsByGenre.comedie.slice(0, 28), [filmsByGenre.comedie])
  const sfSlice = useMemo(() => filmsByGenre.sf.slice(0, 24), [filmsByGenre.sf])
  const classiquesSlice = useMemo(() => filmsByGenre.classiques.slice(0, 24), [filmsByGenre.classiques])
  // Island 2: SF (left side) + Classiques (right side)
  const sfIslandLeft = useMemo(() => {
    const half = Math.ceil(sfSlice.length / 2)
    return sfSlice.slice(0, half)
  }, [sfSlice])
  const classiquesIslandRight = useMemo(() => {
    return classiquesSlice
  }, [classiquesSlice])
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

    // WallShelf: Horreur (Z=-1.80: moved back 0.26 to eliminate 17cm overlap with Thriller shelf)
    all.push(...computeWallShelfCassettes(
      [-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, -1.80], [0, Math.PI / 2, 0], 3.5, horreurSlice
    ))
    // WallShelf: Thriller
    all.push(...computeWallShelfCassettes(
      [-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, 1.29], [0, Math.PI / 2, 0], 2.5, thrillerSlice
    ))
    // WallShelf: Action
    all.push(...computeWallShelfCassettes(
      [-2.25, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET], [0, 0, 0], 3.5, actionSlice
    ))
    // WallShelf: Drame
    all.push(...computeWallShelfCassettes(
      [1.25, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET], [0, 0, 0], 2.5, drameSlice
    ))
    // WallShelf: Comédie
    all.push(...computeWallShelfCassettes(
      [ROOM_WIDTH / 2 - WALL_SHELF_OFFSET, 0, -1.5], [0, -Math.PI / 2, 0], 4, comedieSlice
    ))
    // IslandShelf: Nouveautés
    all.push(...computeIslandShelfCassettes(
      [-1.6, 0, 0], [0, 0, 0], nouveautesLeft, nouveautesRight
    ))
    // IslandShelf 2: SF (left) + Classiques (right)
    all.push(...computeIslandShelfCassettes(
      [0.65, 0, -0.3], [0, 0, 0], sfIslandLeft, classiquesIslandRight, 'island2'
    ))

    return all
  // ROOM_WIDTH & ROOM_DEPTH in deps: ensures recomputation when room dimensions change (HMR cache fix)
  }, [horreurSlice, thrillerSlice, actionSlice, drameSlice, comedieSlice, nouveautesLeft, nouveautesRight, sfIslandLeft, classiquesIslandRight, ROOM_WIDTH, ROOM_DEPTH])

  return (
    <group>
      {/* ===== SOL ===== */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial
          map={floorTextures.map}
          normalMap={floorTextures.normalMap}
          color="#d8d0cc"
          roughness={0.12}
          metalness={0.02}
          envMapIntensity={0.4}
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
          color="#c8c0b8"
          roughness={0.92}
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
      {/* ===== SECTION HORREUR - MUR GAUCHE ===== */}
      {/* ========================================= */}
      <group>
        {/* Panneau HORREUR suspendu - reculé avec le meuble */}
        <GenreSectionPanel
          genre="HORREUR"
          position={[-ROOM_WIDTH / 2 + 1.14, 2.07, -1.19]}
          rotation={[0, Math.PI / 2, 0]}
          color={GENRE_CONFIG.horreur.color}
          width={1.8}
          hanging={true}
        />

        {/* Étagères Horreur - mur gauche (reculé vers le fond pour ne plus chevaucher Thriller) */}
        <WallShelf
          position={[-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, -1.80]}
          rotation={[0, Math.PI / 2, 0]}
          length={3.5}
        />
      </group>

      {/* ========================================== */}
      {/* ===== SECTION THRILLER - MUR GAUCHE ===== */}
      {/* ========================================== */}
      <group>
        {/* Panneau THRILLER suspendu - décalé vers la facade */}
        <GenreSectionPanel
          genre="THRILLER"
          position={[-ROOM_WIDTH / 2 + 1.14, 2.07, 1.58]}
          rotation={[0, Math.PI / 2, 0]}
          color={GENRE_CONFIG.thriller.color}
          width={1.5}
          hanging={true}
        />

        {/* Étagères Thriller - mur gauche */}
        <WallShelf
          position={[-ROOM_WIDTH / 2 + WALL_SHELF_OFFSET, 0, 1.29]}
          rotation={[0, Math.PI / 2, 0]}
          length={2.5}
        />
      </group>

      {/* ======================================== */}
      {/* ===== SECTION ACTION - MUR DU FOND ===== */}
      {/* ======================================== */}
      <group>
        {/* Panneau ACTION suspendu - reculé de 5% */}
        <GenreSectionPanel
          genre="ACTION"
          position={[-2.25, 2.07, -ROOM_DEPTH / 2 + 1.14]}
          rotation={[0, 0, 0]}
          color={GENRE_CONFIG.action.color}
          width={1.8}
          hanging={true}
        />

        {/* Étagères Action - partie gauche du mur du fond */}
        <WallShelf
          position={[-2.25, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET]}
          rotation={[0, 0, 0]}
          length={3.5}
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
      {/* ===== SECTION DRAME - MUR DU FOND ===== */}
      {/* ======================================= */}
      <group>
        {/* Panneau DRAME suspendu - reculé de 5% */}
        <GenreSectionPanel
          genre="DRAME"
          position={[1.25, 2.07, -ROOM_DEPTH / 2 + 1.14]}
          rotation={[0, 0, 0]}
          color={GENRE_CONFIG.drame.color}
          width={1.5}
          hanging={true}
        />

        {/* Étagères Drame - partie droite du mur du fond (avant la porte) */}
        <WallShelf
          position={[1.25, 0, -ROOM_DEPTH / 2 + WALL_SHELF_OFFSET]}
          rotation={[0, 0, 0]}
          length={2.5}
        />
      </group>

      {/* ========================================= */}
      {/* ===== SECTION COMÉDIE - MUR DROIT ===== */}
      {/* ========================================= */}
      <group>
        {/* Panneau COMÉDIE suspendu - reculé de 5% */}
        <GenreSectionPanel
          genre="COMÉDIE"
          position={[ROOM_WIDTH / 2 - 1.14, 2.07, -1.5]}
          rotation={[0, -Math.PI / 2, 0]}
          color={GENRE_CONFIG.comedie.color}
          width={1.8}
          hanging={true}
        />

        {/* Étagères Comédie - mur droit partie nord */}
        <WallShelf
          position={[ROOM_WIDTH / 2 - WALL_SHELF_OFFSET, 0, -1.5]}
          rotation={[0, -Math.PI / 2, 0]}
          length={4}
        />
      </group>

      {/* ===== ÎLOT CENTRAL - NOUVEAUTÉS (MEILLEURS FILMS TMDB) ===== */}
      {/* Top films TMDB des 10 dernières années par note (fallback: catalogue local) */}
      <IslandShelf
        position={[-1.6, 0, 0]}
      />

      {/* Panneau NOUVEAUTÉS double face — fixé au plafond au-dessus de l'îlot */}
      {/* Face visible depuis la droite (+X) */}
      <GenreSectionPanel
        genre="NOUVEAUTÉS"
        position={[-1.58, 2.07, 0]}
        rotation={[0, Math.PI / 2, 0]}
        color="#ff00ff"
        width={1.6}
        hanging={true}
      />
      {/* Face visible depuis la gauche (-X) */}
      <GenreSectionPanel
        genre="NOUVEAUTÉS"
        position={[-1.62, 2.07, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        color="#ff00ff"
        width={1.6}
        hanging={true}
      />

      {/* ===== ÎLOT 2 - SF + CLASSIQUES ===== */}
      <IslandShelf
        position={[0.65, 0, -0.3]}
      />
      {/* Panneau SF — fixé au plafond */}
      <GenreSectionPanel
        genre="SF"
        position={[0.63, 2.07, -0.3]}
        rotation={[0, -Math.PI / 2, 0]}
        color="#00ccff"
        width={1.6}
        hanging={true}
      />
      {/* Panneau CLASSIQUES — fixé au plafond */}
      <GenreSectionPanel
        genre="CLASSIQUES"
        position={[0.67, 2.07, -0.3]}
        rotation={[0, Math.PI / 2, 0]}
        color="#d4af37"
        width={1.6}
        hanging={true}
      />


      {/* ===== COMPTOIR MANAGER ===== */}
      <group position={[ROOM_WIDTH / 2 - 2.3, 0, ROOM_DEPTH / 2 - 1.28]}>
        {/* Comptoir simple — longueur 2.7m, largeur 0.49m */}
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.7, 1, 0.49]} />
          <meshStandardMaterial
            map={woodTextures.map}
            normalMap={woodTextures.normalMap}
            roughnessMap={woodTextures.roughnessMap}
            color="#4a3a2a"
            normalScale={[0.7, 0.7] as unknown as THREE.Vector2}
          />
        </mesh>
        <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.7, 0.05, 0.63]} />
          <meshStandardMaterial
            map={woodTextures.map}
            normalMap={woodTextures.normalMap}
            roughnessMap={woodTextures.roughnessMap}
            color="#2a2018"
            roughness={0.4}
            normalScale={[0.7, 0.7] as unknown as THREE.Vector2}
          />
        </mesh>

        {/* Caisse enregistreuse */}
        <group position={[0.8, 1.08, 0]}>
          <mesh position={[0, 0.1, 0]}>
            <boxGeometry args={[0.35, 0.2, 0.3]} />
            <meshStandardMaterial color="#333333" roughness={0.5} metalness={0.3} />
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
            <meshStandardMaterial color="#222222" roughness={0.4} />
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

      {/* Lumière chaude projetée sur Pulp Fiction depuis la lampe */}
      <pointLight
        position={[-ROOM_WIDTH / 2 + 0.15, 1.55, 3.33]}
        color="#ffaa66"
        intensity={6.4}
        distance={2.5}
        decay={2.5}
      />

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
}
