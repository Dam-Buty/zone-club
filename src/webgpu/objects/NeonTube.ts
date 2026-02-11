// NeonTube - 3D neon tube geometry for realistic neon signs
// Uses capsule/cylinder primitives from ProceduralGeometry

import { type Mesh, createCapsule, createCylinder } from '../core/ProceduralGeometry';

// Default values
const DEFAULT_TUBE_RADIUS = 0.025; // 2.5cm
const DEFAULT_SEGMENTS = 12;

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

// Helper to calculate cross product
function cross(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number
): [number, number, number] {
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx
  ];
}

// Helper to merge multiple meshes into one
function mergeMeshes(meshes: Mesh[]): Mesh {
  let totalVertices = 0;
  let totalIndices = 0;

  for (const mesh of meshes) {
    totalVertices += mesh.vertices.length;
    totalIndices += mesh.indices.length;
  }

  const vertices = new Float32Array(totalVertices);
  const indices = new Uint16Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;
  let baseVertex = 0;

  for (const mesh of meshes) {
    // Copy vertices
    vertices.set(mesh.vertices, vertexOffset);
    vertexOffset += mesh.vertices.length;

    // Copy indices with offset
    for (let i = 0; i < mesh.indices.length; i++) {
      indices[indexOffset + i] = mesh.indices[i] + baseVertex;
    }
    indexOffset += mesh.indices.length;
    baseVertex += mesh.vertices.length / 8;
  }

  return { vertices, indices };
}

// Helper to transform a mesh (translate and rotate)
function transformMesh(
  mesh: Mesh,
  tx: number, ty: number, tz: number,
  rotationMatrix?: number[]
): Mesh {
  const vertices = new Float32Array(mesh.vertices.length);

  for (let i = 0; i < mesh.vertices.length; i += 8) {
    let px = mesh.vertices[i];
    let py = mesh.vertices[i + 1];
    let pz = mesh.vertices[i + 2];
    const u = mesh.vertices[i + 3];
    const v = mesh.vertices[i + 4];
    let nx = mesh.vertices[i + 5];
    let ny = mesh.vertices[i + 6];
    let nz = mesh.vertices[i + 7];

    // Apply rotation if provided (3x3 matrix in row-major order)
    if (rotationMatrix) {
      const newPx = rotationMatrix[0] * px + rotationMatrix[1] * py + rotationMatrix[2] * pz;
      const newPy = rotationMatrix[3] * px + rotationMatrix[4] * py + rotationMatrix[5] * pz;
      const newPz = rotationMatrix[6] * px + rotationMatrix[7] * py + rotationMatrix[8] * pz;
      px = newPx;
      py = newPy;
      pz = newPz;

      const newNx = rotationMatrix[0] * nx + rotationMatrix[1] * ny + rotationMatrix[2] * nz;
      const newNy = rotationMatrix[3] * nx + rotationMatrix[4] * ny + rotationMatrix[5] * nz;
      const newNz = rotationMatrix[6] * nx + rotationMatrix[7] * ny + rotationMatrix[8] * nz;
      nx = newNx;
      ny = newNy;
      nz = newNz;
    }

    // Apply translation
    vertices[i] = px + tx;
    vertices[i + 1] = py + ty;
    vertices[i + 2] = pz + tz;
    vertices[i + 3] = u;
    vertices[i + 4] = v;
    vertices[i + 5] = nx;
    vertices[i + 6] = ny;
    vertices[i + 7] = nz;
  }

  return { vertices, indices: new Uint16Array(mesh.indices) };
}

// Create rotation matrix to align Y-axis with given direction
function createAlignmentMatrix(
  dirX: number, dirY: number, dirZ: number
): number[] {
  // Normalize direction
  const [dx, dy, dz] = normalize(dirX, dirY, dirZ);

  // Find perpendicular vectors
  // Use different up vector if direction is too close to Y-axis
  let upX = 0, upY = 1, upZ = 0;
  if (Math.abs(dy) > 0.99) {
    upX = 1; upY = 0; upZ = 0;
  }

  // Right = up x direction
  const [rx, ry, rz] = normalize(...cross(upX, upY, upZ, dx, dy, dz));

  // Recompute up = direction x right
  const [ux, uy, uz] = cross(dx, dy, dz, rx, ry, rz);

  // Return 3x3 rotation matrix (row-major)
  // Maps Y-axis to direction, X to right, Z to up
  return [
    rx, dx, ux,
    ry, dy, uy,
    rz, dz, uz
  ];
}

/**
 * Create a straight neon tube segment
 * Uses capsule geometry (cylinder with hemispherical caps)
 * Oriented horizontally along the X-axis by default
 *
 * @param length - Length of the tube
 * @param radius - Tube radius (default 0.025m = 2.5cm)
 * @param segments - Radial segments (default 12)
 */
export function createNeonTube(
  length: number,
  radius: number = DEFAULT_TUBE_RADIUS,
  segments: number = DEFAULT_SEGMENTS
): Mesh {
  // Create a capsule (oriented along Y by default in ProceduralGeometry)
  const capsule = createCapsule(radius, length, segments, Math.ceil(segments / 3));

  // Rotate to align along X-axis (rotate -90 degrees around Z)
  const rotationMatrix = [
    0, -1, 0,
    1, 0, 0,
    0, 0, 1
  ];

  return transformMesh(capsule, 0, 0, 0, rotationMatrix);
}

/**
 * Create a neon tube following a path of points
 * Useful for curved tubes and letters
 * Creates cylinder segments between points with sphere joints
 *
 * @param path - Array of 3D points [x, y, z]
 * @param radius - Tube radius (default 0.025m = 2.5cm)
 * @param segments - Radial segments (default 12)
 */
export function createNeonTubePath(
  path: [number, number, number][],
  radius: number = DEFAULT_TUBE_RADIUS,
  segments: number = DEFAULT_SEGMENTS
): Mesh {
  if (path.length < 2) {
    throw new Error('Path must have at least 2 points');
  }

  const meshes: Mesh[] = [];

  // Add sphere at the start
  meshes.push(createSphere(radius, segments, path[0][0], path[0][1], path[0][2]));

  // Create segments between consecutive points
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];

    // Calculate direction and length
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dz = p2[2] - p1[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (length < 0.0001) continue; // Skip zero-length segments

    // Create cylinder for this segment
    const cylinder = createCylinder(radius, length, segments, 1, true);

    // Create rotation matrix to align cylinder with segment direction
    const rotationMatrix = createAlignmentMatrix(dx, dy, dz);

    // Calculate midpoint for translation
    const midX = (p1[0] + p2[0]) / 2;
    const midY = (p1[1] + p2[1]) / 2;
    const midZ = (p1[2] + p2[2]) / 2;

    // Transform and add cylinder
    meshes.push(transformMesh(cylinder, midX, midY, midZ, rotationMatrix));

    // Add sphere at junction (except at the end)
    if (i < path.length - 2) {
      meshes.push(createSphere(radius, segments, p2[0], p2[1], p2[2]));
    }
  }

  // Add sphere at the end
  const lastPoint = path[path.length - 1];
  meshes.push(createSphere(radius, segments, lastPoint[0], lastPoint[1], lastPoint[2]));

  return mergeMeshes(meshes);
}

// Helper function to create a sphere (for joints)
function createSphere(
  radius: number,
  segments: number,
  cx: number,
  cy: number,
  cz: number
): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  const latSegments = Math.ceil(segments / 2);
  const lonSegments = segments;

  // Generate sphere vertices
  for (let lat = 0; lat <= latSegments; lat++) {
    const theta = (lat / latSegments) * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= lonSegments; lon++) {
      const phi = (lon / lonSegments) * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const nx = cosPhi * sinTheta;
      const ny = cosTheta;
      const nz = sinPhi * sinTheta;

      const px = cx + radius * nx;
      const py = cy + radius * ny;
      const pz = cz + radius * nz;

      const u = lon / lonSegments;
      const v = lat / latSegments;

      pushVertex(vertices, px, py, pz, u, v, nx, ny, nz);
    }
  }

  // Generate sphere indices
  for (let lat = 0; lat < latSegments; lat++) {
    for (let lon = 0; lon < lonSegments; lon++) {
      const a = lat * (lonSegments + 1) + lon;
      const b = a + 1;
      const c = a + (lonSegments + 1);
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices)
  };
}

/**
 * Create a rectangular neon frame with rounded corners
 * The frame is centered at origin, lying in the XY plane
 *
 * @param width - Frame width (outer dimension)
 * @param height - Frame height (outer dimension)
 * @param tubeRadius - Radius of the tube (default 0.025m = 2.5cm)
 * @param cornerRadius - Radius of corners (default = tubeRadius * 2)
 * @param segments - Radial segments (default 12)
 */
export function createNeonFrame(
  width: number,
  height: number,
  tubeRadius: number = DEFAULT_TUBE_RADIUS,
  cornerRadius?: number,
  segments: number = DEFAULT_SEGMENTS
): Mesh {
  const cr = cornerRadius ?? tubeRadius * 2;
  const meshes: Mesh[] = [];

  // Calculate inner dimensions (where tubes run)
  const innerWidth = width - 2 * cr;
  const innerHeight = height - 2 * cr;

  // Half dimensions for positioning
  const hw = width / 2 - cr;
  const hh = height / 2 - cr;

  // Create 4 straight tube segments (open-ended cylinders)
  // Top tube (horizontal)
  if (innerWidth > 0) {
    const topTube = createCylinder(tubeRadius, innerWidth, segments, 1, true);
    const rotMatrix = [0, -1, 0, 1, 0, 0, 0, 0, 1]; // Rotate to X-axis
    meshes.push(transformMesh(topTube, 0, hh, 0, rotMatrix));
  }

  // Bottom tube (horizontal)
  if (innerWidth > 0) {
    const bottomTube = createCylinder(tubeRadius, innerWidth, segments, 1, true);
    const rotMatrix = [0, -1, 0, 1, 0, 0, 0, 0, 1]; // Rotate to X-axis
    meshes.push(transformMesh(bottomTube, 0, -hh, 0, rotMatrix));
  }

  // Left tube (vertical)
  if (innerHeight > 0) {
    const leftTube = createCylinder(tubeRadius, innerHeight, segments, 1, true);
    meshes.push(transformMesh(leftTube, -hw, 0, 0));
  }

  // Right tube (vertical)
  if (innerHeight > 0) {
    const rightTube = createCylinder(tubeRadius, innerHeight, segments, 1, true);
    meshes.push(transformMesh(rightTube, hw, 0, 0));
  }

  // Create 4 corner arcs (90 degree each)
  const cornerPositions = [
    { x: hw, y: hh, startAngle: 0 },        // Top-right
    { x: -hw, y: hh, startAngle: Math.PI / 2 },   // Top-left
    { x: -hw, y: -hh, startAngle: Math.PI },      // Bottom-left
    { x: hw, y: -hh, startAngle: 3 * Math.PI / 2 } // Bottom-right
  ];

  const arcSegments = Math.max(4, Math.ceil(segments / 2));

  for (const corner of cornerPositions) {
    meshes.push(createCornerArc(
      corner.x,
      corner.y,
      cr,
      tubeRadius,
      corner.startAngle,
      segments,
      arcSegments
    ));
  }

  return mergeMeshes(meshes);
}

// Helper function to create a 90-degree corner arc (torus segment)
function createCornerArc(
  cx: number,
  cy: number,
  majorRadius: number,  // Distance from tube center to arc center
  minorRadius: number,  // Tube radius
  startAngle: number,   // Starting angle of the arc
  tubeSegments: number, // Segments around the tube
  arcSegments: number   // Segments along the arc
): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  const arcAngle = Math.PI / 2; // 90 degrees

  // Generate torus segment vertices
  for (let i = 0; i <= arcSegments; i++) {
    const u = i / arcSegments;
    const theta = startAngle + u * arcAngle;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);

    // Center of tube cross-section at this point
    const tubeX = cx + majorRadius * cosTheta;
    const tubeY = cy + majorRadius * sinTheta;

    for (let j = 0; j <= tubeSegments; j++) {
      const v = j / tubeSegments;
      const phi = v * Math.PI * 2;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      // Normal direction (pointing outward from tube)
      const nx = cosTheta * cosPhi;
      const ny = sinTheta * cosPhi;
      const nz = sinPhi;

      // Position
      const px = tubeX + minorRadius * nx;
      const py = tubeY + minorRadius * ny;
      const pz = minorRadius * sinPhi;

      pushVertex(vertices, px, py, pz, u, v, nx, ny, nz);
    }
  }

  // Generate indices
  for (let i = 0; i < arcSegments; i++) {
    for (let j = 0; j < tubeSegments; j++) {
      const a = i * (tubeSegments + 1) + j;
      const b = a + 1;
      const c = a + (tubeSegments + 1);
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices)
  };
}

/**
 * Create small metal support brackets for neon tubes
 * A U-shaped bracket that clips around the tube
 *
 * @param tubeRadius - Radius of the tube being supported (default 0.025m)
 */
export function createNeonSupport(
  tubeRadius: number = DEFAULT_TUBE_RADIUS
): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  // Support dimensions
  const bracketThickness = tubeRadius * 0.3;
  const bracketWidth = tubeRadius * 0.5;
  const bracketGap = tubeRadius * 1.1; // Slightly larger than tube diameter
  const bracketHeight = tubeRadius * 1.5;
  const stemLength = tubeRadius * 2;

  // Create U-shaped bracket profile
  // The U wraps around the tube from below

  const segments = 8;
  const arcRadius = bracketGap + bracketThickness / 2;

  // Left arm of U
  const leftArmVerts: [number, number, number, number, number, number][] = [];
  for (let i = 0; i <= 1; i++) {
    const y = -bracketHeight + i * bracketHeight;
    leftArmVerts.push([
      -arcRadius - bracketThickness / 2, y, -bracketWidth / 2,
      -1, 0, 0
    ]);
    leftArmVerts.push([
      -arcRadius + bracketThickness / 2, y, -bracketWidth / 2,
      1, 0, 0
    ]);
    leftArmVerts.push([
      -arcRadius + bracketThickness / 2, y, bracketWidth / 2,
      1, 0, 0
    ]);
    leftArmVerts.push([
      -arcRadius - bracketThickness / 2, y, bracketWidth / 2,
      -1, 0, 0
    ]);
  }

  // Add left arm vertices
  const leftArmBase = vertices.length / 8;
  for (const [px, py, pz, nx, ny, nz] of leftArmVerts) {
    pushVertex(vertices, px, py, pz, 0, 0, nx, ny, nz);
  }

  // Left arm indices (4 faces)
  indices.push(leftArmBase + 0, leftArmBase + 4, leftArmBase + 1);
  indices.push(leftArmBase + 1, leftArmBase + 4, leftArmBase + 5);
  indices.push(leftArmBase + 1, leftArmBase + 5, leftArmBase + 2);
  indices.push(leftArmBase + 2, leftArmBase + 5, leftArmBase + 6);
  indices.push(leftArmBase + 2, leftArmBase + 6, leftArmBase + 3);
  indices.push(leftArmBase + 3, leftArmBase + 6, leftArmBase + 7);
  indices.push(leftArmBase + 3, leftArmBase + 7, leftArmBase + 0);
  indices.push(leftArmBase + 0, leftArmBase + 7, leftArmBase + 4);

  // Right arm of U (mirror of left)
  const rightArmBase = vertices.length / 8;
  for (const [px, py, pz, nx, ny, nz] of leftArmVerts) {
    pushVertex(vertices, -px, py, pz, 0, 0, -nx, ny, nz);
  }

  // Right arm indices
  indices.push(rightArmBase + 0, rightArmBase + 1, rightArmBase + 4);
  indices.push(rightArmBase + 1, rightArmBase + 5, rightArmBase + 4);
  indices.push(rightArmBase + 1, rightArmBase + 2, rightArmBase + 5);
  indices.push(rightArmBase + 2, rightArmBase + 6, rightArmBase + 5);
  indices.push(rightArmBase + 2, rightArmBase + 3, rightArmBase + 6);
  indices.push(rightArmBase + 3, rightArmBase + 7, rightArmBase + 6);
  indices.push(rightArmBase + 3, rightArmBase + 0, rightArmBase + 7);
  indices.push(rightArmBase + 0, rightArmBase + 4, rightArmBase + 7);

  // Bottom curve of U (arc connecting left and right arms)
  const arcBase = vertices.length / 8;
  for (let i = 0; i <= segments; i++) {
    const angle = Math.PI + (i / segments) * Math.PI; // 180 to 360 degrees
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Outer edge
    const outerR = arcRadius + bracketThickness / 2;
    pushVertex(vertices,
      cosA * outerR, sinA * outerR, -bracketWidth / 2,
      0, 0, cosA, sinA, 0
    );
    pushVertex(vertices,
      cosA * outerR, sinA * outerR, bracketWidth / 2,
      0, 0, cosA, sinA, 0
    );

    // Inner edge
    const innerR = arcRadius - bracketThickness / 2;
    pushVertex(vertices,
      cosA * innerR, sinA * innerR, -bracketWidth / 2,
      0, 0, -cosA, -sinA, 0
    );
    pushVertex(vertices,
      cosA * innerR, sinA * innerR, bracketWidth / 2,
      0, 0, -cosA, -sinA, 0
    );
  }

  // Arc indices
  for (let i = 0; i < segments; i++) {
    const base = arcBase + i * 4;

    // Outer surface
    indices.push(base + 0, base + 4, base + 1);
    indices.push(base + 1, base + 4, base + 5);

    // Inner surface
    indices.push(base + 2, base + 3, base + 6);
    indices.push(base + 3, base + 7, base + 6);

    // Front face (z = -bracketWidth/2)
    indices.push(base + 0, base + 2, base + 4);
    indices.push(base + 2, base + 6, base + 4);

    // Back face (z = bracketWidth/2)
    indices.push(base + 1, base + 5, base + 3);
    indices.push(base + 3, base + 5, base + 7);
  }

  // Mounting stem (goes down from bottom of U)
  const stemBase = vertices.length / 8;
  const stemWidth = bracketWidth * 0.8;
  const stemThickness = bracketThickness;
  const stemTop = -arcRadius - bracketThickness / 2;
  const stemBottom = stemTop - stemLength;

  // Stem vertices
  const stemVerts = [
    // Top face
    [-stemThickness / 2, stemTop, -stemWidth / 2],
    [stemThickness / 2, stemTop, -stemWidth / 2],
    [stemThickness / 2, stemTop, stemWidth / 2],
    [-stemThickness / 2, stemTop, stemWidth / 2],
    // Bottom face
    [-stemThickness / 2, stemBottom, -stemWidth / 2],
    [stemThickness / 2, stemBottom, -stemWidth / 2],
    [stemThickness / 2, stemBottom, stemWidth / 2],
    [-stemThickness / 2, stemBottom, stemWidth / 2],
  ];

  for (const [px, py, pz] of stemVerts) {
    pushVertex(vertices, px, py, pz, 0, 0, 0, 0, 0);
  }

  // Stem faces
  // Front (-Z)
  indices.push(stemBase + 0, stemBase + 1, stemBase + 5);
  indices.push(stemBase + 0, stemBase + 5, stemBase + 4);
  // Back (+Z)
  indices.push(stemBase + 2, stemBase + 3, stemBase + 7);
  indices.push(stemBase + 2, stemBase + 7, stemBase + 6);
  // Left (-X)
  indices.push(stemBase + 3, stemBase + 0, stemBase + 4);
  indices.push(stemBase + 3, stemBase + 4, stemBase + 7);
  // Right (+X)
  indices.push(stemBase + 1, stemBase + 2, stemBase + 6);
  indices.push(stemBase + 1, stemBase + 6, stemBase + 5);
  // Bottom (-Y)
  indices.push(stemBase + 4, stemBase + 5, stemBase + 6);
  indices.push(stemBase + 4, stemBase + 6, stemBase + 7);

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices)
  };
}
