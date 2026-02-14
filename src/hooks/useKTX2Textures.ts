import { useMemo, useEffect } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

type ThreeRendererLike = THREE.WebGLRenderer & {
  isWebGPURenderer?: boolean
  isWebGLRenderer?: boolean
  hasFeature?: (feature: string) => boolean
}

function canUseKTX2WithRenderer(renderer: ThreeRendererLike): boolean {
  const isKnownRenderer = renderer.isWebGLRenderer === true || renderer.isWebGPURenderer === true
  if (!isKnownRenderer) return false

  try {
    const probe = new KTX2Loader()
    probe.setTranscoderPath('/basis/')
    probe.detectSupport(renderer)
    probe.dispose()
    return true
  } catch {
    return false
  }
}

/**
 * Load PBR textures with KTX2 when renderer support is valid, otherwise JPEG fallback.
 * KTX2Loader in three r182 supports both WebGLRenderer and WebGPURenderer.
 */
export function useKTX2Textures(
  basePath: string,
  repeatX: number,
  repeatY: number,
  hasAO = false
): Record<string, THREE.Texture> {
  const gl = useThree(state => state.gl) as unknown as ThreeRendererLike

  const canUseKTX2 = useMemo(() => canUseKTX2WithRenderer(gl), [gl])

  const paths = useMemo(() => {
    if (canUseKTX2) {
      const compressed = [
        `${basePath}/color.ktx2`,
        `${basePath}/normal.ktx2`,
        `${basePath}/roughness.ktx2`,
      ]
      if (hasAO) compressed.push(`${basePath}/ao.ktx2`)
      return compressed
    }

    const jpg = [
      `${basePath}/color.jpg`,
      `${basePath}/normal.jpg`,
      `${basePath}/roughness.jpg`,
    ]
    if (hasAO) jpg.push(`${basePath}/ao.jpg`)
    return jpg
  }, [basePath, hasAO, canUseKTX2])

  const textures = useLoader(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (canUseKTX2 ? KTX2Loader : THREE.TextureLoader) as any,
    paths,
    (loader) => {
      if (!canUseKTX2) return

      const ktx2Loader = loader as KTX2Loader
      ktx2Loader.setTranscoderPath('/basis/')
      ktx2Loader.detectSupport(gl)
    }
  )

  useEffect(() => {
    if (!canUseKTX2) {
      console.warn(`[useKTX2Textures] KTX2 unsupported with current renderer, fallback JPEG for ${basePath}`)
    }
  }, [canUseKTX2, basePath])

  useMemo(() => {
    const textureArray = Array.isArray(textures) ? textures : [textures]
    textureArray.forEach((tex, i) => {
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(repeatX, repeatY)
      tex.anisotropy = 16

      if (canUseKTX2) {
        tex.minFilter = THREE.LinearMipmapNearestFilter
        tex.magFilter = THREE.LinearFilter
        tex.generateMipmaps = false // mipmaps are already in KTX2
      } else {
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
      }

      if (i === 0) {
        tex.colorSpace = THREE.SRGBColorSpace
      } else {
        tex.colorSpace = THREE.LinearSRGBColorSpace
      }
    })
  }, [textures, repeatX, repeatY, canUseKTX2])

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
