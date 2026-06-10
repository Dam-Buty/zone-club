import * as THREE from 'three/webgpu'

// Dimensions de la pièce (basées sur le plan PDF, réduites de 30%)
// Source unique — importé par Aisle, Controls, DustParticles, etc.
export const ROOM_WIDTH = 9    // x axis
export const ROOM_DEPTH = 8.5  // z axis
export const ROOM_HEIGHT = 2.8

// Shared wall material — peinture SATINÉE lisse, identique pour tous les murs intérieurs
// (Aisle merged walls + Storefront wall). Single allocation = 1 GPU pipeline.
// #d4b080 (tan orangé saturé) lisait « sale » sous la GI chaude bakée — teinte désaturée vers un
// greige chaud + roughness satinée (feedback user 10/06 : « mur lisse, peinture satinée »).
export const SHARED_WALL_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#cfc2a8',
  roughness: 0.42,
  metalness: 0.0,
  envMapIntensity: 0.70,
})
