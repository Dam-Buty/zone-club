// Room dimensions — MUST mirror src/components/interior/constants.ts (ROOM_WIDTH/DEPTH/HEIGHT).
// Hardcoded (not imported) so this module stays pure: constants.ts pulls in `three/webgpu`, which
// breaks `node --test`. These dims are stable; keep them in sync if the room is ever resized.
const ROOM_WIDTH = 9    // x
const ROOM_DEPTH = 8.5  // z
const ROOM_HEIGHT = 2.8 // y

// ── Phase-2 SH-L1 probe grid ────────────────────────────────────────────────
// A regular 3D lattice covering the room + a 0.5 m margin, so any receiver inside the walls
// has a full 8-cell trilinear stencil. Probes sit at texel CENTRES (i+0.5)/G, so the world→uvw
// map is the bare normalized position clamped to the texel-centre band — no extra remap.

const MARGIN = 0.5
export const GRID_MIN: readonly [number, number, number] = [-ROOM_WIDTH / 2 - MARGIN, -MARGIN, -ROOM_DEPTH / 2 - MARGIN]
export const GRID_MAX: readonly [number, number, number] = [ROOM_WIDTH / 2 + MARGIN, ROOM_HEIGHT + MARGIN, ROOM_DEPTH / 2 + MARGIN]

// Literal spec spacing ≈ 1.0 m XZ / 0.7 m Y over the margined extent → 11×6×11.
// COARSENING KNOB (if M2 FPS margin is thin): drop to [9, 5, 9] = 405.
export const G: readonly [number, number, number] = [11, 6, 11]
export const PROBE_COUNT = G[0] * G[1] * G[2]

export const gridExt = (): [number, number, number] => [GRID_MAX[0] - GRID_MIN[0], GRID_MAX[1] - GRID_MIN[1], GRID_MAX[2] - GRID_MIN[2]]

export const flatIndex = (i: number, j: number, k: number): number => i + j * G[0] + k * G[0] * G[1]

/** World centre of probe (i,j,k). Texel-centred: probe i sits at (i+0.5)/G of the extent. */
export function probeWorld(i: number, j: number, k: number): [number, number, number] {
  const e = gridExt()
  return [
    GRID_MIN[0] + ((i + 0.5) / G[0]) * e[0],
    GRID_MIN[1] + ((j + 0.5) / G[1]) * e[1],
    GRID_MIN[2] + ((k + 0.5) / G[2]) * e[2],
  ]
}

/**
 * World point → [0,1]³ texture uvw. Since probes are texel-centred, uvw is just the normalized
 * position, clamped to [0.5/G, 1-0.5/G] so trilinear taps never read past ClampToEdge into a
 * neighbour-cell extrapolation. A probeWorld(i) maps back exactly to (i+0.5)/G.
 */
export function worldToUvwHalfTexel(p: readonly [number, number, number]): [number, number, number] {
  const e = gridExt()
  const out: [number, number, number] = [0, 0, 0]
  for (let a = 0; a < 3; a++) {
    const f = (p[a] - GRID_MIN[a]) / e[a]
    const half = 0.5 / G[a]
    out[a] = Math.min(1 - half, Math.max(half, f))
  }
  return out
}

// ── SH-L1 projection/reconstruction contract (the bake↔runtime math, mirrored in TSL) ──
const Y00 = 0.282095, Y1 = 0.488603       // real SH basis constants
const A0c0 = Math.PI * Y00                // 0.886227  (cosine-lobe band-0 × basis)
const A1c1 = (2 * Math.PI / 3) * Y1       // 1.023327  (cosine-lobe band-1 × basis)

export interface ShAcc { c0: number[]; c1: number[]; c2: number[]; c3: number[] }

export const newShAcc = (): ShAcc => ({ c0: [0, 0, 0], c1: [0, 0, 0], c2: [0, 0, 0], c3: [0, 0, 0] })

/** Accumulate one radiance sample L (rgb) arriving from unit direction dir onto raw L1 coeffs. */
export function projectSampleL1(acc: ShAcc, dir: number[], L: number[]): void {
  for (let ch = 0; ch < 3; ch++) {
    acc.c0[ch] += L[ch] * Y00          // L00
    acc.c1[ch] += L[ch] * Y1 * dir[1]  // L1-1 ∝ y
    acc.c2[ch] += L[ch] * Y1 * dir[2]  // L10  ∝ z
    acc.c3[ch] += L[ch] * Y1 * dir[0]  // L11  ∝ x
  }
}

/** Finalize the Monte-Carlo estimator: × 4π/N (full sphere). */
export function finalizeL1(acc: ShAcc, n: number): void {
  const w = (4 * Math.PI) / n
  for (let ch = 0; ch < 3; ch++) { acc.c0[ch] *= w; acc.c1[ch] *= w; acc.c2[ch] *= w; acc.c3[ch] *= w }
}

/** Reconstruct irradiance E(n) (rgb) from raw L1 coeffs. Mirrors the TSL runtime exactly. */
export function reconstructE(acc: ShAcc, n: number[]): number[] {
  const out = [0, 0, 0]
  for (let ch = 0; ch < 3; ch++) {
    const e = A0c0 * acc.c0[ch] + A1c1 * (acc.c1[ch] * n[1] + acc.c2[ch] * n[2] + acc.c3[ch] * n[0])
    out[ch] = Math.max(0, e)
  }
  return out
}

export const SH_RUNTIME_C0 = A0c0   // shared with the TSL helper so both use identical constants
export const SH_RUNTIME_C1 = A1c1

// ── Dead-probe handling (probes buried in islands/comptoir gather black → trilinear darkens K7) ──

/** Mark probes whose centre is inside any occluder AABB (from live collectShell occluders). */
export function classifyDeadProbes(occluderBoxes: { min: number[]; max: number[] }[]): Uint8Array {
  const valid = new Uint8Array(PROBE_COUNT).fill(1)
  for (let k = 0; k < G[2]; k++) for (let j = 0; j < G[1]; j++) for (let i = 0; i < G[0]; i++) {
    const w = probeWorld(i, j, k)
    const inside = occluderBoxes.some((bx) =>
      w[0] >= bx.min[0] && w[0] <= bx.max[0] && w[1] >= bx.min[1] && w[1] <= bx.max[1] && w[2] >= bx.min[2] && w[2] <= bx.max[2])
    if (inside) valid[flatIndex(i, j, k)] = 0
  }
  return valid
}

/** Jacobi flood-fill: each dead probe ← mean of its valid 6-neighbours, iterated until none remain.
 *  Mutates `channels` (each Float32Array of length PROBE_COUNT*4) and `valid` in place. */
export function floodFillDeadProbes(channels: Float32Array[], valid: Uint8Array, maxPasses = 8): void {
  const nb = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]]
  for (let pass = 0; pass < maxPasses; pass++) {
    let filled = 0
    const next = valid.slice()
    for (let k = 0; k < G[2]; k++) for (let j = 0; j < G[1]; j++) for (let i = 0; i < G[0]; i++) {
      const idx = flatIndex(i, j, k)
      if (valid[idx]) continue
      let n = 0
      const sum = channels.map(() => [0, 0, 0, 0])
      for (const [di, dj, dk] of nb) {
        const ii = i + di, jj = j + dj, kk = k + dk
        if (ii < 0 || ii >= G[0] || jj < 0 || jj >= G[1] || kk < 0 || kk >= G[2]) continue
        const nIdx = flatIndex(ii, jj, kk)
        if (!valid[nIdx]) continue
        n++
        channels.forEach((ch, c) => { for (let q = 0; q < 4; q++) sum[c][q] += ch[nIdx * 4 + q] })
      }
      if (n > 0) {
        channels.forEach((ch, c) => { for (let q = 0; q < 4; q++) ch[idx * 4 + q] = sum[c][q] / n })
        next[idx] = 1; filled++
      }
    }
    next.forEach((v, q) => { valid[q] = v })
    if (filled === 0) break
  }
}
