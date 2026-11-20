import type { StateCreator } from 'zustand'
import api from '../../api'
import type { VideoClubState } from '../index'
import { decideVersion, parseVersionChoice, versionOffer } from '../../utils/version-choice'
import type { VersionChoice, VersionDecision } from '../../utils/version-choice'

// Tranche « Versions » du magasin (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.1
// et 4.2). La version jouée naît de trois sources, départagées par la décision unique (`decideVersion`) :
// 1. le choix fait pour CE film (liste « Version », « Essayer en … », réponse à la question des sous-titres) — il ne
//    vaut que pour ce film, est retenu sur l'appareil (persisté) et s'oublie quand la location se termine (élagage
//    par `fetchMe` et `refreshRentals`) ;
// 2. la version préférée du compte, un réglage que le visiteur fait lui-même dans « Mon compte » et que l'application
//    ne déduit jamais : le serveur la tient, `fetchMe` la lit, `setVersionPref` la change, rien ne la garde ici ;
// 3. à défaut, le choix par défaut de `decideVersion`.

export interface VersionSlice {
  /** La version préférée du compte ; null = « Automatique ». Jamais persistée : le serveur la tient. */
  versionPref: VersionChoice | null
  /** Le choix fait pour chaque film loué, par identifiant de film interne. Persisté : retenu sur l'appareil. */
  filmVersions: Record<number, VersionChoice>
  /**
   * Le réglage « Version préférée » : le SEUL chemin qui change la préférence. Le magasin ne l'écrit qu'après le oui
   * du serveur — vrai alors ; faux sur un refus, une panne, ou un compte changé pendant l'appel (rien n'est écrit).
   */
  setVersionPref: (pref: VersionChoice | null) => Promise<boolean>
  /** La version choisie pour ce film ; la version préférée du compte n'en est jamais touchée. */
  chooseFilmVersion: (filmId: number, v: VersionChoice) => void
}

/**
 * Ce qui joue pour `filmId` : la décision unique sur ce que la location offre (prévisualisation /admin comprise), le
 * choix fait pour ce film et la version préférée. Un choix illisible (stockage de l'appareil abîmé) compte comme
 * aucun choix. Rend un objet neuf à chaque appel : à lire hors d'un sélecteur, ou sur des champs qui ne changent pas.
 */
export function versionDecisionFor(state: VideoClubState, filmId: number): VersionDecision {
  const stored = state.filmVersions[filmId]
  return decideVersion({
    offer: versionOffer(state.getRental(filmId)?.streamingUrls),
    filmChoice: stored ? parseVersionChoice(stored.audio, stored.subtitle) : null,
    pref: state.versionPref,
  })
}

export const createVersionSlice: StateCreator<VideoClubState, [['zustand/persist', unknown]], [], VersionSlice> = (set, get) => ({
  versionPref: null,
  filmVersions: {},

  setVersionPref: async (pref) => {
    // Le compte qui règle : une réponse revenue après une déconnexion n'écrit rien chez le visiteur suivant.
    const account = get().authUser?.id ?? null
    try {
      const { version_pref } = await api.me.setVersionPref(pref)
      if ((get().authUser?.id ?? null) !== account) return false
      set({ versionPref: version_pref ?? null })
      return true
    } catch {
      return false
    }
  },

  chooseFilmVersion: (filmId, v) => set((s) => ({ filmVersions: { ...s.filmVersions, [filmId]: v } })),
})
