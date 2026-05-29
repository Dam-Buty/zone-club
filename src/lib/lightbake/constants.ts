// Bake constants for the néon-noir shell lightmap pipeline.
export const LIGHTMAP_RESOLUTION = 2048
export const SAMPLES_PER_LIGHT = 256
export const LIGHTMAP_SCALE = 4.0 // HDR→PNG pack divisor; runtime lightMapIntensity

// Mesh ids that make up the bakeable static shell (one shared atlas covers all).
export const BAKE_SHELL = [
  'floor', 'ceiling',
  'wall-north', 'wall-south', 'wall-left', 'wall-right',
  'shelf-0', 'shelf-1', 'shelf-2', 'shelf-3', 'shelf-4', 'shelf-5', 'shelf-6', 'shelf-7',
  'island-0', 'island-1',
] as const
export type BakeShellId = (typeof BAKE_SHELL)[number]
