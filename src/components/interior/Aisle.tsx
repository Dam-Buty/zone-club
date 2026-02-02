import { useMemo, useEffect, useState } from 'react'
import * as THREE from 'three'
import { WallShelf } from './WallShelf'
import { IslandShelf } from './IslandShelf'
import { GenreSectionPanel, GENRE_CONFIG, filterFilmsByGenre } from './GenreSectionPanel'
import { GameRack } from './GameBox'
import { PosterWall } from './Poster'
import { InteractiveTVDisplay } from './InteractiveTVDisplay'
import { Manager3D } from './Manager3D'
import { ServiceBell } from './ServiceBell'
import { tmdb, type TMDBSearchResult } from '../../services/tmdb'
import type { Film } from '../../types'

interface AisleProps {
  films: Film[]
}

// Dimensions de la pièce (basées sur le plan PDF, réduites de 30%)
const ROOM_WIDTH = 11  // x axis
const ROOM_DEPTH = 8.5 // z axis
const ROOM_HEIGHT = 2.8

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

// Convertir un résultat TMDB en Film pour l'affichage
function tmdbResultToFilm(result: TMDBSearchResult): Film {
  return {
    id: result.id,
    tmdb_id: result.id,
    title: result.title,
    overview: result.overview,
    poster_path: result.poster_path,
    backdrop_path: result.backdrop_path,
    release_date: result.release_date,
    vote_average: result.vote_average,
    genres: [], // Non disponible dans les résultats de recherche TMDB
    runtime: null,
  }
}

export function Aisle({ films }: AisleProps) {
  // ===== FILMS TMDB TOP RATED POUR NOUVEAUTÉS =====
  const [tmdbNouveautes, setTmdbNouveautes] = useState<Film[]>([])
  const [tmdbLoading, setTmdbLoading] = useState(true)

  // Fallback: films locaux triés par note (si TMDB échoue)
  const localTopRated = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const tenYearsAgo = currentYear - 10

    return [...films]
      .filter(f => {
        if (!f.release_date) return true // garder les films sans date
        const releaseYear = new Date(f.release_date).getFullYear()
        return releaseYear >= tenYearsAgo
      })
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, 30)
  }, [films])

  // Charger les meilleurs films TMDB des 10 dernières années
  useEffect(() => {
    let cancelled = false

    async function loadTopRatedFilms() {
      try {
        // Récupérer 2 pages (40 films) pour remplir les 30 places de l'îlot
        const results = await tmdb.getTopRatedRecent(2)
        if (!cancelled && results.length > 0) {
          // Convertir en format Film et prendre les 30 premiers
          const filmsFromTmdb = results.slice(0, 30).map(tmdbResultToFilm)
          setTmdbNouveautes(filmsFromTmdb)
        }
        if (!cancelled) setTmdbLoading(false)
      } catch (error) {
        console.error('Erreur chargement films TMDB:', error)
        if (!cancelled) setTmdbLoading(false)
      }
    }

    loadTopRatedFilms()

    return () => {
      cancelled = true
    }
  }, [])

  // Films à afficher: TMDB si disponibles, sinon fallback sur catalogue local
  const nouveautesFilms = tmdbNouveautes.length > 0 ? tmdbNouveautes : localTopRated

  // ===== FILTRER LES FILMS PAR GENRE =====
  const filmsByGenre = useMemo(() => {
    const horreur = filterFilmsByGenre(films, 'horreur')
    const action = filterFilmsByGenre(films, 'action')
    const comedie = filterFilmsByGenre(films, 'comedie')
    const drame = filterFilmsByGenre(films, 'drame')

    return { horreur, action, comedie, drame }
  }, [films])

  // Extraire les poster_path pour les affiches murales
  const posterPaths = useMemo(() => {
    return films
      .filter(f => f.poster_path)
      .slice(0, 12)
      .map(f => f.poster_path)
  }, [films])

  // Texture de la devanture (vue depuis l'intérieur)
  const storefrontTexture = useMemo(() => {
    const loader = new THREE.TextureLoader()
    const tex = loader.load('/outside.jpeg')
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [])

  return (
    <group>
      {/* ===== SOL ===== */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial color="#3a3a4a" roughness={0.2} metalness={0.1} />
      </mesh>

      {/* ===== PLAFOND ===== */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM_HEIGHT, 0]}>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial color="#1a1a2a" roughness={0.9} />
      </mesh>

      {/* ===== MURS ===== */}

      {/* Mur d'entrée (sud) avec vitrine */}
      <mesh position={[0, ROOM_HEIGHT / 2, ROOM_DEPTH / 2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[ROOM_WIDTH, ROOM_HEIGHT]} />
        <meshStandardMaterial map={storefrontTexture} roughness={0.3} />
      </mesh>

      {/* Mur du fond (nord) */}
      <mesh position={[0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2]}>
        <planeGeometry args={[ROOM_WIDTH, ROOM_HEIGHT]} />
        <meshStandardMaterial color="#1e1e28" roughness={0.7} />
      </mesh>

      {/* Mur gauche (ouest) */}
      <mesh position={[-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[ROOM_DEPTH, ROOM_HEIGHT]} />
        <meshStandardMaterial color="#1e1e28" roughness={0.7} />
      </mesh>

      {/* Mur droit (est) */}
      <mesh position={[ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[ROOM_DEPTH, ROOM_HEIGHT]} />
        <meshStandardMaterial color="#1e1e28" roughness={0.7} />
      </mesh>

      {/* ========================================= */}
      {/* ===== SECTION HORREUR - MUR GAUCHE ===== */}
      {/* ========================================= */}
      <group>
        {/* Panneau HORREUR suspendu - reculé de 5% */}
        <GenreSectionPanel
          genre="HORREUR"
          position={[-ROOM_WIDTH / 2 + 1.14, 2.07, -1]}
          rotation={[0, Math.PI / 2, 0]}
          color={GENRE_CONFIG.horreur.color}
          width={1.8}
          hanging={true}
        />

        {/* Étagères Horreur - mur gauche partie nord */}
        <WallShelf
          position={[-ROOM_WIDTH / 2 + 0.4, 0, -1]}
          rotation={[0, Math.PI / 2, 0]}
          length={3.5}
          films={filmsByGenre.horreur.slice(0, 25)}
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
          films={filmsByGenre.action.slice(0, 30)}
        />
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
          films={filmsByGenre.drame.slice(0, 22)}
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
          films={filmsByGenre.comedie.slice(0, 28)}
        />
      </group>

      {/* ===== ÎLOT CENTRAL - NOUVEAUTÉS (MEILLEURS FILMS TMDB) ===== */}
      {/* Top films TMDB des 10 dernières années par note (fallback: catalogue local) */}
      <IslandShelf
        position={[-0.8, 0, 0]}
        filmsLeft={nouveautesFilms.slice(0, 15)}
        filmsRight={nouveautesFilms.slice(15, 30)}
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
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[3, 1, 0.6]} />
          <meshStandardMaterial color="#4a3a2a" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.05, 0]}>
          <boxGeometry args={[3, 0.05, 0.7]} />
          <meshStandardMaterial color="#2a2018" roughness={0.4} />
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

      {/* ===== MARCHES/ESCALIER ===== */}
      <group position={[ROOM_WIDTH / 2 - 0.7, 0, 3.5]}>
        <mesh position={[0, 0.08, 0]}>
          <boxGeometry args={[1, 0.16, 1]} />
          <meshStandardMaterial color="#3a3a3a" roughness={0.8} />
        </mesh>
        <mesh position={[0.15, 0.24, 0]}>
          <boxGeometry args={[0.7, 0.16, 1]} />
          <meshStandardMaterial color="#3a3a3a" roughness={0.8} />
        </mesh>
      </group>

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
      <group position={[-ROOM_WIDTH / 2 + 1, 0, ROOM_DEPTH / 2 - 0.08]}>
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-ROOM_WIDTH / 2 + 1.2, 0.005, ROOM_DEPTH / 2 - 0.8]}>
        <planeGeometry args={[2, 1.2]} />
        <meshStandardMaterial color="#4a2a1a" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <planeGeometry args={[0.1, ROOM_DEPTH - 2]} />
        <meshStandardMaterial color="#2a2a3a" roughness={0.7} />
      </mesh>

      {/* ===== CORBEILLE À PAPIER ===== */}
      <group position={[ROOM_WIDTH / 2 - 1, 0, ROOM_DEPTH / 2 - 0.8]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.15, 0.12, 0.4, 12]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.7} />
        </mesh>
      </group>

      {/* ===== PLANTE DÉCORATIVE ===== */}
      <group position={[-ROOM_WIDTH / 2 + 0.5, 0, -ROOM_DEPTH / 2 + 0.5]}>
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.12, 0.1, 0.3, 12]} />
          <meshStandardMaterial color="#8B4513" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.31, 0]}>
          <cylinderGeometry args={[0.11, 0.11, 0.02, 12]} />
          <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <sphereGeometry args={[0.2, 8, 6]} />
          <meshStandardMaterial color="#2a5a2a" roughness={0.8} />
        </mesh>
      </group>
    </group>
  )
}
