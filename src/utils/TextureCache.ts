import * as THREE from 'three'

/**
 * Cache global pour les textures TMDB (et autres URLs distantes).
 * Élimine les doublons : quand 4 cassettes affichent le même film,
 * une seule texture GPU est chargée au lieu de 4.
 *
 * Utilise un compteur de références pour disposer proprement
 * quand plus aucun composant n'utilise la texture.
 */

interface CacheEntry {
  texture: THREE.Texture
  refCount: number
}

const cache = new Map<string, CacheEntry>()
const loader = new THREE.TextureLoader()

export const TextureCache = {
  /**
   * Obtenir (ou charger) une texture par URL.
   * Incrémente le compteur de références.
   */
  acquire(url: string, colorSpace = THREE.SRGBColorSpace, anisotropy = 16): THREE.Texture {
    const existing = cache.get(url)
    if (existing) {
      existing.refCount++
      return existing.texture
    }

    const tex = loader.load(url)
    tex.colorSpace = colorSpace
    tex.anisotropy = anisotropy

    cache.set(url, { texture: tex, refCount: 1 })
    return tex
  },

  /**
   * Relâcher une référence à une texture.
   * Quand refCount atteint 0, la texture est disposée et retirée du cache.
   */
  release(url: string): void {
    const entry = cache.get(url)
    if (!entry) return

    entry.refCount--
    if (entry.refCount <= 0) {
      entry.texture.dispose()
      cache.delete(url)
    }
  },

  /** Nombre de textures en cache (debug) */
  get size(): number {
    return cache.size
  },
}
