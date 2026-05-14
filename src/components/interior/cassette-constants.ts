// VHS cassette geometry + fallback palette. Extracted from the legacy
// Cassette.tsx component (replaced by CassetteInstances). The 4 consumers
// (Aisle, WallShelf, IslandShelf, CassetteInstances) only need the two
// constants below — the rest of Cassette.tsx was dead code.

// Dimensions in metres — real-world ratio 1.79:1 (18.8 × 10.5 cm) × scale 1.2.
export const CASSETTE_DIMENSIONS = {
  width: 0.127,   // 10.5 cm × 1.2
  height: 0.228,  // 18.8 cm × 1.2
  depth: 0.03,    //  2.5 cm × 1.2
} as const

// Fallback solid colours when a cassette has no poster yet.
export const CASSETTE_COLORS = [
  '#1a1a2e', '#16213e', '#0f3460', '#533483',
  '#2c3e50', '#34495e', '#1e3d59', '#3d5a80',
] as const
