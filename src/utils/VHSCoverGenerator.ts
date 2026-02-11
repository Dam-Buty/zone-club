import * as THREE from 'three'
import type { Film } from '../types'
import { tmdb, type TMDBImage } from '../services/tmdb'
import { preloadPosterImage } from './CassetteTextureArray'

// ---- Canvas & UV Layout Constants ----
const TEX_SIZE = 1024

// Face regions in canvas pixel coordinates { x, y, w, h }
const FRONT = { x: 614, y: 117, w: 395, h: 712 }
const BACK  = { x: 117, y: 117, w: 395, h: 712 }
const SPINE1 = { x: 15, y: 117, w: 102, h: 712 }
const SPINE2 = { x: 512, y: 117, w: 102, h: 712 }
const TOP_EDGE = { x: 117, y: 15, w: 395, h: 102 }
const BOTTOM_EDGE = { x: 117, y: 829, w: 395, h: 102 }

// Notch safe zone — top center of front face where tape is visible through jacket cutout
// Content drawn here is hidden by the physical notch, so skip important elements
const NOTCH_BOTTOM = 58

// ---- Studio name → canonical TMDB company ID (for entries without logo_path) ----
const STUDIO_ALIASES: Record<string, number> = {
  '20th century fox': 25,
  'twentieth century fox': 25,
  'twentieth century-fox productions': 25,
  'twentieth century fox film corporation': 25,
  '20th century studios': 25,
  'warner bros.': 174,
  'warner bros': 174,
  'warner bros. pictures': 174,
  'warner bros. entertainment': 174,
  'universal pictures': 33,
  'universal studios': 33,
  'paramount pictures': 4,
  'paramount': 4,
  'columbia pictures': 5,
  'columbia pictures corporation': 5,
  'columbia pictures industries': 5,
  'walt disney pictures': 2,
  'disney': 2,
  'metro-goldwyn-mayer': 8411,
  'mgm': 8411,
  'metro goldwyn mayer': 8411,
  'new line cinema': 12,
  'lionsgate': 1632,
  'lionsgate films': 1632,
  'miramax': 14,
  'miramax films': 14,
  'dreamworks': 7,
  'dreamworks pictures': 7,
  'dreamworks animation': 521,
  'touchstone pictures': 9195,
  'tristar pictures': 559,
  'tri-star pictures': 559,
  'orion pictures': 41,
  'united artists': 60,
  'amblin entertainment': 56,
  'legendary pictures': 923,
  'legendary entertainment': 923,
  'lucasfilm': 1,
  'lucasfilm ltd.': 1,
  'pixar': 3,
  'pixar animation studios': 3,
  'marvel studios': 420,
  'marvel enterprises': 420,
  'dc films': 128064,
  'dc entertainment': 128064,
  'a24': 41077,
  'blumhouse productions': 3172,
  'focus features': 10146,
  'fox searchlight pictures': 43,
  'fox searchlight': 43,
  'canal+': 104,
  'gaumont': 9,
  'pathé': 130,
  'studiocanal': 694,
  'europacorp': 109,
}

// ---- Local color studio logos (TMDB company ID → local file) ----
// These IDs have color logos in public/studio-logos/{id}.png
const LOCAL_STUDIO_LOGOS = new Set([
  25,     // 20th Century Fox
  174,    // Warner Bros.
  33,     // Universal Pictures
  4,      // Paramount Pictures
  5,      // Columbia Pictures
  2,      // Walt Disney Pictures
  8411,   // MGM
  12,     // New Line Cinema
  1632,   // Lionsgate
  14,     // Miramax
  7,      // DreamWorks
  521,    // DreamWorks Animation
  9195,   // Touchstone Pictures
  559,    // TriStar Pictures
  41,     // Orion Pictures
  60,     // United Artists
  56,     // Amblin Entertainment
  923,    // Legendary Pictures
  1,      // Lucasfilm
  3,      // Pixar
  420,    // Marvel Studios
  128064, // DC Studios
  41077,  // A24
  3172,   // Blumhouse Productions
  10146,  // Focus Features
  43,     // Searchlight Pictures
  104,    // Canal+
  9,      // Gaumont
  130,    // Pathé
  694,    // StudioCanal
])

/** Get the best logo URL for a production company: local color → TMDB → company endpoint */
async function resolveStudioLogoUrl(
  company: { id: number; name: string; logo_path: string | null }
): Promise<string | null> {
  // 1. Always resolve canonical ID via alias
  const aliasId = STUDIO_ALIASES[company.name.toLowerCase()]
  const canonicalId = aliasId || company.id

  // 2. Local color logo ALWAYS takes priority over TMDB monochrome
  if (LOCAL_STUDIO_LOGOS.has(canonicalId)) {
    return `/studio-logos/${canonicalId}.png`
  }
  if (LOCAL_STUDIO_LOGOS.has(company.id)) {
    return `/studio-logos/${company.id}.png`
  }

  // 3. TMDB logo_path from movie endpoint
  if (company.logo_path) {
    return `https://image.tmdb.org/t/p/w200${company.logo_path}`
  }

  // 4. Fallback: fetch from /company/{id}
  return tmdb.getCompanyLogo(canonicalId)
}

// ---- VHS Template System ----

interface VHSTemplate {
  name: string
  frontBg: string[]
  accentColor: string
  titleColor: string
  posterLayout: 'full-bleed' | 'centered-padded' | 'offset-left'
  showTagline: boolean
  borderStyle: 'neon-lines' | 'thick-band' | 'none' | 'double-stripe'
  backBg: string[]
  screenshotLayout: 'hero-row' | 'asymmetric' | 'sidebar' | 'scattered'
  spineBg: string[]
  spineAccent: string
}

const TEMPLATES: VHSTemplate[] = [
  // 0: Neon Classic (Terminator Thorn EMI)
  {
    name: 'Neon Classic',
    frontBg: ['#0d0020', '#0a0a18', '#050510'],
    accentColor: '#ff2d95',
    titleColor: '#ffffff',
    posterLayout: 'full-bleed',
    showTagline: true,
    borderStyle: 'neon-lines',
    backBg: ['#050510', '#0a0a18', '#0d0020'],
    screenshotLayout: 'hero-row',
    spineBg: ['#1a0030', '#250040', '#1a0030'],
    spineAccent: '#ff2d95',
  },
  // 1: Blockbuster Bold (Rocky II Warner)
  {
    name: 'Blockbuster Bold',
    frontBg: ['#1a0000', '#0a0000', '#050000'],
    accentColor: '#cc0000',
    titleColor: '#ffd700',
    posterLayout: 'full-bleed',
    showTagline: false,
    borderStyle: 'thick-band',
    backBg: ['#0a0000', '#0f0505', '#0a0000'],
    screenshotLayout: 'asymmetric',
    spineBg: ['#cc0000', '#8b0000', '#cc0000'],
    spineAccent: '#ffd700',
  },
  // 2: Epic Saga (Return of the Jedi CBS/Fox)
  {
    name: 'Epic Saga',
    frontBg: ['#0a0a1a', '#050510', '#020208'],
    accentColor: '#c8a000',
    titleColor: '#ffffff',
    posterLayout: 'full-bleed',
    showTagline: true,
    borderStyle: 'double-stripe',
    backBg: ['#020208', '#0a0a15', '#050510'],
    screenshotLayout: 'sidebar',
    spineBg: ['#0a0a1a', '#14142a', '#0a0a1a'],
    spineAccent: '#c8a000',
  },
  // 3: Comedy Pop (Ghostbusters CEL)
  {
    name: 'Comedy Pop',
    frontBg: ['#003333', '#004d4d', '#002828'],
    accentColor: '#00e5cc',
    titleColor: '#ffffff',
    posterLayout: 'full-bleed',
    showTagline: true,
    borderStyle: 'none',
    backBg: ['#002828', '#003838', '#002020'],
    screenshotLayout: 'scattered',
    spineBg: ['#004d4d', '#006666', '#004d4d'],
    spineAccent: '#00e5cc',
  },
  // 4: Foreign Edition (Predator 2 Fox NL)
  {
    name: 'Foreign Edition',
    frontBg: ['#0f0800', '#0a0500', '#050300'],
    accentColor: '#ff6600',
    titleColor: '#ffffff',
    posterLayout: 'full-bleed',
    showTagline: false,
    borderStyle: 'thick-band',
    backBg: ['#050300', '#0a0800', '#0f0a00'],
    screenshotLayout: 'hero-row',
    spineBg: ['#0f0800', '#1a0f00', '#0f0800'],
    spineAccent: '#ff6600',
  },
  // 5: Retro Industrial (RoboCop Argentine)
  {
    name: 'Retro Industrial',
    frontBg: ['#1a1a1a', '#222222', '#141414'],
    accentColor: '#888888',
    titleColor: '#cc0000',
    posterLayout: 'full-bleed',
    showTagline: false,
    borderStyle: 'thick-band',
    backBg: ['#141414', '#1a1a1a', '#111111'],
    screenshotLayout: 'asymmetric',
    spineBg: ['#1a1a1a', '#252525', '#1a1a1a'],
    spineAccent: '#cc0000',
  },
]

// ---- Helpers ----

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine)
      if (lines.length >= maxLines) {
        lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+\S*$/, '') + '...'
        return lines
      }
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

function drawStars(ctx: CanvasRenderingContext2D, rating: number, x: number, y: number, size: number) {
  const fullStars = Math.floor(rating / 2)
  const halfStar = (rating / 2) % 1 >= 0.5
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = (i < fullStars || (i === fullStars && halfStar)) ? '#ffd700' : 'rgba(255,215,0,0.2)'
    ctx.font = `${size}px sans-serif`
    ctx.fillText('\u2605', x + i * (size + 2), y)
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  try {
    return await preloadPosterImage(url)
  } catch {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
  }
}

function coverCropImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number
) {
  const imgAspect = img.width / img.height
  const targetAspect = w / h
  let sx = 0, sy = 0, sw = img.width, sh = img.height
  if (imgAspect > targetAspect) {
    sw = img.height * targetAspect
    sx = (img.width - sw) / 2
  } else {
    sh = img.width / targetAspect
    sy = (img.height - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

function drawFramedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number,
  frameColor: string
) {
  ctx.fillStyle = frameColor
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4)
  coverCropImage(ctx, img, x, y, w, h)
}

function fillGradient(ctx: CanvasRenderingContext2D, w: number, h: number, stops: string[]) {
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  if (stops.length === 2) {
    grad.addColorStop(0, stops[0])
    grad.addColorStop(1, stops[1])
  } else if (stops.length >= 3) {
    grad.addColorStop(0, stops[0])
    grad.addColorStop(0.5, stops[1])
    grad.addColorStop(1, stops[2])
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

function _drawBorder(ctx: CanvasRenderingContext2D, w: number, h: number, template: VHSTemplate) {
  switch (template.borderStyle) {
    case 'neon-lines':
      ctx.fillStyle = template.accentColor
      ctx.fillRect(0, 0, 2, h); ctx.fillRect(w - 2, 0, 2, h)
      ctx.globalAlpha = 0.4
      ctx.fillRect(0, 0, w, 2); ctx.fillRect(0, h - 2, w, 2)
      ctx.globalAlpha = 1.0
      break
    case 'thick-band':
      ctx.fillStyle = template.accentColor
      ctx.fillRect(0, 0, w, 6); ctx.fillRect(0, h - 6, w, 6)
      ctx.fillRect(0, 0, 4, h); ctx.fillRect(w - 4, 0, 4, h)
      break
    case 'double-stripe':
      ctx.fillStyle = template.accentColor
      ctx.fillRect(0, 0, 2, h); ctx.fillRect(4, 0, 1, h)
      ctx.fillRect(w - 2, 0, 2, h); ctx.fillRect(w - 5, 0, 1, h)
      ctx.fillRect(0, 0, w, 2); ctx.fillRect(0, 4, w, 1)
      ctx.fillRect(0, h - 2, w, 2); ctx.fillRect(0, h - 5, w, 1)
      break
    case 'none':
      break
  }
}

/** Draw MPAA/FR certification badge (rounded rect with text) */
function drawCertificationBadge(
  ctx: CanvasRenderingContext2D, cert: string,
  x: number, y: number, accentColor: string
) {
  if (!cert) return
  ctx.font = 'bold 14px sans-serif'
  const textW = ctx.measureText(cert).width
  const badgeW = textW + 12
  const badgeH = 20
  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.7)'
  ctx.beginPath()
  roundRect(ctx, x, y, badgeW, badgeH, 3)
  ctx.fill()
  // Border
  ctx.strokeStyle = accentColor
  ctx.lineWidth = 1.5
  ctx.beginPath()
  roundRect(ctx, x, y, badgeW, badgeH, 3)
  ctx.stroke()
  // Text
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.fillText(cert, x + badgeW / 2, y + 15)
}

/** Draw VHS VIDÉO format badge (top-right area) */
function drawVHSBadge(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, accentColor: string
) {
  const badgeW = 48
  const badgeH = 22
  // Background pill
  ctx.fillStyle = accentColor
  ctx.beginPath()
  roundRect(ctx, x, y, badgeW, badgeH, 3)
  ctx.fill()
  // VHS text
  ctx.font = 'bold 11px sans-serif'
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'
  ctx.fillText('VHS', x + badgeW / 2, y + 14)
}

/** Rounded rect helper (Canvas2D path) */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/** Draw runtime indicator bar */
function drawRuntimeBar(
  ctx: CanvasRenderingContext2D, runtime: number | null,
  x: number, y: number, maxW: number, accentColor: string
) {
  if (!runtime) return
  const barH = 4
  // Background track
  ctx.fillStyle = 'rgba(255,255,255,0.1)'
  ctx.fillRect(x, y, maxW, barH)
  // Fill proportional to runtime (scale: 60min=30%, 180min=100%)
  const ratio = Math.min(1, runtime / 180)
  ctx.fillStyle = accentColor
  ctx.fillRect(x, y, Math.round(maxW * ratio), barH)
  // Label
  ctx.font = '8px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.textAlign = 'right'
  ctx.fillText(`${runtime} min`, x + maxW, y + barH + 9)
}

/** Enable subtle text shadow for readability */
function enableTextShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'rgba(0,0,0,0.7)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 1
}

/** Disable shadow (for images, shapes, barcodes) */
function disableShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

/**
 * Draw movie logo image or fallback to text title.
 * Returns the height consumed so the caller can advance curY.
 */
function drawTitleOrLogo(
  tc: CanvasRenderingContext2D,
  data: VHSCoverData,
  opts: {
    x: number       // center-x (for 'center') or left-x (for 'left')
    y: number       // top of the title zone
    maxW: number    // max width for logo/text
    fontSize: number // text fallback font size
    color: string
    align: 'center' | 'left'
    maxLines?: number
  }
): number {
  const { x, y, maxW, fontSize, color, align, maxLines = 2 } = opts

  if (data.logoImg) {
    const logoAspect = data.logoImg.width / data.logoImg.height
    let logoW = maxW
    let logoH = logoW / logoAspect
    const maxH = fontSize * maxLines * 1.4
    if (logoH > maxH) {
      logoH = maxH
      logoW = logoH * logoAspect
    }
    const drawX = align === 'center' ? x - logoW / 2 : x
    tc.drawImage(data.logoImg, drawX, y, logoW, logoH)
    return logoH + 4
  }

  // Text fallback
  tc.font = `bold ${fontSize}px sans-serif`
  tc.fillStyle = color
  tc.textAlign = align
  const lines = wrapText(tc, data.film.title.toUpperCase(), maxW, maxLines)
  let dy = 0
  const lineH = Math.round(fontSize * 1.2)
  for (const line of lines) {
    tc.fillText(line, x, y + fontSize + dy)
    dy += lineH
  }
  return dy + 4
}

/** Detect if a logo image is predominantly bright (white/light) by sampling pixels */
function isLogoBright(img: HTMLImageElement): boolean {
  const size = 32
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, size, size)
  const pixels = ctx.getImageData(0, 0, size, size).data
  let brightCount = 0
  let opaqueCount = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    if (a < 50) continue // skip transparent pixels
    opaqueCount++
    const lum = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
    if (lum > 130) brightCount++
  }
  return opaqueCount > 0 && brightCount / opaqueCount > 0.5
}

/** Awards badge based on vote_average (proxy for critical acclaim) */
function getAwardsText(film: Film): string | null {
  const vc = film.vote_count || 0
  if (film.vote_average >= 8.5 && vc >= 5000) return "CHEF-D'\u0152UVRE DU CIN\u00c9MA"
  if (film.vote_average >= 8.0 && vc >= 2000) return 'ACCLAM\u00c9 PAR LA CRITIQUE'
  if (film.vote_average >= 7.5 && vc >= 3000) return 'RECOMMAND\u00c9'
  return null
}

// ---- Data types ----

export interface VHSCoverData {
  film: Film
  posterImg: HTMLImageElement | null
  backdropImgs: HTMLImageElement[]
  directors: string[]
  actors: string[]
  secondaryActors: string[]
  producers: string[]
  writers: string[]
  composer: string
  tagline: string
  studioName: string         // major/distributor (first known major)
  productionStudioName: string // production company (first non-major, if different)
  reviews: { author: string; content: string }[]
  certification: string
  logoImg: HTMLImageElement | null
  studioLogos: { img: HTMLImageElement; companyId: number }[]
}

export async function fetchVHSCoverData(film: Film): Promise<VHSCoverData> {
  const data: VHSCoverData = {
    film,
    posterImg: null,
    backdropImgs: [],
    directors: film.directors || [],
    actors: film.actors || [],
    secondaryActors: [],
    producers: [],
    writers: [],
    composer: '',
    tagline: film.tagline || '',
    studioName: film.production_companies?.[0]?.name || '',
    productionStudioName: '',
    reviews: [],
    certification: '',
    logoImg: null,
    studioLogos: [],
  }

  const promises: Promise<void>[] = []

  // Poster (w500)
  if (film.poster_path) {
    promises.push(
      loadImage(tmdb.posterUrl(film.poster_path, 'w500'))
        .then(img => { data.posterImg = img })
        .catch(() => {})
    )
  }

  // Expanded credits
  if (!film.directors?.length || !film.actors?.length) {
    promises.push(
      tmdb.getCredits(film.id)
        .then(credits => {
          data.directors = credits.directors
          data.actors = credits.actors
          data.secondaryActors = credits.secondaryActors
          data.producers = credits.producers
          data.writers = credits.writers
          data.composer = credits.composer
        })
        .catch(() => {})
    )
  }

  // Reviews
  promises.push(
    tmdb.getReviews(film.id)
      .then(reviews => { data.reviews = reviews })
      .catch(() => {})
  )

  // Certification (MPAA / FR rating)
  promises.push(
    tmdb.getCertification(film.id)
      .then(cert => { data.certification = cert })
      .catch(() => {})
  )

  // Movie logo (official title treatment from TMDB)
  promises.push(
    tmdb.getMovieLogo(film.id)
      .then(async (logoUrl) => {
        if (logoUrl) {
          data.logoImg = await loadImage(logoUrl).catch(() => null)
        }
      })
      .catch(() => {})
  )

  // Fetch full film details (for production_companies, tagline) then load studio logos
  promises.push(
    tmdb.getFilm(film.id)
      .then(async (fullFilm) => {
        if (!data.tagline && fullFilm.tagline) data.tagline = fullFilm.tagline
        // Sort companies: known majors first (those in LOCAL_STUDIO_LOGOS)
        const allCompanies = (fullFilm.production_companies || [])
        allCompanies.sort((a, b) => {
          const aId = STUDIO_ALIASES[a.name.toLowerCase()] || a.id
          const bId = STUDIO_ALIASES[b.name.toLowerCase()] || b.id
          const aMajor = LOCAL_STUDIO_LOGOS.has(aId) ? 0 : 1
          const bMajor = LOCAL_STUDIO_LOGOS.has(bId) ? 0 : 1
          return aMajor - bMajor
        })
        // First major = distributor, first non-major = production studio
        if (allCompanies.length) {
          const firstMajor = allCompanies.find(c => {
            const cid = STUDIO_ALIASES[c.name.toLowerCase()] || c.id
            return LOCAL_STUDIO_LOGOS.has(cid)
          })
          const firstNonMajor = allCompanies.find(c => {
            const cid = STUDIO_ALIASES[c.name.toLowerCase()] || c.id
            return !LOCAL_STUDIO_LOGOS.has(cid)
          })
          if (firstMajor) {
            data.studioName = firstMajor.name
            if (firstNonMajor) data.productionStudioName = firstNonMajor.name
          } else {
            data.studioName = allCompanies[0].name
          }
        }
        const companies = allCompanies.slice(0, 3)
        if (companies.length > 0) {
          const logoUrls = await Promise.all(
            companies.map(c => resolveStudioLogoUrl(c))
          )
          const imgs = await Promise.all(
            logoUrls.map(url =>
              url ? loadImage(url).catch(() => null) : Promise.resolve(null)
            )
          )
          data.studioLogos = imgs
            .map((img, idx) => img ? {
              img,
              companyId: STUDIO_ALIASES[companies[idx].name.toLowerCase()] || companies[idx].id,
            } : null)
            .filter((e): e is { img: HTMLImageElement; companyId: number } => e !== null)
        }
      })
      .catch(() => {})
  )

  // Backdrop images (deduplicated — avoid visually similar shots)
  promises.push(
    tmdb.getImages(film.id)
      .then(async (images: TMDBImage[]) => {
        const candidates = images
          .filter(img => img.aspect_ratio > 1.3)
          .sort((a, b) => b.width - a.width)

        // Deduplicate: skip images whose file_path base name is too similar
        // and spread picks across different aspect ratios to get varied shots
        const seen = new Set<string>()
        const picked: TMDBImage[] = []
        for (const img of candidates) {
          if (picked.length >= 3) break
          // Skip exact duplicate paths
          if (seen.has(img.file_path)) continue
          seen.add(img.file_path)
          // Skip images with nearly identical dimensions (same shot, different quality)
          const isDupe = picked.some(p =>
            Math.abs(p.aspect_ratio - img.aspect_ratio) < 0.05 &&
            Math.abs(p.width - img.width) < 200
          )
          if (isDupe) continue
          picked.push(img)
        }

        const results = await Promise.all(
          picked.map(img =>
            loadImage(tmdb.backdropUrl(img.file_path, 'w780') || '').catch(() => null)
          )
        )
        data.backdropImgs = results.filter((img): img is HTMLImageElement => img !== null)
      })
      .catch(() => {})
  )

  await Promise.all(promises)
  return data
}

// ---- Template selection ----

function getTemplate(film: Film): VHSTemplate {
  return TEMPLATES[film.id % TEMPLATES.length]
}

// ---- Texture generation ----

export function generateVHSCoverTexture(data: VHSCoverData): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_SIZE
  canvas.height = TEX_SIZE
  const ctx = canvas.getContext('2d')!

  const template = getTemplate(data.film)

  ctx.fillStyle = '#0a0a12'
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)

  drawFrontCover(ctx, data, template)
  drawBackCover(ctx, data, template)
  drawSpine(ctx, SPINE1, data, template)
  drawSpine(ctx, SPINE2, data, template)
  drawEdge(ctx, TOP_EDGE)
  drawEdge(ctx, BOTTOM_EDGE)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  return texture
}

// ---- Blit helper ----

function blitFlipped(
  ctx: CanvasRenderingContext2D,
  region: { x: number; y: number; w: number; h: number },
  drawFn: (tc: CanvasRenderingContext2D, w: number, h: number) => void
) {
  const temp = document.createElement('canvas')
  temp.width = region.w
  temp.height = region.h
  const tc = temp.getContext('2d')!
  drawFn(tc, region.w, region.h)
  ctx.save()
  ctx.translate(region.x + region.w, region.y)
  ctx.scale(-1, 1)
  ctx.drawImage(temp, 0, 0)
  ctx.restore()
}

// ============================================================
//  FRONT COVER
// ============================================================

function drawFrontCover(ctx: CanvasRenderingContext2D, data: VHSCoverData, template: VHSTemplate) {
  blitFlipped(ctx, FRONT, (tc, w, h) => {
    const pad = 14

    fillGradient(tc, w, h, template.frontBg)
    enableTextShadow(tc)

    if (template.posterLayout === 'full-bleed') {
      drawFrontFullBleed(tc, w, h, pad, data, template)
    } else if (template.posterLayout === 'centered-padded') {
      drawFrontCenteredPadded(tc, w, h, pad, data, template)
    } else {
      drawFrontOffsetLeft(tc, w, h, pad, data, template)
    }

  })
}

function drawFrontFullBleed(
  tc: CanvasRenderingContext2D, w: number, h: number, pad: number,
  data: VHSCoverData, template: VHSTemplate
) {
  const { film, posterImg } = data

  if (posterImg) {
    disableShadow(tc)
    coverCropImage(tc, posterImg, 0, 0, w, h)
    // Bottom gradient (strong) for text zone
    const gradBot = tc.createLinearGradient(0, h * 0.38, 0, h)
    gradBot.addColorStop(0, 'transparent')
    gradBot.addColorStop(0.3, 'rgba(0,0,0,0.5)')
    gradBot.addColorStop(0.6, 'rgba(0,0,0,0.85)')
    gradBot.addColorStop(1, 'rgba(0,0,0,0.95)')
    tc.fillStyle = gradBot
    tc.fillRect(0, h * 0.38, w, h * 0.62)
    // Top gradient for studio/actors
    const gradTop = tc.createLinearGradient(0, 0, 0, h * 0.22)
    gradTop.addColorStop(0, 'rgba(0,0,0,0.8)')
    gradTop.addColorStop(1, 'transparent')
    tc.fillStyle = gradTop
    tc.fillRect(0, 0, w, h * 0.22)
    enableTextShadow(tc)
  } else {
    tc.fillStyle = `${template.accentColor}18`
    tc.fillRect(0, 0, w, h)
    tc.font = 'bold 64px sans-serif'
    tc.fillStyle = template.accentColor
    tc.textAlign = 'center'
    tc.fillText(film.title.substring(0, 2).toUpperCase(), w / 2, h / 2 + 20)
  }

  // --- Top zone (below notch) ---
  let topY = NOTCH_BOTTOM + 4

  // VHS badge (top-right)
  drawVHSBadge(tc, w - pad - 50, topY, template.accentColor)

  // Certification badge (top-left)
  if (data.certification) {
    drawCertificationBadge(tc, data.certification, pad, topY, template.accentColor)
  }

  // Studio (centered below badges)
  topY += 26
  if (data.studioName) {
    tc.font = 'bold 10px sans-serif'
    tc.fillStyle = 'rgba(255,255,255,0.55)'
    tc.textAlign = 'center'
    tc.fillText(data.studioName.toUpperCase(), w / 2, topY + 10)
    topY += 14
  }

  // Actor names (centered)
  if (data.actors.length > 0) {
    tc.font = 'bold 18px sans-serif'
    tc.fillStyle = '#ffffff'
    tc.textAlign = 'center'
    const actorStr = data.actors.slice(0, 3).join('  \u2022  ').toUpperCase()
    const actorLines = wrapText(tc, actorStr, w - pad * 2, 2)
    for (const line of actorLines) {
      tc.fillText(line, w / 2, topY + 18)
      topY += 22
    }
  }

  // --- Bottom text zone ---
  let curY = h - 260

  // Awards badge
  const awards = getAwardsText(film)
  if (awards) {
    tc.font = 'bold 11px sans-serif'
    tc.fillStyle = '#ffd700'
    tc.textAlign = 'center'
    tc.fillText('\u2605 ' + awards + ' \u2605', w / 2, curY + 11)
    curY += 20
  }

  // Title (logo or text)
  curY += drawTitleOrLogo(tc, data, {
    x: w / 2, y: curY, maxW: w - pad * 2,
    fontSize: 32, color: template.titleColor, align: 'center',
  })

  // Tagline
  if (template.showTagline && data.tagline) {
    tc.font = 'italic 12px sans-serif'
    tc.fillStyle = 'rgba(255,255,255,0.75)'
    tc.textAlign = 'center'
    const tagLines = wrapText(tc, data.tagline, w - pad * 2, 2)
    for (const line of tagLines) {
      tc.fillText(line, w / 2, curY + 12)
      curY += 16
    }
    curY += 4
  }

  // Director
  if (data.directors.length > 0) {
    tc.font = '12px sans-serif'
    tc.fillStyle = 'rgba(255,255,255,0.7)'
    tc.textAlign = 'center'
    tc.fillText('Un film de ' + data.directors.join(', '), w / 2, curY + 12)
    curY += 18
  }

  // Stars + year
  drawStars(tc, film.vote_average, w / 2 - 55, curY + 14, 16)
  curY += 24
  tc.font = '12px sans-serif'
  tc.fillStyle = 'rgba(255,255,255,0.6)'
  tc.textAlign = 'center'
  const year = film.release_date ? new Date(film.release_date).getFullYear() : ''
  tc.fillText(year.toString(), w / 2, curY + 12)
  curY += 18

  // Genres
  if (film.genres.length > 0) {
    tc.font = '11px sans-serif'
    tc.fillStyle = template.accentColor
    tc.textAlign = 'center'
    tc.fillText(film.genres.map(g => g.name).join(' \u2022 '), w / 2, curY + 11)
    curY += 16
  }

  // Runtime bar (bottom)
  drawRuntimeBar(tc, film.runtime, pad, curY + 2, w - pad * 2, template.accentColor)
}

function drawFrontCenteredPadded(
  tc: CanvasRenderingContext2D, w: number, h: number, pad: number,
  data: VHSCoverData, template: VHSTemplate
) {
  const { film, posterImg } = data
  let curY = 8

  // Top colored band with studio
  if (template.borderStyle === 'thick-band') {
    tc.fillStyle = template.accentColor
    tc.fillRect(0, 0, w, 40)
    if (data.studioName) {
      tc.font = 'bold 12px sans-serif'
      tc.fillStyle = '#ffffff'
      tc.textAlign = 'center'
      tc.fillText(data.studioName.toUpperCase(), w / 2, 26)
    }
    curY = 46
  }

  // Actor names (below notch zone)
  curY = Math.max(curY, NOTCH_BOTTOM + 6)

  // Certification + VHS badges on same line
  if (data.certification) {
    drawCertificationBadge(tc, data.certification, pad, curY, template.accentColor)
  }
  drawVHSBadge(tc, w - pad - 50, curY, template.accentColor)
  curY += 26

  if (data.actors.length > 0) {
    tc.font = 'bold 16px sans-serif'
    tc.fillStyle = '#ffffff'
    tc.textAlign = 'center'
    const actorStr = data.actors.slice(0, 3).join('  \u2022  ').toUpperCase()
    const actorLines = wrapText(tc, actorStr, w - pad * 2, 2)
    for (const line of actorLines) {
      tc.fillText(line, w / 2, curY + 16)
      curY += 20
    }
    curY += 6
  }

  // Poster image centered
  if (posterImg) {
    const posterMaxH = Math.round(h * 0.44)
    const posterMaxW = w - pad * 4
    const aspect = posterImg.width / posterImg.height
    let pW = posterMaxW
    let pH = pW / aspect
    if (pH > posterMaxH) { pH = posterMaxH; pW = pH * aspect }
    const pX = Math.round((w - pW) / 2)
    tc.drawImage(posterImg, pX, curY, pW, pH)
    tc.strokeStyle = `${template.accentColor}66`
    tc.lineWidth = 1.5
    tc.strokeRect(pX, curY, pW, pH)
    curY += pH + 10
  } else {
    const fallH = Math.round(h * 0.35)
    tc.fillStyle = `${template.accentColor}18`
    tc.fillRect(pad * 2, curY, w - pad * 4, fallH)
    tc.font = 'bold 48px sans-serif'
    tc.fillStyle = template.accentColor
    tc.textAlign = 'center'
    tc.fillText(film.title.substring(0, 2).toUpperCase(), w / 2, curY + fallH / 2 + 16)
    curY += fallH + 10
  }

  // Awards badge
  const awards = getAwardsText(film)
  if (awards) {
    tc.font = 'bold 10px sans-serif'
    tc.fillStyle = '#ffd700'
    tc.textAlign = 'center'
    tc.fillText('\u2605 ' + awards + ' \u2605', w / 2, curY + 10)
    curY += 18
  }

  // Title (logo or text)
  curY += drawTitleOrLogo(tc, data, {
    x: w / 2, y: curY, maxW: w - pad * 2,
    fontSize: 28, color: template.titleColor, align: 'center',
  })

  // Director
  if (data.directors.length > 0) {
    tc.font = '11px sans-serif'
    tc.fillStyle = 'rgba(255,255,255,0.7)'
    tc.textAlign = 'center'
    tc.fillText('Un film de ' + data.directors.join(', '), w / 2, curY + 11)
    curY += 16
  }

  // Stars + year
  drawStars(tc, film.vote_average, w / 2 - 55, curY + 14, 16)
  curY += 24
  tc.font = '12px sans-serif'
  tc.fillStyle = 'rgba(255,255,255,0.55)'
  tc.textAlign = 'center'
  const yearCP = film.release_date ? new Date(film.release_date).getFullYear() : ''
  tc.fillText(yearCP.toString(), w / 2, curY + 12)
  curY += 18

  // Genres
  if (film.genres.length > 0) {
    tc.font = '11px sans-serif'
    tc.fillStyle = template.accentColor
    tc.textAlign = 'center'
    tc.fillText(film.genres.map(g => g.name).join(' \u2022 '), w / 2, curY + 11)
    curY += 16
  }

  // Runtime bar
  drawRuntimeBar(tc, film.runtime, pad, curY + 2, w - pad * 2, template.accentColor)
}

function drawFrontOffsetLeft(
  tc: CanvasRenderingContext2D, w: number, h: number, pad: number,
  data: VHSCoverData, template: VHSTemplate
) {
  const { film, posterImg } = data

  if (posterImg) {
    const posterW = Math.round(w * 0.55)
    coverCropImage(tc, posterImg, 0, 0, posterW, h)
    // Soft fade on right edge
    const fadeGrad = tc.createLinearGradient(posterW - 40, 0, posterW, 0)
    fadeGrad.addColorStop(0, 'transparent')
    fadeGrad.addColorStop(1, template.frontBg[1] || template.frontBg[0])
    tc.fillStyle = fadeGrad
    tc.fillRect(posterW - 40, 0, 40, h)

    // Right text column
    const textX = posterW + 6
    const textW = w - posterW - 6 - pad
    let rY = NOTCH_BOTTOM + 8

    // VHS badge + certification
    drawVHSBadge(tc, textX, rY, template.accentColor)
    if (data.certification) {
      drawCertificationBadge(tc, data.certification, textX + 54, rY, template.accentColor)
    }
    rY += 28

    // Studio
    if (data.studioName) {
      tc.font = 'bold 10px sans-serif'
      tc.fillStyle = 'rgba(255,255,255,0.5)'
      tc.textAlign = 'left'
      tc.fillText(data.studioName.toUpperCase(), textX, rY + 10)
      rY += 16
    }

    // Actor names vertically
    tc.font = 'bold 14px sans-serif'
    tc.fillStyle = '#ffffff'
    tc.textAlign = 'left'
    for (const actor of data.actors.slice(0, 4)) {
      tc.fillText(actor.toUpperCase(), textX, rY + 14)
      rY += 18
    }
    rY += 8

    // Tagline
    if (template.showTagline && data.tagline) {
      tc.font = 'italic 12px sans-serif'
      tc.fillStyle = template.accentColor
      tc.textAlign = 'left'
      const tagLines = wrapText(tc, data.tagline, textW, 3)
      for (const line of tagLines) {
        tc.fillText(line, textX, rY + 12)
        rY += 15
      }
      rY += 6
    }

    // Title (logo or text)
    rY += drawTitleOrLogo(tc, data, {
      x: textX, y: rY, maxW: textW,
      fontSize: 20, color: template.titleColor, align: 'left', maxLines: 4,
    })

    // Awards
    const awardsOL = getAwardsText(film)
    if (awardsOL) {
      tc.font = 'bold 9px sans-serif'
      tc.fillStyle = '#ffd700'
      tc.textAlign = 'left'
      tc.fillText('\u2605 ' + awardsOL, textX, rY + 9)
      rY += 14
    }

    // Director
    if (data.directors.length > 0) {
      tc.font = '10px sans-serif'
      tc.fillStyle = 'rgba(255,255,255,0.65)'
      tc.textAlign = 'left'
      tc.fillText('R\u00e9al. ' + data.directors[0], textX, rY + 10)
      rY += 14
    }

    // Stars
    drawStars(tc, film.vote_average, textX, rY + 12, 14)
    rY += 22

    // Year
    tc.font = '11px sans-serif'
    tc.fillStyle = 'rgba(255,255,255,0.5)'
    tc.textAlign = 'left'
    const yearOL = film.release_date ? new Date(film.release_date).getFullYear() : ''
    tc.fillText(yearOL.toString(), textX, rY + 11)
    rY += 16

    // Genres
    if (film.genres.length > 0) {
      tc.font = '10px sans-serif'
      tc.fillStyle = template.accentColor
      tc.textAlign = 'left'
      for (const g of film.genres.slice(0, 3)) {
        tc.fillText(g.name, textX, rY + 10)
        rY += 14
      }
      rY += 4
    }

    // Runtime bar at bottom of right column
    drawRuntimeBar(tc, film.runtime, textX, rY, textW, template.accentColor)
  } else {
    tc.fillStyle = `${template.accentColor}18`
    tc.fillRect(pad, pad, w - pad * 2, h - pad * 2)
    tc.font = 'bold 48px sans-serif'
    tc.fillStyle = template.accentColor
    tc.textAlign = 'center'
    tc.fillText(film.title.substring(0, 2).toUpperCase(), w / 2, h / 2 + 16)
  }
}

// ============================================================
//  BACK COVER
// ============================================================

function drawBackCover(ctx: CanvasRenderingContext2D, data: VHSCoverData, template: VHSTemplate) {
  blitFlipped(ctx, BACK, (tc, w, h) => {
    const { film, backdropImgs } = data
    const pad = 14

    fillGradient(tc, w, h, template.backBg)
    enableTextShadow(tc)

    const topMargin = Math.round(h * 0.02)
    let curY = pad + topMargin

    // Title header (logo or text)
    curY += drawTitleOrLogo(tc, data, {
      x: pad, y: curY, maxW: w - pad * 2,
      fontSize: 16, color: template.accentColor, align: 'left', maxLines: 1,
    })

    // Separator
    tc.fillStyle = `${template.accentColor}60`
    tc.fillRect(pad, curY, w - pad * 2, 1)
    curY += 6

    // --- Screenshots (creative layouts) ---
    disableShadow(tc)
    const imgs = backdropImgs
    if (imgs.length > 0) {
      curY = drawScreenshots(tc, imgs, w, pad, curY, template)
      curY += 6
    }
    enableTextShadow(tc)

    // --- Review quotes ---
    if (data.reviews.length > 0) {
      for (const review of data.reviews.slice(0, 1)) {
        tc.font = 'italic 10px sans-serif'
        tc.fillStyle = 'rgba(255,255,255,0.75)'
        tc.textAlign = 'left'
        const quoteLines = wrapText(tc, `\u00ab ${review.content} \u00bb`, w - pad * 2, 3)
        for (const line of quoteLines) {
          tc.fillText(line, pad, curY + 10)
          curY += 13
        }
        tc.font = '9px sans-serif'
        tc.fillStyle = template.accentColor
        tc.fillText('\u2014 ' + review.author, pad + 20, curY + 9)
        curY += 16
      }
    }

    // --- Synopsis ---
    tc.shadowColor = 'rgba(0,0,0,0.5)'
    tc.shadowBlur = 1.5
    tc.shadowOffsetX = 1
    tc.shadowOffsetY = 1
    tc.font = 'bold 12px sans-serif'
    tc.fillStyle = template.accentColor
    tc.textAlign = 'left'
    tc.fillText('SYNOPSIS', pad, curY + 12)
    curY += 18

    tc.font = '12px sans-serif'
    tc.fillStyle = '#ffffff'
    const synText = film.overview || 'Aucun synopsis disponible.'
    // Calculate available space for synopsis
    const creditsHeight = estimateCreditsHeight(data)
    const bottomReserved = 62 + creditsHeight // barcode + branding + credits
    const maxSynY = h - bottomReserved
    const availableSynLines = Math.max(3, Math.floor((maxSynY - curY) / 13))
    const synLines = wrapText(tc, synText, w - pad * 2, availableSynLines)
    for (const line of synLines) {
      tc.fillText(line, pad, curY + 10)
      curY += 13
    }
    curY += 6

    // --- Separator ---
    tc.fillStyle = 'rgba(255,255,255,0.12)'
    tc.fillRect(pad, curY, w - pad * 2, 1)
    curY += 8

    // --- Full credits block ---
    curY = drawCreditsBlock(tc, data, template, w, pad, curY)

    // --- "Soyez aimable, rembobinez" sticker ---
    curY += 2
    tc.font = 'italic 8px sans-serif'
    tc.fillStyle = template.accentColor
    tc.textAlign = 'center'
    tc.fillText('SOYEZ COOL, REMBOBINEZ', w / 2, curY + 8)
    curY += 14

    // --- Certification + Runtime on back (compact line) ---
    tc.font = '8px sans-serif'
    tc.fillStyle = 'rgba(255,255,255,0.5)'
    tc.textAlign = 'left'
    const backMeta: string[] = []
    if (data.certification) backMeta.push(data.certification)
    if (film.runtime) backMeta.push(`${film.runtime} min`)
    const yearBack = film.release_date ? new Date(film.release_date).getFullYear() : ''
    if (yearBack) backMeta.push(`\u00a9 ${yearBack}`)
    if (backMeta.length > 0) {
      tc.fillText(backMeta.join(' \u2022 '), pad, curY + 8)
      curY += 12
    }

    // --- Production company logos ---
    disableShadow(tc)
    if (data.studioLogos.length > 0) {
      const logoMaxH = 16
      const logoGap = 10
      const logoPad = 4
      const logoSizes = data.studioLogos.map(({ img }) => {
        const aspect = img.width / img.height
        return { w: logoMaxH * aspect, h: logoMaxH }
      })
      const totalW = logoSizes.reduce((sum, s) => sum + s.w + logoPad * 2, 0) + logoGap * (logoSizes.length - 1)
      let lx = (w - totalW) / 2
      const ly = h - 72
      for (let i = 0; i < data.studioLogos.length; i++) {
        const { img: logoImg } = data.studioLogos[i]
        const bright = isLogoBright(logoImg)
        // Background pill: dark for bright/white logos, white for dark logos
        tc.fillStyle = bright ? 'rgba(20,20,30,0.92)' : 'rgba(255,255,255,0.88)'
        tc.beginPath()
        roundRect(tc, lx, ly - logoPad, logoSizes[i].w + logoPad * 2, logoSizes[i].h + logoPad * 2, 3)
        tc.fill()
        tc.drawImage(logoImg, lx + logoPad, ly, logoSizes[i].w, logoSizes[i].h)
        lx += logoSizes[i].w + logoPad * 2 + logoGap
      }
    }

    // --- Barcode (film-specific) ---
    drawBarcode(tc, w / 2 - 45, h - 50, 90, 28, film.id)

    // --- Bottom branding ---
    tc.font = 'bold 9px sans-serif'
    tc.fillStyle = 'rgba(255,255,255,0.5)'
    tc.textAlign = 'center'
    tc.fillText('ZONE CLUB \u00c9DITIONS', w / 2, h - 10)
  })
}

function estimateCreditsHeight(data: VHSCoverData): number {
  let h = 0
  if (data.actors.length > 0) h += 24 // Starring + actors
  if (data.secondaryActors.length > 0) h += 14
  if (data.directors.length > 0) h += 13
  if (data.producers.length > 0) h += 13
  if (data.writers.length > 0) h += 13
  if (data.composer) h += 13
  if (data.studioName) h += 13
  if (data.productionStudioName) h += 13
  return h + 8
}

function drawCreditsBlock(
  tc: CanvasRenderingContext2D, data: VHSCoverData, template: VHSTemplate,
  w: number, pad: number, startY: number
): number {
  let curY = startY
  const labelColor = template.accentColor
  const textColor = 'rgba(255,255,255,0.8)'
  const maxW = w - pad * 2

  function creditLine(label: string, value: string) {
    if (!value) return
    tc.font = 'bold 9px sans-serif'
    tc.fillStyle = labelColor
    tc.textAlign = 'left'
    tc.fillText(label, pad, curY + 9)
    const labelW = tc.measureText(label).width + 4
    tc.font = '9px sans-serif'
    tc.fillStyle = textColor
    // Wrap value if too long
    const valLines = wrapText(tc, value, maxW - labelW, 2)
    tc.fillText(valLines[0], pad + labelW, curY + 9)
    curY += 12
    if (valLines.length > 1) {
      tc.fillText(valLines[1], pad + labelW, curY + 9)
      curY += 12
    }
  }

  // Starring (lead actors)
  if (data.actors.length > 0) {
    creditLine('Avec ', data.actors.join(', '))
  }

  // Secondary actors
  if (data.secondaryActors.length > 0) {
    creditLine('\u00c9galement ', data.secondaryActors.slice(0, 4).join(', '))
  }

  // Director
  if (data.directors.length > 0) {
    creditLine('R\u00e9alis\u00e9 par ', data.directors.join(', '))
  }

  // Distributor + Production studio
  if (data.studioName) {
    creditLine('Distribution ', data.studioName)
  }
  if (data.productionStudioName) {
    creditLine('Production ', data.productionStudioName)
  }

  // Producers
  if (data.producers.length > 0) {
    creditLine('Produit par ', data.producers.join(', '))
  }

  // Writers
  if (data.writers.length > 0) {
    creditLine('\u00c9crit par ', data.writers.join(', '))
  }

  // Composer
  if (data.composer) {
    creditLine('Musique de ', data.composer)
  }

  // Copyright year
  const yearCr = data.film.release_date ? new Date(data.film.release_date).getFullYear() : ''
  if (yearCr && data.studioName) {
    curY += 2
    tc.font = 'bold 9px sans-serif'
    tc.fillStyle = 'rgba(255,255,255,0.5)'
    tc.textAlign = 'left'
    tc.fillText(`\u00a9 ${yearCr} ${data.studioName}`, pad, curY + 9)
    curY += 12
  }

  return curY
}

// ---- Screenshot layouts (creative, reference-inspired) ----

function drawScreenshots(
  tc: CanvasRenderingContext2D,
  imgs: HTMLImageElement[],
  w: number, pad: number, startY: number,
  template: VHSTemplate
): number {
  const count = Math.min(imgs.length, 3)
  const frameColor = `${template.accentColor}40`
  const usableW = w - pad * 2

  switch (template.screenshotLayout) {
    case 'hero-row':
      return layoutHeroRow(tc, imgs, count, w, pad, startY, usableW, frameColor)
    case 'asymmetric':
      return layoutAsymmetric(tc, imgs, count, w, pad, startY, usableW, frameColor)
    case 'sidebar':
      return layoutSidebar(tc, imgs, count, pad, startY, usableW, frameColor)
    case 'scattered':
      return layoutScattered(tc, imgs, count, w, pad, startY, usableW, frameColor)
  }
}

// Layout 0: Panoramic hero image + small images below (Terminator-style)
function layoutHeroRow(
  tc: CanvasRenderingContext2D, imgs: HTMLImageElement[], count: number,
  _w: number, pad: number, startY: number, usableW: number, frameColor: string
): number {
  let curY = startY
  if (count === 1) {
    drawFramedImage(tc, imgs[0], pad, curY, usableW, 150, frameColor)
    curY += 156
  } else if (count === 2) {
    // Top panoramic
    drawFramedImage(tc, imgs[0], pad, curY, usableW, 120, frameColor)
    curY += 126
    // Bottom offset right
    const smallW = Math.round(usableW * 0.55)
    drawFramedImage(tc, imgs[1], pad + usableW - smallW, curY, smallW, 80, frameColor)
    curY += 86
  } else {
    // Top panoramic
    drawFramedImage(tc, imgs[0], pad, curY, usableW, 120, frameColor)
    curY += 126
    // Two small images below, different widths
    const gap = 6
    const w1 = Math.round(usableW * 0.45)
    const w2 = usableW - w1 - gap
    drawFramedImage(tc, imgs[1], pad, curY, w1, 75, frameColor)
    drawFramedImage(tc, imgs[2], pad + w1 + gap, curY, w2, 75, frameColor)
    curY += 81
  }
  return curY
}

// Layout 1: One large + stacked small (Rocky II / RoboCop-style)
function layoutAsymmetric(
  tc: CanvasRenderingContext2D, imgs: HTMLImageElement[], count: number,
  _w: number, pad: number, startY: number, usableW: number, frameColor: string
): number {
  let curY = startY
  if (count === 1) {
    drawFramedImage(tc, imgs[0], pad, curY, usableW, 170, frameColor)
    curY += 176
  } else if (count === 2) {
    // Large left, small right
    const largeW = Math.round(usableW * 0.62)
    const smallW = usableW - largeW - 6
    drawFramedImage(tc, imgs[0], pad, curY, largeW, 160, frameColor)
    drawFramedImage(tc, imgs[1], pad + largeW + 6, curY + 40, smallW, 100, frameColor)
    curY += 166
  } else {
    // Large left, two small stacked right
    const largeW = Math.round(usableW * 0.60)
    const smallW = usableW - largeW - 6
    const largeH = 170
    drawFramedImage(tc, imgs[0], pad, curY, largeW, largeH, frameColor)
    const smallH = Math.floor((largeH - 6) / 2)
    drawFramedImage(tc, imgs[1], pad + largeW + 6, curY, smallW, smallH, frameColor)
    drawFramedImage(tc, imgs[2], pad + largeW + 6, curY + smallH + 6, smallW, smallH, frameColor)
    curY += largeH + 6
  }
  return curY
}

// Layout 2: Left column gallery (Jedi / Predator-style)
function layoutSidebar(
  tc: CanvasRenderingContext2D, imgs: HTMLImageElement[], count: number,
  pad: number, startY: number, usableW: number, frameColor: string
): number {
  let curY = startY
  const colW = Math.round(usableW * 0.48)
  if (count === 1) {
    drawFramedImage(tc, imgs[0], pad, curY, colW, 175, frameColor)
    curY += 181
  } else if (count === 2) {
    drawFramedImage(tc, imgs[0], pad, curY, colW, 110, frameColor)
    drawFramedImage(tc, imgs[1], pad, curY + 116, colW, 90, frameColor)
    curY += 212
  } else {
    // Three images: two tall in left column, one wide spanning bottom
    drawFramedImage(tc, imgs[0], pad, curY, colW, 100, frameColor)
    const rightW = usableW - colW - 6
    drawFramedImage(tc, imgs[1], pad + colW + 6, curY + 20, rightW, 110, frameColor)
    curY += 136
    const wideW = Math.round(usableW * 0.7)
    drawFramedImage(tc, imgs[2], pad, curY, wideW, 70, frameColor)
    curY += 76
  }
  return curY
}

// Layout 3: Scattered/diagonal (Back to the Future / Ghostbusters-style)
function layoutScattered(
  tc: CanvasRenderingContext2D, imgs: HTMLImageElement[], count: number,
  _w: number, pad: number, startY: number, usableW: number, frameColor: string
): number {
  let curY = startY
  if (count === 1) {
    const imgW = Math.round(usableW * 0.8)
    drawFramedImage(tc, imgs[0], pad + Math.round((usableW - imgW) / 2), curY, imgW, 140, frameColor)
    curY += 146
  } else if (count === 2) {
    // Diagonal offset
    const imgW = Math.round(usableW * 0.55)
    drawFramedImage(tc, imgs[0], pad, curY, imgW, 110, frameColor)
    drawFramedImage(tc, imgs[1], pad + usableW - imgW, curY + 30, imgW, 110, frameColor)
    curY += 146
  } else {
    // Top-left, top-right (offset down), bottom center (wide)
    const topW = Math.round(usableW * 0.50)
    drawFramedImage(tc, imgs[0], pad, curY, topW, 100, frameColor)
    const rightW = Math.round(usableW * 0.46)
    drawFramedImage(tc, imgs[1], pad + usableW - rightW, curY + 20, rightW, 100, frameColor)
    curY += 126
    const botW = Math.round(usableW * 0.65)
    drawFramedImage(tc, imgs[2], pad + Math.round((usableW - botW) / 2), curY, botW, 65, frameColor)
    curY += 71
  }
  return curY
}

// ---- SPINE ----

function drawSpine(
  ctx: CanvasRenderingContext2D,
  region: { x: number; y: number; w: number; h: number },
  data: VHSCoverData,
  template: VHSTemplate
) {
  blitFlipped(ctx, region, (tc, w, h) => {
    const { film } = data

    // Background gradient
    const grad = tc.createLinearGradient(0, 0, w, 0)
    if (template.spineBg.length >= 3) {
      grad.addColorStop(0, template.spineBg[0])
      grad.addColorStop(0.5, template.spineBg[1])
      grad.addColorStop(1, template.spineBg[2])
    } else {
      grad.addColorStop(0, template.spineBg[0])
      grad.addColorStop(1, template.spineBg[1] || template.spineBg[0])
    }
    tc.fillStyle = grad
    tc.fillRect(0, 0, w, h)

    // Side accent lines
    tc.fillStyle = template.spineAccent
    tc.fillRect(0, 0, 1, h)
    tc.fillRect(w - 1, 0, 1, h)

    enableTextShadow(tc)

    // Studio logo (top of spine, horizontal)
    if (data.studioLogos.length > 0) {
      const studioLogo = data.studioLogos[0].img
      tc.save()
      disableShadow(tc)
      tc.translate(w / 2, 50)
      // Horizontal logo — constrained by spine width
      const aspect = studioLogo.width / studioLogo.height
      const maxLW = w - 12  // fit within spine width
      const maxLH = 50       // don't take too much vertical space
      let lW = maxLW
      let lH = lW / aspect
      if (lH > maxLH) { lH = maxLH; lW = lH * aspect }
      // Dark logos need a subtle light pill on dark spine background
      if (!isLogoBright(studioLogo)) {
        tc.fillStyle = 'rgba(255,255,255,0.18)'
        tc.beginPath()
        roundRect(tc, -lW / 2 - 3, -lH / 2 - 3, lW + 6, lH + 6, 3)
        tc.fill()
      }
      tc.drawImage(studioLogo, -lW / 2, -lH / 2, lW, lH)
      enableTextShadow(tc)
      tc.restore()
    } else if (data.studioName) {
      // Fallback: studio name as text
      tc.save()
      tc.translate(w / 2, 50)
      // No rotation — text horizontal
      tc.font = 'bold 11px sans-serif'
      tc.fillStyle = template.spineAccent
      tc.textAlign = 'center'
      tc.textBaseline = 'middle'
      tc.fillText(data.studioName.toUpperCase(), 0, 0)
      tc.restore()
    }

    // Title (center of spine — logo if available, adaptive text fallback)
    if (data.logoImg) {
      // Draw official movie logo rotated on spine
      tc.save()
      tc.translate(w / 2, h / 2)
      tc.rotate(Math.PI / 2)
      const logoAspect = data.logoImg.width / data.logoImg.height
      const maxLogoW = h - 160
      const maxLogoH = w - 16
      let logoW = maxLogoW
      let logoH = logoW / logoAspect
      if (logoH > maxLogoH) {
        logoH = maxLogoH
        logoW = logoH * logoAspect
      }
      tc.drawImage(data.logoImg, -logoW / 2, -logoH / 2, logoW, logoH)
      tc.restore()
    } else {
      // Fallback: adaptive font size text
      tc.save()
      tc.translate(w / 2, h / 2)
      tc.rotate(Math.PI / 2)
      tc.fillStyle = '#ffffff'
      tc.textAlign = 'center'
      tc.textBaseline = 'middle'
      const spineTitle = film.title.toUpperCase()
      const maxTitleWidth = h - 160
      const MIN_SPINE_FONT = 14
      const MAX_SPINE_FONT = 38
      let spineFontSize = MAX_SPINE_FONT
      tc.font = `bold ${spineFontSize}px sans-serif`
      while (tc.measureText(spineTitle).width > maxTitleWidth && spineFontSize > MIN_SPINE_FONT) {
        spineFontSize--
        tc.font = `bold ${spineFontSize}px sans-serif`
      }
      tc.fillText(spineTitle, 0, 0)
      tc.restore()
    }

    // Certification (below title)
    if (data.certification) {
      tc.save()
      tc.translate(w / 2, h - 80)
      tc.rotate(Math.PI / 2)
      tc.font = 'bold 12px sans-serif'
      tc.fillStyle = 'rgba(255,255,255,0.6)'
      tc.textAlign = 'center'
      tc.textBaseline = 'middle'
      tc.fillText(data.certification, 0, 0)
      tc.restore()
    }

    // VHS label (bottom, horizontal — rotated 90° right from title)
    tc.font = 'bold 24px sans-serif'
    tc.fillStyle = template.spineAccent
    tc.textAlign = 'center'
    tc.textBaseline = 'middle'
    tc.fillText('VHS', w / 2, h - 35)
  })
}

// ---- EDGES ----

function drawEdge(
  ctx: CanvasRenderingContext2D,
  region: { x: number; y: number; w: number; h: number }
) {
  const grad = ctx.createLinearGradient(region.x, region.y, region.x, region.y + region.h)
  grad.addColorStop(0, '#0a0a15')
  grad.addColorStop(1, '#060610')
  ctx.fillStyle = grad
  ctx.fillRect(region.x, region.y, region.w, region.h)
}

// ---- BARCODE ----

function drawBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, filmId: number = 0) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#000000'
  let cx = x + 4
  const endX = x + w - 4
  // Seed with film ID for unique barcode per film
  let seed = (filmId * 2654435761) & 0x7fffffff || 42
  while (cx < endX) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const barW = (seed % 3) + 1
    const gap = (seed % 2) + 1
    ctx.fillRect(cx, y + 3, barW, h - 10)
    cx += barW + gap
  }
  // Film-specific EAN number
  const ean = `8 ${String(filmId).padStart(6, '0').substring(0, 6)} ${String((filmId * 7 + 13) % 1000000).padStart(6, '0')}`
  ctx.font = '8px monospace'
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'
  ctx.fillText(ean, x + w / 2, y + h - 1)
}
