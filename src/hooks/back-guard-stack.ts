// Pile des gardes du geste retour — la logique de useBackGuard, sans React ni `window`, pour
// pouvoir la tester (tests/domain/back-guard.test.mjs).
//
// Chaque garde ouverte pose une entrée d'historique. Le geste retour du système dépile cette
// entrée et ferme la garde la plus récente. Une garde refermée autrement (bouton, changement
// d'état) laisse une entrée « orpheline », retirée sans que ce retrait ne ferme quoi que ce soit.
//
// Le retrait est DIFFÉRÉ, et une garde qui s'ouvre entre-temps reprend l'entrée orpheline au lieu
// d'en poser une : history.back() est asynchrone, et le faire suivre d'un pushState dans la même
// tâche décale l'historique d'une entrée (le navigateur applique le retour après coup). C'est ce
// qui arrivait en développement, où React rejoue l'effet d'un composant à son montage — effet,
// nettoyage, effet : après la fermeture du lecteur ouvert depuis la borne, le geste retour
// suivant sortait du site (tracé le 17/11/2026).

export interface GuardHistory {
  pushState(data: unknown, unused: string): void;
  back(): void;
  go(delta: number): void;
}

interface Handler {
  id: number;
  close: () => void;
  consumed: boolean;
}

export interface BackGuardStack {
  /** Ouvre une garde ; rend la fonction qui la referme (à appeler quand la garde n'a plus lieu d'être). */
  open(close: () => void): () => void;
  /** À appeler sur chaque `popstate` de la fenêtre. */
  handlePop(): void;
}

export function createBackGuardStack(deps: { history: () => GuardHistory; defer: (task: () => void) => void }): BackGuardStack {
  const handlers: Handler[] = [];
  let nextId = 0;
  let suppressedPops = 0;
  /** Entrées posées par des gardes refermées, pas encore retirées de l'historique. */
  let orphanEntries = 0;
  let rewindScheduled = false;

  const rewindOrphans = () => {
    rewindScheduled = false;
    const count = orphanEntries;
    orphanEntries = 0;
    if (count === 0) return;
    suppressedPops++;       // un seul déplacement, donc un seul popstate à ignorer
    try {
      deps.history().go(-count);
    } catch {
      suppressedPops = Math.max(0, suppressedPops - 1);
    }
  };

  return {
    open(close) {
      const handler: Handler = { id: ++nextId, close, consumed: false };
      handlers.push(handler);
      if (orphanEntries > 0) {
        // Une garde vient d'être refermée : on reprend son entrée, sans toucher à l'historique.
        orphanEntries--;
      } else {
        try {
          deps.history().pushState({ overlayGuard: handler.id }, '');
        } catch {
          const index = handlers.indexOf(handler);
          if (index >= 0) handlers.splice(index, 1);
          return () => {};
        }
      }
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
        if (handler.consumed) return;
        // Refermée par l'interface : son entrée devient orpheline, retirée à la tâche suivante.
        orphanEntries++;
        if (!rewindScheduled) {
          rewindScheduled = true;
          deps.defer(rewindOrphans);
        }
      };
    },
    handlePop() {
      if (suppressedPops > 0) {
        suppressedPops--;
        return;
      }
      const top = handlers.pop();
      if (!top) {
        // Aucune garde ouverte : le geste n'a pu dépiler qu'une entrée orpheline.
        if (orphanEntries > 0) orphanEntries--;
        return;
      }
      // S'il restait une entrée orpheline, c'est elle que le geste a dépilée ; celle de la garde
      // qu'on ferme la remplace alors comme orpheline — le compte reste juste.
      top.consumed = true;
      try {
        top.close();
      } catch {
        // Une fermeture qui échoue ne doit jamais bloquer le geste retour.
      }
    },
  };
}
