// Libération du renderer d'une scène intérieure démontée.
//
// R3F ne libère pas un WebGPURenderer : son démontage (`unmountComponentAtNode`) appelle
// `gl.renderLists.dispose()` et `gl.forceContextLoss()`, qui n'existent que sur le renderer
// WebGL, puis libère les objets de la scène 500 ms plus tard. `renderer.dispose()` n'est jamais
// appelé — or c'est lui qui arrête la boucle interne de three (`Animation.js`, un
// requestAnimationFrame permanent) et détruit le device GPU. Mesuré le 16/11/2026 : une scène
// démontée laissait ce `update` tourner à la cadence de l'écran, et son device en mémoire.
//
// On libère donc le renderer nous-mêmes, mais APRÈS R3F : ses objets de scène se libèrent ainsi
// sur un renderer encore vivant. Le signal est la disparition de la racine R3F ; un plafond
// évite d'attendre un signal qui ne viendrait pas.
//
// Module sans import : il est chargé tel quel par Node dans les tests.

export const RELEASE_POLL_MS = 250;
export const RELEASE_CAP_MS = 3000;

export function releaseRendererAfterUnmount(opts: {
  renderer: { dispose: () => unknown };
  /** Vrai quand R3F a fini de démonter sa racine (scène libérée). */
  isRootGone: () => boolean;
  /** Vrai si la scène est revenue entre-temps (StrictMode, rechargement à chaud) : on garde le renderer. */
  isMountedAgain: () => boolean;
}): void {
  // Le plafond se mesure à l'horloge, pas au nombre de sondages : dans un onglet en
  // arrière-plan les minuteries sont bridées, et compter les passages l'aurait étiré d'autant.
  const startedAt = Date.now();
  const check = () => {
    if (opts.isMountedAgain()) return;
    if (!opts.isRootGone() && Date.now() - startedAt < RELEASE_CAP_MS) {
      setTimeout(check, RELEASE_POLL_MS);
      return;
    }
    // dispose() est asynchrone chez three (il attend une initialisation en cours) : un échec,
    // synchrone ou non, ne doit rien casser — le renderer n'est de toute façon plus utilisé.
    try {
      Promise.resolve(opts.renderer.dispose()).catch(() => {});
    } catch {
      // Échec synchrone : même traitement.
    }
  };
  setTimeout(check, RELEASE_POLL_MS);
}
