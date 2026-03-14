import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { join } from 'path'

// Poster cache on disk — persists across restarts via mounted volume
const CACHE_DIR = process.env.POSTER_CACHE_DIR || join(process.cwd(), '.poster-cache')

// Valid TMDB image sizes
const VALID_SIZES = new Set(['w92', 'w154', 'w185', 'w200', 'w342', 'w500', 'w780', 'w1280', 'original'])

// Browser cache: 30 days (posters are immutable per TMDB path)
const BROWSER_CACHE = 'public, max-age=2592000, immutable'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path
  if (!segments || segments.length < 2) {
    return NextResponse.json({ error: 'Missing size/path' }, { status: 400 })
  }

  const size = segments[0]
  const posterPath = '/' + segments.slice(1).join('/')

  if (!VALID_SIZES.has(size)) {
    return NextResponse.json({ error: 'Invalid size' }, { status: 400 })
  }

  // Sanitize: poster path should be like /aBcDeFg123.jpg
  if (!/^\/[a-zA-Z0-9]+\.\w+$/.test(posterPath)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const cacheKey = `${size}${posterPath}`
  const cachePath = join(CACHE_DIR, size, posterPath.slice(1))

  // Try disk cache first
  try {
    const cached = await readFile(cachePath)
    const ext = posterPath.split('.').pop()?.toLowerCase()
    const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
    return new NextResponse(cached, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': BROWSER_CACHE,
        'X-Poster-Cache': 'HIT',
      },
    })
  } catch {
    // Cache miss — fetch from TMDB
  }

  // Fetch from TMDB
  const tmdbUrl = `https://image.tmdb.org/t/p/${cacheKey}`
  try {
    const res = await fetch(tmdbUrl)
    if (!res.ok) {
      return NextResponse.json({ error: 'TMDB fetch failed' }, { status: res.status })
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') || 'image/jpeg'

    // Write to disk cache (non-blocking, don't fail the request)
    const cacheDir = join(CACHE_DIR, size)
    mkdir(cacheDir, { recursive: true })
      .then(() => writeFile(cachePath, buffer))
      .catch(() => {}) // silent fail on cache write

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': BROWSER_CACHE,
        'X-Poster-Cache': 'MISS',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Fetch error' }, { status: 502 })
  }
}
