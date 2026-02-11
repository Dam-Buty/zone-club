// Geometry helper functions for creating 3D primitives
// Vertex format: position (3), uv (2), normal (3) = 8 floats = 32 bytes

export interface Mesh {
  vertices: Float32Array;
  indices: Uint16Array;
}

// Create a box (cube) mesh
export function createBox(width: number, height: number, depth: number): Mesh {
  const w = width / 2;
  const h = height / 2;
  const d = depth / 2;

  // prettier-ignore
  const vertices = new Float32Array([
    // Front face
    -w, -h,  d,  0, 1,  0, 0, 1,
     w, -h,  d,  1, 1,  0, 0, 1,
     w,  h,  d,  1, 0,  0, 0, 1,
    -w,  h,  d,  0, 0,  0, 0, 1,

    // Back face
     w, -h, -d,  0, 1,  0, 0, -1,
    -w, -h, -d,  1, 1,  0, 0, -1,
    -w,  h, -d,  1, 0,  0, 0, -1,
     w,  h, -d,  0, 0,  0, 0, -1,

    // Top face
    -w,  h,  d,  0, 1,  0, 1, 0,
     w,  h,  d,  1, 1,  0, 1, 0,
     w,  h, -d,  1, 0,  0, 1, 0,
    -w,  h, -d,  0, 0,  0, 1, 0,

    // Bottom face
    -w, -h, -d,  0, 1,  0, -1, 0,
     w, -h, -d,  1, 1,  0, -1, 0,
     w, -h,  d,  1, 0,  0, -1, 0,
    -w, -h,  d,  0, 0,  0, -1, 0,

    // Right face
     w, -h,  d,  0, 1,  1, 0, 0,
     w, -h, -d,  1, 1,  1, 0, 0,
     w,  h, -d,  1, 0,  1, 0, 0,
     w,  h,  d,  0, 0,  1, 0, 0,

    // Left face
    -w, -h, -d,  0, 1,  -1, 0, 0,
    -w, -h,  d,  1, 1,  -1, 0, 0,
    -w,  h,  d,  1, 0,  -1, 0, 0,
    -w,  h, -d,  0, 0,  -1, 0, 0,
  ]);

  // prettier-ignore
  const indices = new Uint16Array([
    0,  1,  2,  0,  2,  3,  // front
    4,  5,  6,  4,  6,  7,  // back
    8,  9,  10, 8,  10, 11, // top
    12, 13, 14, 12, 14, 15, // bottom
    16, 17, 18, 16, 18, 19, // right
    20, 21, 22, 20, 22, 23, // left
  ]);

  return { vertices, indices };
}

// Create a plane (floor, wall, etc.)
export function createPlane(width: number, depth: number, tilesX = 1, tilesZ = 1): Mesh {
  const w = width / 2;
  const d = depth / 2;

  // prettier-ignore
  const vertices = new Float32Array([
    -w, 0, -d,  0,      0,       0, 1, 0,
     w, 0, -d,  tilesX, 0,       0, 1, 0,
     w, 0,  d,  tilesX, tilesZ,  0, 1, 0,
    -w, 0,  d,  0,      tilesZ,  0, 1, 0,
  ]);

  const indices = new Uint16Array([0, 2, 1, 0, 3, 2]);

  return { vertices, indices };
}

// Create ceiling plane (facing downward, normal pointing down)
export function createCeiling(width: number, depth: number, tilesX = 1, tilesZ = 1): Mesh {
  const w = width / 2;
  const d = depth / 2;

  // prettier-ignore
  // Normal pointing DOWN (0, -1, 0) for ceiling viewed from below
  const vertices = new Float32Array([
    -w, 0, -d,  0,      0,       0, -1, 0,
     w, 0, -d,  tilesX, 0,       0, -1, 0,
     w, 0,  d,  tilesX, tilesZ,  0, -1, 0,
    -w, 0,  d,  0,      tilesZ,  0, -1, 0,
  ]);

  // Reversed winding order for correct face culling
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  return { vertices, indices };
}

// Create VHS cassette geometry (simplified box with front face for poster)
export function createCassette(): Mesh {
  // VHS/DVD box dimensions - +20% size
  const width = 0.162;  // ~16.2cm width
  const height = 0.228; // ~22.8cm height
  const depth = 0.018;  // ~1.8cm depth

  return createBox(width, height, depth);
}

// Create shelf geometry
export function createShelf(width: number, height: number, depth: number): Mesh {
  return createBox(width, height, depth);
}

// Create a vertical plane (for walls, signs)
export function createVerticalPlane(width: number, height: number): Mesh {
  const w = width / 2;
  const h = height / 2;

  // prettier-ignore
  const vertices = new Float32Array([
    -w, -h, 0,  0, 1,  0, 0, 1,
     w, -h, 0,  1, 1,  0, 0, 1,
     w,  h, 0,  1, 0,  0, 0, 1,
    -w,  h, 0,  0, 0,  0, 0, 1,
  ]);

  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  return { vertices, indices };
}

// Create neon tube geometry (simplified cylinder as boxes)
export function createNeonTube(length: number, radius: number = 0.02): Mesh {
  // Simplified as a thin box
  return createBox(length, radius * 2, radius * 2);
}
