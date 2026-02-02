/**
 * VHS Cassette Box - Detailed geometry with beveled edges
 *
 * Dimensions based on standard VHS cassette case:
 * - Width:  16.2cm (X axis)
 * - Height: 22.8cm (Y axis)
 * - Depth:  1.8cm  (Z axis)
 */

import { type Mesh, createBeveledBox } from '../core/ProceduralGeometry';

/**
 * Cassette dimensions (in meters, for positioning and collision)
 */
export const CASSETTE_DIMENSIONS = {
  width: 0.162,   // 16.2cm - X axis
  height: 0.228,  // 22.8cm - Y axis
  depth: 0.018,   // 1.8cm  - Z axis
  bevel: 0.002,   // 2mm bevel on all edges
} as const;

/**
 * Label groove dimensions (for future texture mapping reference)
 */
export const LABEL_DIMENSIONS = {
  width: 0.14,    // 14cm - centered on front face
  height: 0.19,   // 19cm - centered on front face
  depth: 0.0005,  // 0.5mm depression
  offsetY: 0.005, // Slightly higher than center
} as const;

// Helper to push a vertex and return its index
function pushVertex(
  vertices: number[],
  px: number, py: number, pz: number,
  u: number, v: number,
  nx: number, ny: number, nz: number
): number {
  const index = vertices.length / 8;
  vertices.push(px, py, pz, u, v, nx, ny, nz);
  return index;
}

/**
 * Create a detailed VHS cassette box with beveled edges
 *
 * Uses createBeveledBox for clean chamfered edges that catch light nicely.
 * The geometry is centered at origin.
 *
 * @returns Mesh with vertices and indices ready for WebGPU
 *
 * Vertex count: ~98 vertices (6 main faces + 12 edge bevels + 8 corner triangles)
 * Triangle count: ~44 triangles
 */
export function createDetailedCassette(): Mesh {
  return createBeveledBox(
    CASSETTE_DIMENSIONS.width,
    CASSETTE_DIMENSIONS.height,
    CASSETTE_DIMENSIONS.depth,
    CASSETTE_DIMENSIONS.bevel
  );
}

/**
 * Create a detailed VHS cassette with label groove on front face
 *
 * This version adds a subtle depression on the front face where the
 * label would be placed, adding realism and better texture mapping support.
 *
 * @returns Mesh with vertices and indices
 *
 * Vertex count: ~130 vertices
 * Triangle count: ~60 triangles
 */
export function createDetailedCassetteWithGroove(): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  const { width, height, depth, bevel } = CASSETTE_DIMENSIONS;
  const { width: labelW, height: labelH, depth: labelD, offsetY } = LABEL_DIMENSIONS;

  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;
  const b = bevel;

  // Get the base beveled box
  const baseBox = createBeveledBox(width, height, depth, bevel);

  // Copy all vertices except the front face (we'll rebuild it with groove)
  // The front face is the first face in createBeveledBox, vertices 0-3
  // We need to identify front face vertices and replace them

  // For simplicity, we'll build the entire cassette manually with groove
  // This gives us more control over the label area

  // ============================================
  // BACK FACE (-Z) - standard flat face with bevel inset
  // ============================================
  {
    const baseIndex = vertices.length / 8;
    const corners = [
      [-hw + b, -hh + b, -hd],
      [hw - b, -hh + b, -hd],
      [hw - b, hh - b, -hd],
      [-hw + b, hh - b, -hd]
    ];

    for (let i = 0; i < 4; i++) {
      const [px, py, pz] = corners[i];
      const u = i === 0 || i === 3 ? 0 : 1;
      const v = i < 2 ? 1 : 0;
      pushVertex(vertices, px, py, pz, u, v, 0, 0, -1);
    }

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
  }

  // ============================================
  // FRONT FACE (+Z) - with label groove
  // ============================================
  {
    // Front face is divided into:
    // - Outer frame (around the label area)
    // - Label groove (slightly recessed)

    const frontZ = hd;
    const grooveZ = hd - labelD;

    // Label area bounds
    const labelLeft = -labelW / 2;
    const labelRight = labelW / 2;
    const labelBottom = -labelH / 2 + offsetY;
    const labelTop = labelH / 2 + offsetY;

    // Outer face bounds (with bevel inset)
    const outerLeft = -hw + b;
    const outerRight = hw - b;
    const outerBottom = -hh + b;
    const outerTop = hh - b;

    // Create the outer frame as 4 quads around the label groove
    // Top strip
    {
      const baseIndex = vertices.length / 8;
      pushVertex(vertices, outerLeft, labelTop, frontZ, 0, 0, 0, 0, 1);
      pushVertex(vertices, outerRight, labelTop, frontZ, 1, 0, 0, 0, 1);
      pushVertex(vertices, outerRight, outerTop, frontZ, 1, 1, 0, 0, 1);
      pushVertex(vertices, outerLeft, outerTop, frontZ, 0, 1, 0, 0, 1);

      indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
    }

    // Bottom strip
    {
      const baseIndex = vertices.length / 8;
      pushVertex(vertices, outerLeft, outerBottom, frontZ, 0, 0, 0, 0, 1);
      pushVertex(vertices, outerRight, outerBottom, frontZ, 1, 0, 0, 0, 1);
      pushVertex(vertices, outerRight, labelBottom, frontZ, 1, 1, 0, 0, 1);
      pushVertex(vertices, outerLeft, labelBottom, frontZ, 0, 1, 0, 0, 1);

      indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
    }

    // Left strip
    {
      const baseIndex = vertices.length / 8;
      pushVertex(vertices, outerLeft, labelBottom, frontZ, 0, 0, 0, 0, 1);
      pushVertex(vertices, labelLeft, labelBottom, frontZ, 1, 0, 0, 0, 1);
      pushVertex(vertices, labelLeft, labelTop, frontZ, 1, 1, 0, 0, 1);
      pushVertex(vertices, outerLeft, labelTop, frontZ, 0, 1, 0, 0, 1);

      indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
    }

    // Right strip
    {
      const baseIndex = vertices.length / 8;
      pushVertex(vertices, labelRight, labelBottom, frontZ, 0, 0, 0, 0, 1);
      pushVertex(vertices, outerRight, labelBottom, frontZ, 1, 0, 0, 0, 1);
      pushVertex(vertices, outerRight, labelTop, frontZ, 1, 1, 0, 0, 1);
      pushVertex(vertices, labelRight, labelTop, frontZ, 0, 1, 0, 0, 1);

      indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
    }

    // Label groove (recessed quad)
    {
      const baseIndex = vertices.length / 8;
      // UVs map 0-1 across the label for texture mapping
      pushVertex(vertices, labelLeft, labelBottom, grooveZ, 0, 0, 0, 0, 1);
      pushVertex(vertices, labelRight, labelBottom, grooveZ, 1, 0, 0, 0, 1);
      pushVertex(vertices, labelRight, labelTop, grooveZ, 1, 1, 0, 0, 1);
      pushVertex(vertices, labelLeft, labelTop, grooveZ, 0, 1, 0, 0, 1);

      indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
    }

    // Groove walls (4 small faces connecting outer to inner)
    // Top wall
    {
      const baseIndex = vertices.length / 8;
      pushVertex(vertices, labelLeft, labelTop, frontZ, 0, 0, 0, 1, 0);
      pushVertex(vertices, labelRight, labelTop, frontZ, 1, 0, 0, 1, 0);
      pushVertex(vertices, labelRight, labelTop, grooveZ, 1, 1, 0, 1, 0);
      pushVertex(vertices, labelLeft, labelTop, grooveZ, 0, 1, 0, 1, 0);

      indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
    }

    // Bottom wall
    {
      const baseIndex = vertices.length / 8;
      pushVertex(vertices, labelLeft, labelBottom, grooveZ, 0, 0, 0, -1, 0);
      pushVertex(vertices, labelRight, labelBottom, grooveZ, 1, 0, 0, -1, 0);
      pushVertex(vertices, labelRight, labelBottom, frontZ, 1, 1, 0, -1, 0);
      pushVertex(vertices, labelLeft, labelBottom, frontZ, 0, 1, 0, -1, 0);

      indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
    }

    // Left wall
    {
      const baseIndex = vertices.length / 8;
      pushVertex(vertices, labelLeft, labelBottom, grooveZ, 0, 0, -1, 0, 0);
      pushVertex(vertices, labelLeft, labelBottom, frontZ, 1, 0, -1, 0, 0);
      pushVertex(vertices, labelLeft, labelTop, frontZ, 1, 1, -1, 0, 0);
      pushVertex(vertices, labelLeft, labelTop, grooveZ, 0, 1, -1, 0, 0);

      indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
    }

    // Right wall
    {
      const baseIndex = vertices.length / 8;
      pushVertex(vertices, labelRight, labelBottom, frontZ, 0, 0, 1, 0, 0);
      pushVertex(vertices, labelRight, labelBottom, grooveZ, 1, 0, 1, 0, 0);
      pushVertex(vertices, labelRight, labelTop, grooveZ, 1, 1, 1, 0, 0);
      pushVertex(vertices, labelRight, labelTop, frontZ, 0, 1, 1, 0, 0);

      indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
    }
  }

  // ============================================
  // SIDE FACES (Left -X, Right +X)
  // ============================================
  // Right face (+X)
  {
    const baseIndex = vertices.length / 8;
    const corners = [
      [hw, -hh + b, hd - b],
      [hw, -hh + b, -hd + b],
      [hw, hh - b, -hd + b],
      [hw, hh - b, hd - b]
    ];

    for (let i = 0; i < 4; i++) {
      const [px, py, pz] = corners[i];
      const u = i === 0 || i === 3 ? 0 : 1;
      const v = i < 2 ? 1 : 0;
      pushVertex(vertices, px, py, pz, u, v, 1, 0, 0);
    }

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
  }

  // Left face (-X)
  {
    const baseIndex = vertices.length / 8;
    const corners = [
      [-hw, -hh + b, -hd + b],
      [-hw, -hh + b, hd - b],
      [-hw, hh - b, hd - b],
      [-hw, hh - b, -hd + b]
    ];

    for (let i = 0; i < 4; i++) {
      const [px, py, pz] = corners[i];
      const u = i === 0 || i === 3 ? 0 : 1;
      const v = i < 2 ? 1 : 0;
      pushVertex(vertices, px, py, pz, u, v, -1, 0, 0);
    }

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
  }

  // ============================================
  // TOP AND BOTTOM FACES
  // ============================================
  // Top face (+Y)
  {
    const baseIndex = vertices.length / 8;
    const corners = [
      [-hw + b, hh, hd - b],
      [hw - b, hh, hd - b],
      [hw - b, hh, -hd + b],
      [-hw + b, hh, -hd + b]
    ];

    for (let i = 0; i < 4; i++) {
      const [px, py, pz] = corners[i];
      const u = i === 0 || i === 3 ? 0 : 1;
      const v = i < 2 ? 1 : 0;
      pushVertex(vertices, px, py, pz, u, v, 0, 1, 0);
    }

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
  }

  // Bottom face (-Y)
  {
    const baseIndex = vertices.length / 8;
    const corners = [
      [-hw + b, -hh, -hd + b],
      [hw - b, -hh, -hd + b],
      [hw - b, -hh, hd - b],
      [-hw + b, -hh, hd - b]
    ];

    for (let i = 0; i < 4; i++) {
      const [px, py, pz] = corners[i];
      const u = i === 0 || i === 3 ? 0 : 1;
      const v = i < 2 ? 1 : 0;
      pushVertex(vertices, px, py, pz, u, v, 0, -1, 0);
    }

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
  }

  // ============================================
  // BEVELED EDGES (12 edge faces)
  // ============================================
  const sqrt2inv = 1 / Math.sqrt(2);
  const edgeFaces = [
    // Front edges (excluding groove area - simplified, full bevel)
    { corners: [[hw - b, -hh + b, hd], [hw, -hh + b, hd - b], [hw, hh - b, hd - b], [hw - b, hh - b, hd]], normal: [sqrt2inv, 0, sqrt2inv] },
    { corners: [[-hw, -hh + b, hd - b], [-hw + b, -hh + b, hd], [-hw + b, hh - b, hd], [-hw, hh - b, hd - b]], normal: [-sqrt2inv, 0, sqrt2inv] },
    { corners: [[-hw + b, hh - b, hd], [hw - b, hh - b, hd], [hw - b, hh, hd - b], [-hw + b, hh, hd - b]], normal: [0, sqrt2inv, sqrt2inv] },
    { corners: [[-hw + b, -hh, hd - b], [hw - b, -hh, hd - b], [hw - b, -hh + b, hd], [-hw + b, -hh + b, hd]], normal: [0, -sqrt2inv, sqrt2inv] },
    // Back edges
    { corners: [[hw, -hh + b, -hd + b], [hw - b, -hh + b, -hd], [hw - b, hh - b, -hd], [hw, hh - b, -hd + b]], normal: [sqrt2inv, 0, -sqrt2inv] },
    { corners: [[-hw + b, -hh + b, -hd], [-hw, -hh + b, -hd + b], [-hw, hh - b, -hd + b], [-hw + b, hh - b, -hd]], normal: [-sqrt2inv, 0, -sqrt2inv] },
    { corners: [[-hw + b, hh, -hd + b], [hw - b, hh, -hd + b], [hw - b, hh - b, -hd], [-hw + b, hh - b, -hd]], normal: [0, sqrt2inv, -sqrt2inv] },
    { corners: [[-hw + b, -hh + b, -hd], [hw - b, -hh + b, -hd], [hw - b, -hh, -hd + b], [-hw + b, -hh, -hd + b]], normal: [0, -sqrt2inv, -sqrt2inv] },
    // Top/bottom left/right edges
    { corners: [[hw, hh - b, hd - b], [hw, hh - b, -hd + b], [hw - b, hh, -hd + b], [hw - b, hh, hd - b]], normal: [sqrt2inv, sqrt2inv, 0] },
    { corners: [[-hw, hh - b, -hd + b], [-hw, hh - b, hd - b], [-hw + b, hh, hd - b], [-hw + b, hh, -hd + b]], normal: [-sqrt2inv, sqrt2inv, 0] },
    { corners: [[hw - b, -hh, hd - b], [hw - b, -hh, -hd + b], [hw, -hh + b, -hd + b], [hw, -hh + b, hd - b]], normal: [sqrt2inv, -sqrt2inv, 0] },
    { corners: [[-hw + b, -hh, -hd + b], [-hw + b, -hh, hd - b], [-hw, -hh + b, hd - b], [-hw, -hh + b, -hd + b]], normal: [-sqrt2inv, -sqrt2inv, 0] },
  ];

  for (const face of edgeFaces) {
    const baseIndex = vertices.length / 8;
    const [nx, ny, nz] = face.normal;

    for (let i = 0; i < 4; i++) {
      const [px, py, pz] = face.corners[i];
      const u = i === 0 || i === 3 ? 0 : 1;
      const v = i < 2 ? 1 : 0;
      pushVertex(vertices, px, py, pz, u, v, nx, ny, nz);
    }

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
  }

  // ============================================
  // CORNER TRIANGLES (8 corners)
  // ============================================
  const sqrt3inv = 1 / Math.sqrt(3);
  const cornerTris = [
    // Front corners
    { verts: [[hw - b, hh - b, hd], [hw, hh - b, hd - b], [hw - b, hh, hd - b]], normal: [sqrt3inv, sqrt3inv, sqrt3inv] },
    { verts: [[-hw + b, hh - b, hd], [-hw + b, hh, hd - b], [-hw, hh - b, hd - b]], normal: [-sqrt3inv, sqrt3inv, sqrt3inv] },
    { verts: [[hw - b, -hh + b, hd], [hw - b, -hh, hd - b], [hw, -hh + b, hd - b]], normal: [sqrt3inv, -sqrt3inv, sqrt3inv] },
    { verts: [[-hw + b, -hh + b, hd], [-hw, -hh + b, hd - b], [-hw + b, -hh, hd - b]], normal: [-sqrt3inv, -sqrt3inv, sqrt3inv] },
    // Back corners
    { verts: [[hw - b, hh - b, -hd], [hw - b, hh, -hd + b], [hw, hh - b, -hd + b]], normal: [sqrt3inv, sqrt3inv, -sqrt3inv] },
    { verts: [[-hw + b, hh - b, -hd], [-hw, hh - b, -hd + b], [-hw + b, hh, -hd + b]], normal: [-sqrt3inv, sqrt3inv, -sqrt3inv] },
    { verts: [[hw - b, -hh + b, -hd], [hw, -hh + b, -hd + b], [hw - b, -hh, -hd + b]], normal: [sqrt3inv, -sqrt3inv, -sqrt3inv] },
    { verts: [[-hw + b, -hh + b, -hd], [-hw + b, -hh, -hd + b], [-hw, -hh + b, -hd + b]], normal: [-sqrt3inv, -sqrt3inv, -sqrt3inv] },
  ];

  for (const tri of cornerTris) {
    const baseIndex = vertices.length / 8;
    const [nx, ny, nz] = tri.normal;

    for (let i = 0; i < 3; i++) {
      const [px, py, pz] = tri.verts[i];
      const u = i === 0 ? 0.5 : i === 1 ? 0 : 1;
      const v = i === 0 ? 0 : 1;
      pushVertex(vertices, px, py, pz, u, v, nx, ny, nz);
    }

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

/**
 * Create a simple cassette for LOD (Level of Detail) - uses basic beveled box
 * Good for distant cassettes or performance optimization
 */
export function createSimpleCassette(): Mesh {
  return createBeveledBox(
    CASSETTE_DIMENSIONS.width,
    CASSETTE_DIMENSIONS.height,
    CASSETTE_DIMENSIONS.depth,
    CASSETTE_DIMENSIONS.bevel
  );
}

// Re-export Mesh type for convenience
export type { Mesh };
