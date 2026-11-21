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
//
// RETENUE (`hold`) : pendant que la fenêtre native « Caster sur » de Chrome Android s'ouvre, une entrée posée dans
// l'historique la referme aussitôt (`requestSession` rejette « cancel » ; expérience contrôlée sur le Pixel 9a,
// Chrome 157, le 21/11/2026). Tant que l'historique est retenu, la pile n'y touche pas : une garde qui s'ouvre
// attend son entrée, un retrait attend aussi. À la libération, elle rattrape. Pendant la retenue la fenêtre native
// a le geste retour : aucune garde n'en a besoin.

export interface GuardHistory {
  pushState(data: unknown, unused: string): void;
  back(): void;
  go(delta: number): void;
}

interface Handler {
  id: number;
  close: () => void;
  consumed: boolean;
  /** Ouverte pendant une retenue : son entrée d'historique n'est pas encore posée. */
  pending: boolean;
}

export interface BackGuardStack {
  /** Ouvre une garde ; rend la fonction qui la referme (à appeler quand la garde n'a plus lieu d'être). */
  open(close: () => void): () => void;
  /** À appeler sur chaque `popstate` de la fenêtre. */
  handlePop(): void;
  /** Retient (vrai) ou libère (faux) l'historique : voir « RETENUE » en tête de fichier. */
  hold(held: boolean): void;
}

export function createBackGuardStack(deps: { history: () => GuardHistory; defer: (task: () => void) => void }): BackGuardStack {
  const handlers: Handler[] = [];
  let nextId = 0;
  let suppressedPops = 0;
  /** Entrées posées par des gardes refermées, pas encore retirées de l'historique. */
  let orphanEntries = 0;
  let rewindScheduled = false;
  let held = false;

  const scheduleRewind = () => {
    if (rewindScheduled) return;
    rewindScheduled = true;
    deps.defer(rewindOrphans);
  };

  /** L'entrée d'une garde : celle d'une garde tout juste refermée si elle attend son retrait, sinon une neuve. */
  const enter = (handler: Handler): boolean => {
    if (orphanEntries > 0) {
      orphanEntries--;
      return true;
    }
    try {
      deps.history().pushState({ overlayGuard: handler.id }, '');
      return true;
    } catch {
      return false;
    }
  };

  const drop = (handler: Handler) => {
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };

  function rewindOrphans(): void {
    rewindScheduled = false;
    if (held) return;       // la libération relancera le retrait
    const count = orphanEntries;
    orphanEntries = 0;
    if (count === 0) return;
    suppressedPops++;       // un seul déplacement, donc un seul popstate à ignorer
    try {
      deps.history().go(-count);
    } catch {
      suppressedPops = Math.max(0, suppressedPops - 1);
    }
  }

  return {
    open(close) {
      const handler: Handler = { id: ++nextId, close, consumed: false, pending: held };
      handlers.push(handler);
      // Une garde vient d'être refermée : `enter` reprend son entrée, sans toucher à l'historique.
      if (!held && !enter(handler)) {
        drop(handler);
        return () => {};
      }
      return () => {
        drop(handler);
        if (handler.consumed || handler.pending) return;   // `pending` : elle n'a jamais eu d'entrée
        // Refermée par l'interface : son entrée devient orpheline, retirée à la tâche suivante.
        orphanEntries++;
        scheduleRewind();
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
    hold(next) {
      if (held === next) return;
      held = next;
      if (held) return;
      // Libération : les gardes ouvertes entre-temps (et encore ouvertes) reçoivent leur entrée, dans l'ordre.
      for (const handler of [...handlers]) {
        if (!handler.pending) continue;
        handler.pending = false;
        if (!enter(handler)) drop(handler);
      }
      if (orphanEntries > 0) scheduleRewind();
    },
  };
}
