import type { SceneType } from '../types';

/**
 * La scène où reprend un chargement de la page : la devanture, toujours — c'est là que sont la borne
 * et la porte. Deux exceptions seulement :
 *  - le lien d'une notification « film terminé sur la TV » (`castEnded`), qui mène lui-même au lecteur ;
 *  - un onglet que le navigateur avait déchargé pour libérer de la mémoire et qu'il recharge au retour
 *    du visiteur (`document.wasDiscarded`) : celui-ci n'a rien demandé, il retrouve la scène qu'il
 *    avait quittée.
 *
 * Avant le 25/11/2026, un drapeau en sessionStorage tenait lieu de « chargement neuf ». Mais
 * sessionStorage survit au rechargement de l'onglet : recharger dans le vidéoclub y ramenait, et
 * le vidéoclub n'ayant pas de sortie, on ne retrouvait plus la borne (Rusmir, 25/11/2026).
 *
 * `document.wasDiscarded` n'existe que dans Chrome sur ordinateur (developer.chrome.com, « Page
 * Lifecycle API », lu le 25/11/2026 : le suivi d'Android est une demande ouverte). Ailleurs, un onglet
 * déchargé repart aussi de la devanture.
 */
export function sceneAtLoad(i: { persisted: SceneType; castEnded: boolean; wasDiscarded: boolean }): SceneType {
  if (i.castEnded || i.wasDiscarded) return i.persisted;
  return 'exterior';
}
