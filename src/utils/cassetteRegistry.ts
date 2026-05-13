import * as THREE from 'three'

// Module-level registry of all cassette world positions, keyed by cassetteKey.
// Populated by Aisle.tsx after building all instances; consumed by CassetteHighlight
// to position the 3D halo on the right cassette.
const _registry = new Map<string, THREE.Vector3>()

export function setCassetteRegistry(entries: Array<{ cassetteKey: string; worldPosition: THREE.Vector3 }>): void {
  _registry.clear()
  for (const e of entries) {
    _registry.set(e.cassetteKey, e.worldPosition.clone())
  }
}

export function getCassetteWorldPosition(key: string): THREE.Vector3 | null {
  const p = _registry.get(key)
  return p ? p.clone() : null
}
