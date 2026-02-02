// PBR Material system for WebGPU rendering
// Supports metallic-roughness workflow with emission

/**
 * PBR Material properties
 */
export interface PBRMaterial {
  name: string;

  // Base color (albedo) - RGB values 0-1
  albedo: [number, number, number];

  // Surface properties - values 0-1
  metallic: number; // 0 = dielectric (plastic, wood), 1 = metal
  roughness: number; // 0 = mirror, 1 = completely rough
  ao: number; // Ambient occlusion, 1 = no occlusion

  // Emission
  emissive: [number, number, number]; // RGB emission color
  emissiveIntensity: number; // Emission strength (can be > 1 for HDR)
}

/**
 * Create a PBR material with defaults
 */
export function createMaterial(
  name: string,
  albedo: [number, number, number],
  options?: Partial<Omit<PBRMaterial, 'name' | 'albedo'>>
): PBRMaterial {
  return {
    name,
    albedo,
    metallic: options?.metallic ?? 0.0,
    roughness: options?.roughness ?? 0.5,
    ao: options?.ao ?? 1.0,
    emissive: options?.emissive ?? [0, 0, 0],
    emissiveIntensity: options?.emissiveIntensity ?? 0.0,
  };
}

/**
 * Material library with predefined materials for the video club
 */
export const Materials = {
  // Woods
  WOOD_VARNISHED: createMaterial('Wood Varnished', [0.4, 0.25, 0.15], {
    metallic: 0.0,
    roughness: 0.35,
  }),

  WOOD_RAW: createMaterial('Wood Raw', [0.35, 0.22, 0.12], {
    metallic: 0.0,
    roughness: 0.8,
  }),

  // Plastics
  PLASTIC_VHS: createMaterial('Plastic VHS', [0.02, 0.02, 0.02], {
    metallic: 0.0,
    roughness: 0.4,
  }),

  PLASTIC_DARK: createMaterial('Plastic Dark', [0.03, 0.03, 0.03], {
    metallic: 0.0,
    roughness: 0.5,
  }),

  // Metals
  METAL_BRUSHED: createMaterial('Metal Brushed', [0.8, 0.8, 0.8], {
    metallic: 0.9,
    roughness: 0.4,
  }),

  CHROME: createMaterial('Chrome', [0.95, 0.95, 0.95], {
    metallic: 1.0,
    roughness: 0.1,
  }),

  // Surfaces
  TILE_FLOOR: createMaterial('Tile Floor', [0.15, 0.15, 0.18], {
    metallic: 0.0,
    roughness: 0.2,
  }),

  CONCRETE: createMaterial('Concrete', [0.5, 0.5, 0.48], {
    metallic: 0.0,
    roughness: 0.9,
  }),

  // Special - Neon lights (emissive materials)
  NEON_PINK: createMaterial('Neon Pink', [1.0, 0.18, 0.58], {
    metallic: 0.0,
    roughness: 1.0,
    emissive: [1.0, 0.18, 0.58],
    emissiveIntensity: 5.0,
  }),

  NEON_CYAN: createMaterial('Neon Cyan', [0.0, 1.0, 0.97], {
    metallic: 0.0,
    roughness: 1.0,
    emissive: [0.0, 1.0, 0.97],
    emissiveIntensity: 5.0,
  }),

  NEON_PURPLE: createMaterial('Neon Purple', [0.69, 0.15, 1.0], {
    metallic: 0.0,
    roughness: 1.0,
    emissive: [0.69, 0.15, 1.0],
    emissiveIntensity: 5.0,
  }),

  // Human materials
  SKIN: createMaterial('Skin', [0.87, 0.68, 0.55], {
    metallic: 0.0,
    roughness: 0.5,
  }),

  FABRIC_SHIRT: createMaterial('Fabric Shirt', [0.85, 0.2, 0.35], {
    metallic: 0.0,
    roughness: 0.9,
  }),

  DENIM: createMaterial('Denim', [0.2, 0.25, 0.4], {
    metallic: 0.0,
    roughness: 0.85,
  }),

  LEATHER_SHOE: createMaterial('Leather Shoe', [0.15, 0.1, 0.08], {
    metallic: 0.0,
    roughness: 0.6,
  }),
} as const;

/**
 * Pack material data into a Float32Array for GPU upload
 * Format: albedo(3) + metallic(1) + roughness(1) + ao(1) + emissive(3) + emissiveIntensity(1) + padding(2) = 12 floats
 *
 * GPU struct layout (48 bytes, aligned to 16):
 *   vec3 albedo;           // offset 0
 *   float metallic;        // offset 12
 *   float roughness;       // offset 16
 *   float ao;              // offset 20
 *   vec3 emissive;         // offset 24 (with padding)
 *   float emissiveIntensity; // offset 36
 *   vec2 _padding;         // offset 40 (alignment padding)
 */
export function packMaterial(material: PBRMaterial): Float32Array {
  const data = new Float32Array(12);

  // albedo (3 floats)
  data[0] = material.albedo[0];
  data[1] = material.albedo[1];
  data[2] = material.albedo[2];

  // metallic (1 float)
  data[3] = material.metallic;

  // roughness (1 float)
  data[4] = material.roughness;

  // ao (1 float)
  data[5] = material.ao;

  // emissive (3 floats)
  data[6] = material.emissive[0];
  data[7] = material.emissive[1];
  data[8] = material.emissive[2];

  // emissiveIntensity (1 float)
  data[9] = material.emissiveIntensity;

  // padding (2 floats) - initialized to 0 by Float32Array
  // data[10] = 0;
  // data[11] = 0;

  return data;
}

/**
 * Pack multiple materials into a single Float32Array for GPU buffer
 */
export function packMaterials(materials: PBRMaterial[]): Float32Array {
  const floatsPerMaterial = 12;
  const data = new Float32Array(materials.length * floatsPerMaterial);

  for (let i = 0; i < materials.length; i++) {
    const packed = packMaterial(materials[i]);
    data.set(packed, i * floatsPerMaterial);
  }

  return data;
}

/**
 * Get material by name from the Materials library
 */
export function getMaterialByName(name: string): PBRMaterial | undefined {
  const entries = Object.entries(Materials) as [string, PBRMaterial][];
  const found = entries.find(([_, mat]) => mat.name === name);
  return found ? found[1] : undefined;
}

/**
 * Clone a material with optional overrides
 */
export function cloneMaterial(
  material: PBRMaterial,
  overrides?: Partial<PBRMaterial>
): PBRMaterial {
  return {
    name: overrides?.name ?? material.name,
    albedo: overrides?.albedo ?? [...material.albedo],
    metallic: overrides?.metallic ?? material.metallic,
    roughness: overrides?.roughness ?? material.roughness,
    ao: overrides?.ao ?? material.ao,
    emissive: overrides?.emissive ?? [...material.emissive],
    emissiveIntensity: overrides?.emissiveIntensity ?? material.emissiveIntensity,
  };
}
