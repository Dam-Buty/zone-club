import { useMemo } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

/**
 * Singleton KTX2Loader — shared across all hook instances.
 * detectSupport() is called once with the first renderer that uses it.
 */
let _ktx2Loader: KTX2Loader | null = null
let _supportDetected = false

function getKTX2Loader(gl: THREE.WebGLRenderer): KTX2Loader {
  if (!_ktx2Loader) {
    _ktx2Loader = new KTX2Loader()
    _ktx2Loader.setTranscoderPath('/basis/')
  }
  if (!_supportDetected) {
    _ktx2Loader.detectSupport(gl)
    _supportDetected = true
  }
  return _ktx2Loader
}

/**
 * Load KTX2-compressed PBR textures with tiling and anisotropic filtering.
 * Hardware-compressed textures (BC7 on desktop, ASTC on mobile) — 4x less VRAM.
 *
 * @param basePath - Base path to texture directory (e.g. '/textures/floor')
 * @param repeatX - Texture repeat X
 * @param repeatY - Texture repeat Y
 * @param hasAO - Whether an AO map exists
 * @returns Object with map, normalMap, roughnessMap, and optionally aoMap
 */
export function useKTX2Textures(
  basePath: string,
  repeatX: number,
  repeatY: number,
  hasAO = false
): Record<string, THREE.Texture> {
  const gl = useThree(state => state.gl)

  const paths = useMemo(() => {
    const p = [
      `${basePath}/color.ktx2`,
      `${basePath}/normal.ktx2`,
      `${basePath}/roughness.ktx2`,
    ]
    if (hasAO) {
      p.push(`${basePath}/ao.ktx2`)
    }
    return p
  }, [basePath, hasAO])

  const textures = useLoader(KTX2Loader, paths, (loader) => {
    loader.setTranscoderPath('/basis/')
    loader.detectSupport(gl)
  })

  // Configure tiling + anisotropy (same logic as usePBRTextures)
  useMemo(() => {
    const textureArray = Array.isArray(textures) ? textures : [textures]
    textureArray.forEach((tex, i) => {
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(repeatX, repeatY)
      tex.anisotropy = 16
      // Bilinear + nearest mip: sharper than trilinear at distance, less blur
      tex.minFilter = THREE.LinearMipmapNearestFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = false // mipmaps are already in the KTX2 file
      // Color map (index 0) needs sRGB, others are linear data
      if (i === 0) {
        tex.colorSpace = THREE.SRGBColorSpace
      } else {
        tex.colorSpace = THREE.LinearSRGBColorSpace
      }
    })
  }, [textures, repeatX, repeatY])

  const textureArray = Array.isArray(textures) ? textures : [textures]
  const result: Record<string, THREE.Texture> = {
    map: textureArray[0],
    normalMap: textureArray[1],
    roughnessMap: textureArray[2],
  }
  if (hasAO && textureArray[3]) {
    result.aoMap = textureArray[3]
  }

  return result
}
