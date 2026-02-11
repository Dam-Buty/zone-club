import { useFrame } from '@react-three/fiber'
import { animateAllCassettes } from '../../utils/CassetteAnimationSystem'

/**
 * Composant singleton qui anime TOUTES les cassettes en un seul useFrame.
 * Remplace 521 callbacks individuels par 1 callback centralisé.
 * À placer une seule fois dans InteriorScene.
 */
export function CassetteAnimationLoop() {
  useFrame(({ camera }, delta) => {
    animateAllCassettes(camera, delta)
  })
  return null
}
