// La devanture d'abord.
//
// Tout ce qui précharge l'intérieur — le chunk 3D, la HDR, les KTX2, les GLB, les jaquettes —
// pèse plus de 20 Mo et partait dès le chargement de la page, devant le code de la devanture
// elle-même. Sur une connexion à 20 Mbit/s, le visiteur regardait un écran noir pendant une
// dizaine de secondes, puis l'indicateur « PUSH » flottant sur du noir.
//
// Ces préchargements s'inscrivent ici et ne partent qu'une fois la devanture à l'écran
// (ExteriorView appelle releaseInteriorPreload). Rien n'est perdu : ils tournent pendant que
// le visiteur regarde la vitrine, comme avant.

//
// Sans WebGPU, la vanne ne s'ouvre jamais : le vidéoclub 3D est inaccessible à ces appareils,
// qui louent par la borne. Ni le chunk 3D, ni ses assets, ni le service worker (dont
// l'installation précharge ces mêmes assets) ne doivent leur être envoyés.

let released = false;
const waiting: Array<() => void> = [];

/** Vrai si le navigateur expose WebGPU. Relu à chaque appel : `navigator.gpu` ne change pas en cours de session. */
export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/** Exécute `task` dès que la devanture est affichée (tout de suite si c'est déjà le cas). */
export function afterStorefront(task: () => void): void {
  if (released) task();
  else waiting.push(task);
}

/**
 * Ouvre la vanne. Idempotent ; appelé à l'affichage de la devanture et, par sécurité, à l'entrée.
 * Ne fait rien sans WebGPU.
 */
export function releaseInteriorPreload(): void {
  if (released) return;
  if (!hasWebGPU()) return;
  released = true;
  for (const task of waiting.splice(0)) {
    try {
      task();
    } catch {
      // Un préchargement en échec ne doit pas retenir les autres.
    }
  }
}
