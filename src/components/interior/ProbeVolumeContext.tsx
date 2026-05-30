import { createContext, useContext } from 'react'
import type * as THREE from 'three/webgpu'

/** The 3 SH-L1 irradiance volumes (one per colour channel) baked in Phase 2, published by
 *  BakedShellLighting and consumed by the receivers (K7, planks, manager, TV). */
export interface ProbeVolumes {
  shR: THREE.Data3DTexture
  shG: THREE.Data3DTexture
  shB: THREE.Data3DTexture
}

export const ProbeVolumeContext = createContext<ProbeVolumes | null>(null)

export const useProbeVolumes = (): ProbeVolumes | null => useContext(ProbeVolumeContext)
