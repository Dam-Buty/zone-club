import { useMemo, useEffect, Suspense } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGLTF, useTexture } from '@react-three/drei'

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
import { WallShelf } from './WallShelf'
import { IslandShelf } from './IslandShelf'
import { CassetteInstances } from './CassetteInstances'
import { CASSETTE_DIMENSIONS } from './Cassette'
import { GenreSectionPanel, GENRE_CONFIG, filterFilmsByGenre } from './GenreSectionPanel'
import { GameRack } from './GameBox'
import { PosterWall } from './Poster'
import { Storefront } from './Storefront'
import { InteractiveTVDisplay } from './InteractiveTVDisplay'
import { Manager3D } from './Manager3D'
import { ServiceBell } from './ServiceBell'
import type { Film } from '../../types'
import type { CassetteInstanceData } from '../../utils/CassetteTextureArray'

interface AisleProps {
  films: Film[]
}

// Dimensions de la pièce (basées sur le plan PDF, réduites de 30%)
const ROOM_WIDTH = 11  // x axis
const ROOM_DEPTH = 8.5 // z axis
const ROOM_HEIGHT = 2.8

// Hook pour charger un set de textures PBR avec tiling
function usePBRTextures(
  basePath: string,
  repeatX: number,
  repeatY: number,
  hasAO = false
) {
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
      // Anisotropic filtering: sharpen textures viewed at oblique angles (floors, walls)
      // Minimal GPU cost for significant quality improvement on tiled surfaces
      t.anisotropy = 16
      // Color map needs sRGB, others are linear data
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

// OPTIMISATION: 3 murs (nord + gauche + droit) fusionnés en 1 seul mesh (3→1 draw call)
const MERGED_WALLS_MAT = new THREE.MeshStandardMaterial({ color: '#1e1e28' })

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
    MERGED_WALLS_MAT.map = wallTextures.map
    MERGED_WALLS_MAT.normalMap = wallTextures.normalMap
    MERGED_WALLS_MAT.roughnessMap = wallTextures.roughnessMap
    MERGED_WALLS_MAT.aoMap = wallTextures.aoMap ?? null
    MERGED_WALLS_MAT.normalScale = new THREE.Vector2(0.6, 0.6)
    MERGED_WALLS_MAT.needsUpdate = true
    return MERGED_WALLS_MAT
  }, [wallTextures])

  useEffect(() => {
    return () => { geometry.dispose() }
  }, [geometry])

  return <mesh geometry={geometry} material={material} receiveShadow />
}

// OPTIMISATION: 2 marches d'escalier fusionnées en 1 mesh (2→1 draw call)
const STAIRS_MAT = new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.8 })

function MergedStairs({ position }: { position: [number, number, number] }) {
  const geometry = useMemo(() => {
    const step1 = new THREE.BoxGeometry(1, 0.16, 1)
    step1.translate(0, 0.08, 0)
    const step2 = new THREE.BoxGeometry(0.7, 0.16, 1)
    step2.translate(0.15, 0.24, 0)
    return mergeGeometries([step1, step2])!
  }, [])

  useEffect(() => {
    return () => { geometry.dispose() }
  }, [geometry])

  return <mesh position={position} geometry={geometry} material={STAIRS_MAT} />
}

// ===== CASSETTE POSITION PRE-COMPUTATION =====
// Pure functions that compute cassette instance data synchronously in useMemo,
// eliminating the 2-frame delay from the previous shelf callback cascade
// (mount → useEffect → callback → wait-for-all-6 → setState → re-render).

// WallShelf constants (must match WallShelf.tsx)
const WALL_ROWS = 5
const WALL_ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.12
const WALL_SHELF_DEPTH = 0.38
const WALL_CASSETTE_SPACING = CASSETTE_DIMENSIONS.width + 0.02

// IslandShelf constants (must match IslandShelf.tsx)
const ISLAND_ROWS = 4
const ISLAND_CASSETTES_PER_ROW = 12
const ISLAND_ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.08
const ISLAND_HEIGHT_CONST = 1.6
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

  const parentQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0], rotation[1], rotation[2])
  )
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
    const localZ = WALL_SHELF_DEPTH / 2 + 0.02

    const worldPos = new THREE.Vector3(localX, localY, localZ)
    worldPos.applyQuaternion(parentQuat)
    worldPos.add(parentPos)

    const cassetteKey = `wall-${position[0].toFixed(1)}-${position[2].toFixed(1)}-${row}-${col}`
    const posterUrl = film.poster_path
      ? `https://image.tmdb.org/t/p/w200${film.poster_path}`
      : null

    data.push({
      cassetteKey,
      filmId: film.id,
      worldPosition: worldPos,
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
  filmsRight: Film[]
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

      const cassetteKey = `island-${side}-${row}-${col}`
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

  // Textures PBR - Sol (carrelage sombre, tiling 6x5 pour la taille de la pièce)
  const floorTextures = usePBRTextures('/textures/floor', 6, 5)
  // Textures PBR - Murs (plâtre peint, tiling adapté par mur)
  const wallTextures = usePBRTextures('/textures/wall', 4, 2, true)
  // Textures PBR - Bois (pour comptoir)
  const woodTextures = usePBRTextures('/textures/wood', 2, 1)

  // ===== FILTRER LES FILMS PAR GENRE =====
  // Memoize each genre slice individually to avoid new array refs on every render
  const filmsByGenre = useMemo(() => {
    const horreur = filterFilmsByGenre(films, 'horreur')
    const thriller = filterFilmsByGenre(films, 'thriller')
    const action = filterFilmsByGenre(films, 'action')
    const comedie = filterFilmsByGenre(films, 'comedie')
    const drame = filterFilmsByGenre(films, 'drame')

    return { horreur, thriller, action, comedie, drame }
  }, [films])

  // Memoize sliced film arrays to prevent new refs each render (avoids infinite useEffect loops)
  const horreurSlice = useMemo(() => filmsByGenre.horreur.slice(0, 25), [filmsByGenre.horreur])
  const thrillerSlice = useMemo(() => filmsByGenre.thriller.slice(0, 18), [filmsByGenre.thriller])
  const actionSlice = useMemo(() => filmsByGenre.action.slice(0, 30), [filmsByGenre.action])
  const drameSlice = useMemo(() => filmsByGenre.drame.slice(0, 22), [filmsByGenre.drame])
  const comedieSlice = useMemo(() => filmsByGenre.comedie.slice(0, 28), [filmsByGenre.comedie])
  const nouveautesLeft = useMemo(() => nouveautesFilms.slice(0, 15), [nouveautesFilms])
  const nouveautesRight = useMemo(() => nouveautesFilms.slice(15, 30), [nouveautesFilms])

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

    // WallShelf: Horreur
    all.push(...computeWallShelfCassettes(
      [-ROOM_WIDTH / 2 + 0.4, 0, -1.54], [0, Math.PI / 2, 0], 3.5, horreurSlice
    ))
    // WallShelf: Thriller
    all.push(...computeWallShelfCassettes(
      [-ROOM_WIDTH / 2 + 0.4, 0, 1.29], [0, Math.PI / 2, 0], 2.5, thrillerSlice
    ))
    // WallShelf: Action
    all.push(...computeWallShelfCassettes(
      [-2.5, 0, -ROOM_DEPTH / 2 + 0.4], [0, 0, 0], 4, actionSlice
    ))
    // WallShelf: Drame
    all.push(...computeWallShelfCassettes(
      [1.5, 0, -ROOM_DEPTH / 2 + 0.4], [0, 0, 0], 3, drameSlice
    ))
    // WallShelf: Comédie
    all.push(...computeWallShelfCassettes(
      [ROOM_WIDTH / 2 - 0.4, 0, -1.5], [0, -Math.PI / 2, 0], 4, comedieSlice
    ))
    // IslandShelf: Nouveautés
    all.push(...computeIslandShelfCassettes(
      [-0.8, 0, 0], [0, 0, 0], nouveautesLeft, nouveautesRight
    ))

    return all
  }, [horreurSlice, thrillerSlice, actionSlice, drameSlice, comedieSlice, nouveautesLeft, nouveautesRight])

  return (
    <group>
      {/* ===== SOL ===== */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial
          map={floorTextures.map}
          normalMap={floorTextures.normalMap}
          roughnessMap={floorTextures.roughnessMap}
          color="#3a3a4a"
          roughness={0.6}
          metalness={0.05}
          normalScale={[0.8, 0.8] as unknown as THREE.Vector2}
        />
      </mesh>

      {/* ===== PLAFOND ===== */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM_HEIGHT, 0]}>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial color="#1a1a2a" roughness={0.9} />
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

      {/* ========================================= */}
      {/* ===== SECTION HORREUR - MUR GAUCHE ===== */}
      {/* ========================================= */}
      <group>
        {/* Panneau HORREUR suspendu - décalé vers la droite */}
        <GenreSectionPanel
          genre="HORREUR"
          position={[-ROOM_WIDTH / 2 + 1.14, 2.07, -0.93]}
          rotation={[0, Math.PI / 2, 0]}
          color={GENRE_CONFIG.horreur.color}
          width={1.8}
          hanging={true}
        />

        {/* Étagères Horreur - mur gauche */}
        <WallShelf
          position={[-ROOM_WIDTH / 2 + 0.4, 0, -1.54]}
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
          position={[-ROOM_WIDTH / 2 + 0.4, 0, 1.29]}
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
          position={[-2.5, 2.07, -ROOM_DEPTH / 2 + 1.14]}
          rotation={[0, 0, 0]}
          color={GENRE_CONFIG.action.color}
          width={1.8}
          hanging={true}
        />

        {/* Étagères Action - partie gauche du mur du fond */}
        <WallShelf
          position={[-2.5, 0, -ROOM_DEPTH / 2 + 0.4]}
          rotation={[0, 0, 0]}
          length={4}
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
          position={[1.5, 2.07, -ROOM_DEPTH / 2 + 1.14]}
          rotation={[0, 0, 0]}
          color={GENRE_CONFIG.drame.color}
          width={1.5}
          hanging={true}
        />

        {/* Étagères Drame - partie droite du mur du fond (avant la porte) */}
        <WallShelf
          position={[1.5, 0, -ROOM_DEPTH / 2 + 0.4]}
          rotation={[0, 0, 0]}
          length={3}
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
          position={[ROOM_WIDTH / 2 - 0.4, 0, -1.5]}
          rotation={[0, -Math.PI / 2, 0]}
          length={4}
        />
      </group>

      {/* ===== ÎLOT CENTRAL - NOUVEAUTÉS (MEILLEURS FILMS TMDB) ===== */}
      {/* Top films TMDB des 10 dernières années par note (fallback: catalogue local) */}
      <IslandShelf
        position={[-0.8, 0, 0]}
      />

      {/* Panneau NOUVEAUTÉS double face au-dessus de l'îlot central (aligné avec le meuble) */}
      {/* Face visible depuis la droite (+X) */}
      <GenreSectionPanel
        genre="NOUVEAUTÉS"
        position={[-0.78, 1.9, 0]}
        rotation={[0, Math.PI / 2, 0]}
        color="#ff00ff"
        width={1.6}
        hanging={true}
      />
      {/* Face visible depuis la gauche (-X) */}
      <GenreSectionPanel
        genre="NOUVEAUTÉS"
        position={[-0.82, 1.9, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        color="#ff00ff"
        width={1.6}
        hanging={false}
      />


      {/* ===== COMPTOIR MANAGER ===== */}
      <group position={[ROOM_WIDTH / 2 - 2.3, 0, ROOM_DEPTH / 2 - 1.5]}>
        {/* Comptoir simple */}
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[3, 1, 0.6]} />
          <meshStandardMaterial
            map={woodTextures.map}
            normalMap={woodTextures.normalMap}
            roughnessMap={woodTextures.roughnessMap}
            color="#4a3a2a"
            normalScale={[0.7, 0.7] as unknown as THREE.Vector2}
          />
        </mesh>
        <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[3, 0.05, 0.7]} />
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

        {/* Pile de cassettes retournées */}
        <group position={[-0.3, 1.08, 0.15]}>
          {[0, 1, 2].map((i) => (
            <mesh key={`return-${i}`} position={[(i - 1) * 0.06, i * 0.02, 0]} rotation={[0, 0.1 * (i - 1), 0]}>
              <boxGeometry args={[0.14, 0.02, 0.19]} />
              <meshStandardMaterial color={['#1a1a2e', '#16213e', '#0f3460'][i]} roughness={0.4} />
            </mesh>
          ))}
        </group>

        {/* QUENTIN - Le Gérant 3D */}
        <Manager3D position={[0, 0, 0.8]} rotation={[0, Math.PI, 0]} />
      </group>

      {/* ===== SECTION GAMES ===== */}
      <group position={[ROOM_WIDTH / 2 - 0.4, 0, 2.2]}>
        <GameRack position={[-0.15, 0, 0]} rotation={[0, -Math.PI / 2, 0]} />
      </group>

      {/* ===== MARCHES/ESCALIER — 2 boxes fusionnées en 1 mesh ===== */}
      <MergedStairs position={[ROOM_WIDTH / 2 - 0.7, 0, 3.5]} />

      {/* ===== PORTE PRIVÉE ===== */}
      <group position={[ROOM_WIDTH / 2 - 1.35, 0, -ROOM_DEPTH / 2 + 0.08]}>
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[0.8, 2, 0.08]} />
          <meshStandardMaterial color="#8B0000" roughness={0.5} />
        </mesh>
        {/* Écriteau PRIVÉE */}
        <PrivateSign position={[0, 1.5, 0.05]} />
      </group>

      {/* ===== PORTE D'ENTRÉE (indication) ===== */}
      <group position={[-ROOM_WIDTH / 2 + 1.86, 0, ROOM_DEPTH / 2 - 0.08]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -0.4]}>
          <planeGeometry args={[1.5, 0.8]} />
          <meshStandardMaterial color="#2a4a2a" roughness={0.5} />
        </mesh>
      </group>

      {/* ===== AFFICHES DE FILMS ===== */}
      <PosterWall
        position={[2.2, 2.3, ROOM_DEPTH / 2 - 0.15]}
        rotation={[0, Math.PI, 0]}
        posterPaths={posterPaths.slice(0, 9)}
        spacing={0.56}
        posterWidth={0.51}
        posterHeight={0.73}
      />
      <PosterWall
        position={[3.93, 2.39, -ROOM_DEPTH / 2 + 0.15]}
        rotation={[0, 0, 0]}
        posterPaths={posterPaths.slice(3, 6)}
        spacing={0.55}
      />

      {/* ===== TV DISPLAY INTERACTIVE ===== */}
      <InteractiveTVDisplay
        position={[ROOM_WIDTH / 2 - 0.5, 0, 1.2]}
        rotation={[0, -Math.PI / 2, 0]}
      />

      {/* ===== DÉTAILS DU SOL ===== */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-ROOM_WIDTH / 2 + 2.23, 0.005, ROOM_DEPTH / 2 - 0.8]}>
        <planeGeometry args={[2, 1.2]} />
        <meshStandardMaterial color="#4a2a1a" roughness={0.9} />
      </mesh>

      {/* ===== CORBEILLE À PAPIER ===== */}
      <group position={[ROOM_WIDTH / 2 - 1, 0, ROOM_DEPTH / 2 - 0.8]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.15, 0.12, 0.4, 6]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.7} />
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

      {/* ===== TOUTES LES CASSETTES — 1 seul InstancedMesh (520→1 draw call) ===== */}
      {allCassetteData.length > 0 && (
        <CassetteInstances instances={allCassetteData} />
      )}
    </group>
  )
}
