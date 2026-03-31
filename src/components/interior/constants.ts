import * as THREE from 'three/webgpu'

// Dimensions de la pièce (basées sur le plan PDF, réduites de 30%)
// Source unique — importé par Aisle, Controls, DustParticles, etc.
export const ROOM_WIDTH = 9    // x axis
export const ROOM_DEPTH = 8.5  // z axis
export const ROOM_HEIGHT = 2.8

// Shared wall material — identical painted smooth plaster for all interior walls
// (Aisle merged walls + Storefront wall). Single allocation = 1 GPU pipeline.
export const SHARED_WALL_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#d4b080',
  roughness: 0.38,
  metalness: 0.0,
  envMapIntensity: 0.70,
})
