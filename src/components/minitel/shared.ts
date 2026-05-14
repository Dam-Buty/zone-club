// Single source of truth for minitel paging + aisle order, shared between
// MinitelOverlay (DOM/keyboard state machine) and MinitelScreen (canvas
// renderer). Both files used to redeclare these and drifted (see commit
// 3d5867a "PAGE_SIZE sync between files").
import type { AisleType } from '../../types'

// Generic page size for paginated screens (rayons aisle list, rayons films,
// alpha). 7 fits comfortably above the CRT bezel curve (visible bottom ≈ y=305
// on the 384-px texture).
export const PAGE_SIZE = 7

// Recherche has extra vertical chrome above the list (TITRE input + label),
// pushing the first row ~40 px lower than the other paginated screens, so it
// caps at one fewer row.
export const RECHERCHE_PAGE_SIZE = 6

export const AISLES_ORDER: AisleType[] = [
  'action', 'aventure', 'bizarre', 'classiques', 'comedie',
  'drame', 'horreur', 'policier', 'romance', 'sf',
  'thriller', 'animation', 'nouveautes',
]
