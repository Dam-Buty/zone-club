import type { AisleType } from '../types'

const AISLE_LABELS: Record<string, string> = {
  action: 'ACTION',
  aventure: 'AVENTURE',
  bizarre: 'BIZARRE',
  classiques: 'CLASSIQUES',
  comedie: 'COMEDIE',
  drame: 'DRAME',
  horreur: 'HORREUR',
  policier: 'POLICIER',
  romance: 'ROMANCE',
  sf: 'SF',
  thriller: 'THRILLER',
  animation: 'ANIMATION',
  nouveautes: 'NOUVEAUTES',
}

export function aisleLabel(aisle: AisleType | string): string {
  return AISLE_LABELS[aisle] || String(aisle).toUpperCase()
}

/**
 * Parse a cassetteKey to a human-readable location.
 * Wall format:   wall-{x}-{z}-{row}-{col}
 * Island format: island-{n}-{side}-{row}-{col} (or island-{side}-{row}-{col} for first island)
 */
export function cassetteKeyToHumanLocation(key: string, aisle: AisleType | string): string {
  const aisleStr = aisleLabel(aisle)
  const parts = key.split('-')
  // Last 2 parts are always row-col (numeric)
  const row = parts[parts.length - 2]
  const col = parts[parts.length - 1]
  if (key.startsWith('island')) {
    const sideIdx = parts.findIndex((p) => p === 'left' || p === 'right')
    const side = sideIdx >= 0 ? (parts[sideIdx] === 'left' ? 'GAUCHE' : 'DROITE') : ''
    return `${aisleStr} - ILOT ${side} - ETAGERE ${parseInt(row, 10) + 1} POSITION ${parseInt(col, 10) + 1}`
  }
  return `${aisleStr} - ETAGERE ${parseInt(row, 10) + 1} POSITION ${parseInt(col, 10) + 1}`
}
