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
//
// La borne referme la vanne. Dès l'appui sur la borne, rien du vidéoclub 3D ne doit plus
// consommer : les téléchargements interruptibles (`whileStorefront`) sont coupés, et ce qui
// attendait la devanture attend son retour. Mesuré le 16/11/2026 sur le build de production,
// débit limité à 20 Mbit/s : 23 fichiers 3D étaient en cours à l'appui, 16 autres partaient
// après, et l'écran de la borne mettait 14,3 s à s'afficher derrière eux.
//
// Module sans import : il est chargé tel quel par Node dans les tests.

/** Vrai quand la devanture est à l'écran (et que la borne n'est pas ouverte). */
let open = false;
let controller: AbortController | null = null;
const waiting: Array<() => void> = [];
const repeatable: Array<(signal: AbortSignal) => void> = [];

function run(task: () => void): void {
  try {
    task();
  } catch {
    // Un préchargement en échec ne doit pas retenir les autres.
  }
}

/** Vrai si le navigateur expose WebGPU. Relu à chaque appel : `navigator.gpu` ne change pas en cours de session. */
export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/**
 * Exécute `task` UNE fois, dès que la devanture est affichée — tout de suite si elle l'est
 * déjà, à son retour si la borne est ouverte.
 */
export function afterStorefront(task: () => void): void {
  if (open) task();
  else waiting.push(task);
}

/**
 * Inscrit un téléchargement interruptible de l'intérieur. `task` reçoit un signal d'interruption
 * et repart à CHAQUE affichage de la devanture : à l'ouverture de la borne ses requêtes en cours
 * sont coupées, au retour elle est relancée (ce qui était déjà arrivé sort du cache).
 */
export function whileStorefront(task: (signal: AbortSignal) => void): void {
  repeatable.push(task);
  const signal = controller?.signal;
  if (open && signal) run(() => task(signal));
}

/**
 * Ouvre la vanne — ou la rouvre au retour de la borne. Idempotent ; appelé à chaque affichage de
 * la devanture et, par sécurité, à l'entrée. Ne fait rien sans WebGPU.
 */
export function releaseInteriorPreload(): void {
  if (open) return;
  if (!hasWebGPU()) return;
  open = true;
  const signal = (controller = new AbortController()).signal;
  for (const task of waiting.splice(0)) run(task);
  for (const task of [...repeatable]) run(() => task(signal));
}

/**
 * La vanne est-elle ouverte ? Faux avant la devanture, et dès l'appui sur la borne — alors que la
 * devanture reste à l'écran le temps du zoom : ce qui se déclenche à retardement (le montage de la
 * scène 3D, 0,8 s après l'affichage) le vérifie avant d'agir.
 */
export function isInteriorPreloadOpen(): boolean {
  return open;
}

/** La borne s'ouvre : la vanne se referme et les téléchargements interruptibles sont coupés. */
export function pauseInteriorPreload(): void {
  if (!open) return;
  open = false;
  controller?.abort();
  controller = null;
}

/**
 * La scène 3D est-elle montée ?
 *
 * - dans le vidéoclub : toujours ;
 * - devant la devanture : dès qu'elle est affichée depuis 0,8 s (`prewarmOpen`), cachée dessous,
 *   pour se préparer pendant que le visiteur regarde la vitrine ;
 * - borne ouverte : JAMAIS, qu'elle ait été prête ou non — dès l'appui sur la borne le GPU est
 *   libéré, et la préparation repart du début au retour devant la devanture ;
 * - sans WebGPU : jamais.
 */
export function shouldMountInterior(i: {
  webgpu: boolean;
  scene: 'exterior' | 'interior' | 'kiosk';
  prewarmOpen: boolean;
}): boolean {
  if (!i.webgpu) return false;
  if (i.scene === 'interior') return true;
  return i.scene === 'exterior' && i.prewarmOpen;
}
