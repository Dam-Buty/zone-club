// Procedural Geometry - Advanced 3D primitives
// Vertex format: position (3), uv (2), normal (3) = 8 floats = 32 bytes

export interface Mesh {
  vertices: Float32Array;
  indices: Uint16Array;
}

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

// Helper to normalize a vector
function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) return [0, 1, 0];
  return [x / len, y / len, z / len];
}

/**
 * Create a box with rounded corners
 * @param width - Width (X axis)
 * @param height - Height (Y axis)
 * @param depth - Depth (Z axis)
 * @param radius - Corner radius (should be < min(w,h,d)/2)
 * @param segments - Number of segments for the rounded parts (default 4)
 */
export function createRoundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  segments: number = 4
): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  // Clamp radius to valid range
  const maxRadius = Math.min(width, height, depth) / 2 - 0.001;
  const r = Math.min(radius, maxRadius);

  // Inner dimensions (box without rounded edges)
  const hw = width / 2 - r;
  const hh = height / 2 - r;
  const hd = depth / 2 - r;

  // 8 corner centers
  const corners = [
    [-hw, -hh, -hd], // 0: back-bottom-left
    [ hw, -hh, -hd], // 1: back-bottom-right
    [ hw,  hh, -hd], // 2: back-top-right
    [-hw,  hh, -hd], // 3: back-top-left
    [-hw, -hh,  hd], // 4: front-bottom-left
    [ hw, -hh,  hd], // 5: front-bottom-right
    [ hw,  hh,  hd], // 6: front-top-right
    [-hw,  hh,  hd], // 7: front-top-left
  ];

  // Corner octant directions (which portion of sphere to create)
  const octants = [
    [-1, -1, -1], // 0
    [ 1, -1, -1], // 1
    [ 1,  1, -1], // 2
    [-1,  1, -1], // 3
    [-1, -1,  1], // 4
    [ 1, -1,  1], // 5
    [ 1,  1,  1], // 6
    [-1,  1,  1], // 7
  ];

  // Create rounded corners (sphere octants)
  for (let c = 0; c < 8; c++) {
    const [cx, cy, cz] = corners[c];
    const [ox, oy, oz] = octants[c];
    const baseIndex = vertices.length / 8;

    // Generate vertices for this octant
    for (let j = 0; j <= segments; j++) {
      const phi = (Math.PI / 2) * (j / segments);
      for (let i = 0; i <= segments; i++) {
        const theta = (Math.PI / 2) * (i / segments);

        // Direction in octant space
        const dx = Math.sin(phi) * Math.cos(theta) * ox;
        const dy = Math.cos(phi) * oy;
        const dz = Math.sin(phi) * Math.sin(theta) * oz;

        const [nx, ny, nz] = normalize(dx, dy, dz);
        const px = cx + nx * r;
        const py = cy + ny * r;
        const pz = cz + nz * r;

        // UV based on normal direction
        const u = (nx + 1) / 2;
        const v = (ny + 1) / 2;

        pushVertex(vertices, px, py, pz, u, v, nx, ny, nz);
      }
    }

    // Generate indices for this octant
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = baseIndex + j * (segments + 1) + i;
        const b = a + 1;
        const c = a + (segments + 1);
        const d = c + 1;

        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }
  }

  // Create 12 edge cylinders (connecting rounded corners)
  const edgePairs = [
    // Bottom edges (Y = -hh)
    [0, 1, 'x'], [1, 5, 'z'], [5, 4, 'x'], [4, 0, 'z'],
    // Top edges (Y = hh)
    [3, 2, 'x'], [2, 6, 'z'], [6, 7, 'x'], [7, 3, 'z'],
    // Vertical edges
    [0, 3, 'y'], [1, 2, 'y'], [5, 6, 'y'], [4, 7, 'y'],
  ];

  for (const [c1, c2, axis] of edgePairs) {
    const p1 = corners[c1 as number];
    const p2 = corners[c2 as number];
    const baseIndex = vertices.length / 8;

    // Determine which axis is the edge direction
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const otherAxes = [0, 1, 2].filter(i => i !== axisIdx);

    // Get perpendicular direction for the cylinder arc
    const perpDir1 = [0, 0, 0];
    const perpDir2 = [0, 0, 0];
    perpDir1[otherAxes[0]] = Math.sign(p1[otherAxes[0]] + 0.001);
    perpDir2[otherAxes[1]] = Math.sign(p1[otherAxes[1]] + 0.001);

    // Create cylinder segment vertices
    for (let j = 0; j <= 1; j++) {
      const t = j;
      const basePos = [
        p1[0] + (p2[0] - p1[0]) * t,
        p1[1] + (p2[1] - p1[1]) * t,
        p1[2] + (p2[2] - p1[2]) * t,
      ];

      for (let i = 0; i <= segments; i++) {
        const angle = (Math.PI / 2) * (i / segments);
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        const nx = perpDir1[0] * c + perpDir2[0] * s;
        const ny = perpDir1[1] * c + perpDir2[1] * s;
        const nz = perpDir1[2] * c + perpDir2[2] * s;

        const px = basePos[0] + nx * r;
        const py = basePos[1] + ny * r;
        const pz = basePos[2] + nz * r;

        const u = i / segments;
        const v = j;

        pushVertex(vertices, px, py, pz, u, v, nx, ny, nz);
      }
    }

    // Generate indices
    for (let i = 0; i < segments; i++) {
      const a = baseIndex + i;
      const b = a + 1;
      const c = a + (segments + 1);
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // Create 6 flat faces
  const faces = [
    { // Front (+Z)
      corners: [[hw, -hh, hd + r], [-hw, -hh, hd + r], [-hw, hh, hd + r], [hw, hh, hd + r]],
      normal: [0, 0, 1],
    },
    { // Back (-Z)
      corners: [[-hw, -hh, -hd - r], [hw, -hh, -hd - r], [hw, hh, -hd - r], [-hw, hh, -hd - r]],
      normal: [0, 0, -1],
    },
    { // Right (+X)
      corners: [[hw + r, -hh, hd], [hw + r, -hh, -hd], [hw + r, hh, -hd], [hw + r, hh, hd]],
      normal: [1, 0, 0],
    },
    { // Left (-X)
      corners: [[-hw - r, -hh, -hd], [-hw - r, -hh, hd], [-hw - r, hh, hd], [-hw - r, hh, -hd]],
      normal: [-1, 0, 0],
    },
    { // Top (+Y)
      corners: [[-hw, hh + r, hd], [hw, hh + r, hd], [hw, hh + r, -hd], [-hw, hh + r, -hd]],
      normal: [0, 1, 0],
    },
    { // Bottom (-Y)
      corners: [[-hw, -hh - r, -hd], [hw, -hh - r, -hd], [hw, -hh - r, hd], [-hw, -hh - r, hd]],
      normal: [0, -1, 0],
    },
  ];

  for (const face of faces) {
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

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

/**
 * Create a box with beveled (chamfered) edges
 * @param width - Width (X axis)
 * @param height - Height (Y axis)
 * @param depth - Depth (Z axis)
 * @param bevel - Bevel size (chamfer distance)
 */
export function createBeveledBox(
  width: number,
  height: number,
  depth: number,
  bevel: number
): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  // Clamp bevel to valid range
  const maxBevel = Math.min(width, height, depth) / 2 - 0.001;
  const b = Math.min(bevel, maxBevel);

  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;

  // 6 main faces (inset by bevel)
  const mainFaces = [
    { // Front (+Z)
      corners: [
        [hw - b, -hh + b, hd], [-hw + b, -hh + b, hd],
        [-hw + b, hh - b, hd], [hw - b, hh - b, hd]
      ],
      normal: [0, 0, 1],
    },
    { // Back (-Z)
      corners: [
        [-hw + b, -hh + b, -hd], [hw - b, -hh + b, -hd],
        [hw - b, hh - b, -hd], [-hw + b, hh - b, -hd]
      ],
      normal: [0, 0, -1],
    },
    { // Right (+X)
      corners: [
        [hw, -hh + b, hd - b], [hw, -hh + b, -hd + b],
        [hw, hh - b, -hd + b], [hw, hh - b, hd - b]
      ],
      normal: [1, 0, 0],
    },
    { // Left (-X)
      corners: [
        [-hw, -hh + b, -hd + b], [-hw, -hh + b, hd - b],
        [-hw, hh - b, hd - b], [-hw, hh - b, -hd + b]
      ],
      normal: [-1, 0, 0],
    },
    { // Top (+Y)
      corners: [
        [-hw + b, hh, hd - b], [hw - b, hh, hd - b],
        [hw - b, hh, -hd + b], [-hw + b, hh, -hd + b]
      ],
      normal: [0, 1, 0],
    },
    { // Bottom (-Y)
      corners: [
        [-hw + b, -hh, -hd + b], [hw - b, -hh, -hd + b],
        [hw - b, -hh, hd - b], [-hw + b, -hh, hd - b]
      ],
      normal: [0, -1, 0],
    },
  ];

  // Add main faces
  for (const face of mainFaces) {
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

  // 12 beveled edge faces
  const sqrt2inv = 1 / Math.sqrt(2);
  const edgeFaces = [
    // Front edges
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

  // 8 corner triangles
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
 * Create a cylinder
 * @param radius - Cylinder radius
 * @param height - Cylinder height
 * @param radialSegments - Number of segments around (default 16)
 * @param heightSegments - Number of segments along height (default 1)
 * @param openEnded - If true, no caps (default false)
 */
export function createCylinder(
  radius: number,
  height: number,
  radialSegments: number = 16,
  heightSegments: number = 1,
  openEnded: boolean = false
): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  const halfHeight = height / 2;

  // Create the cylinder body
  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const py = -halfHeight + height * v;

    for (let i = 0; i <= radialSegments; i++) {
      const u = i / radialSegments;
      const theta = u * Math.PI * 2;

      const nx = Math.cos(theta);
      const nz = Math.sin(theta);
      const px = nx * radius;
      const pz = nz * radius;

      pushVertex(vertices, px, py, pz, u, 1 - v, nx, 0, nz);
    }
  }

  // Generate body indices
  for (let y = 0; y < heightSegments; y++) {
    for (let i = 0; i < radialSegments; i++) {
      const a = y * (radialSegments + 1) + i;
      const b = a + 1;
      const c = a + (radialSegments + 1);
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // Create caps if not open ended
  if (!openEnded) {
    // Top cap
    const topCenterIndex = vertices.length / 8;
    pushVertex(vertices, 0, halfHeight, 0, 0.5, 0.5, 0, 1, 0);

    for (let i = 0; i <= radialSegments; i++) {
      const u = i / radialSegments;
      const theta = u * Math.PI * 2;
      const nx = Math.cos(theta);
      const nz = Math.sin(theta);
      const px = nx * radius;
      const pz = nz * radius;

      pushVertex(vertices, px, halfHeight, pz, (nx + 1) / 2, (nz + 1) / 2, 0, 1, 0);
    }

    for (let i = 0; i < radialSegments; i++) {
      indices.push(topCenterIndex, topCenterIndex + 1 + i, topCenterIndex + 2 + i);
    }

    // Bottom cap
    const bottomCenterIndex = vertices.length / 8;
    pushVertex(vertices, 0, -halfHeight, 0, 0.5, 0.5, 0, -1, 0);

    for (let i = 0; i <= radialSegments; i++) {
      const u = i / radialSegments;
      const theta = u * Math.PI * 2;
      const nx = Math.cos(theta);
      const nz = Math.sin(theta);
      const px = nx * radius;
      const pz = nz * radius;

      pushVertex(vertices, px, -halfHeight, pz, (nx + 1) / 2, 1 - (nz + 1) / 2, 0, -1, 0);
    }

    for (let i = 0; i < radialSegments; i++) {
      indices.push(bottomCenterIndex, bottomCenterIndex + 2 + i, bottomCenterIndex + 1 + i);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

/**
 * Create a capsule (cylinder with hemispherical caps)
 * @param radius - Capsule radius
 * @param height - Total height including caps
 * @param radialSegments - Number of segments around (default 16)
 * @param capSegments - Number of segments for each cap (default 4)
 */
export function createCapsule(
  radius: number,
  height: number,
  radialSegments: number = 16,
  capSegments: number = 4
): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  // Cylinder body height (total height minus two radii for the caps)
  const bodyHeight = Math.max(0, height - 2 * radius);
  const halfBodyHeight = bodyHeight / 2;

  // Top hemisphere
  const topBaseIndex = vertices.length / 8;
  for (let y = 0; y <= capSegments; y++) {
    const phi = (Math.PI / 2) * (1 - y / capSegments); // 90 to 0 degrees
    const ringRadius = Math.cos(phi) * radius;
    const py = halfBodyHeight + Math.sin(phi) * radius;

    for (let i = 0; i <= radialSegments; i++) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const nx = Math.cos(theta) * Math.cos(phi);
      const ny = Math.sin(phi);
      const nz = Math.sin(theta) * Math.cos(phi);

      const px = Math.cos(theta) * ringRadius;
      const pz = Math.sin(theta) * ringRadius;

      const u = i / radialSegments;
      const v = (halfBodyHeight + radius - py) / (bodyHeight + 2 * radius);

      pushVertex(vertices, px, py, pz, u, v, nx, ny, nz);
    }
  }

  // Generate top hemisphere indices
  for (let y = 0; y < capSegments; y++) {
    for (let i = 0; i < radialSegments; i++) {
      const a = topBaseIndex + y * (radialSegments + 1) + i;
      const b = a + 1;
      const c = a + (radialSegments + 1);
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // Cylinder body (only if bodyHeight > 0)
  if (bodyHeight > 0) {
    const bodyBaseIndex = vertices.length / 8;

    // Top ring of body (connects to hemisphere)
    for (let i = 0; i <= radialSegments; i++) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const nx = Math.cos(theta);
      const nz = Math.sin(theta);
      const px = nx * radius;
      const pz = nz * radius;

      const u = i / radialSegments;
      const v = radius / (bodyHeight + 2 * radius);

      pushVertex(vertices, px, halfBodyHeight, pz, u, v, nx, 0, nz);
    }

    // Bottom ring of body
    for (let i = 0; i <= radialSegments; i++) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const nx = Math.cos(theta);
      const nz = Math.sin(theta);
      const px = nx * radius;
      const pz = nz * radius;

      const u = i / radialSegments;
      const v = (radius + bodyHeight) / (bodyHeight + 2 * radius);

      pushVertex(vertices, px, -halfBodyHeight, pz, u, v, nx, 0, nz);
    }

    // Connect top hemisphere to body top
    const topHemiLastRow = topBaseIndex + capSegments * (radialSegments + 1);
    for (let i = 0; i < radialSegments; i++) {
      const a = topHemiLastRow + i;
      const b = a + 1;
      const c = bodyBaseIndex + i;
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }

    // Body indices
    for (let i = 0; i < radialSegments; i++) {
      const a = bodyBaseIndex + i;
      const b = a + 1;
      const c = bodyBaseIndex + (radialSegments + 1) + i;
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // Bottom hemisphere
  const bottomBaseIndex = vertices.length / 8;
  for (let y = 0; y <= capSegments; y++) {
    const phi = (Math.PI / 2) * (y / capSegments); // 0 to 90 degrees
    const ringRadius = Math.cos(phi) * radius;
    const py = -halfBodyHeight - Math.sin(phi) * radius;

    for (let i = 0; i <= radialSegments; i++) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const nx = Math.cos(theta) * Math.cos(phi);
      const ny = -Math.sin(phi);
      const nz = Math.sin(theta) * Math.cos(phi);

      const px = Math.cos(theta) * ringRadius;
      const pz = Math.sin(theta) * ringRadius;

      const u = i / radialSegments;
      const v = (halfBodyHeight + radius - py) / (bodyHeight + 2 * radius);

      pushVertex(vertices, px, py, pz, u, v, nx, ny, nz);
    }
  }

  // Connect body/top hemisphere to bottom hemisphere
  if (bodyHeight > 0) {
    const bodyBottomRow = vertices.length / 8 - (capSegments + 1) * (radialSegments + 1) - (radialSegments + 1);
    for (let i = 0; i < radialSegments; i++) {
      const a = bodyBottomRow + i;
      const b = a + 1;
      const c = bottomBaseIndex + i;
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  } else {
    // Connect top hemisphere directly to bottom hemisphere
    const topHemiLastRow = topBaseIndex + capSegments * (radialSegments + 1);
    for (let i = 0; i < radialSegments; i++) {
      const a = topHemiLastRow + i;
      const b = a + 1;
      const c = bottomBaseIndex + i;
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // Generate bottom hemisphere indices
  for (let y = 0; y < capSegments; y++) {
    for (let i = 0; i < radialSegments; i++) {
      const a = bottomBaseIndex + y * (radialSegments + 1) + i;
      const b = a + 1;
      const c = a + (radialSegments + 1);
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}
