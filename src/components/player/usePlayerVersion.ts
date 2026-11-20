import { useCallback, useMemo } from 'react';
import { useStore } from '../../store';
import { versionDecisionFor } from '../../store/slices/version';
import {
  nextAudio, nextSubtitle, resolvedVersion, sameVersion, versionOffer,
  type VersionChoice, type VersionDecision, type VersionOffer,
} from '../../utils/version-choice';
import type { StreamingUrls } from '../../types';
import { NO_PLAYABLE_VERSION } from '../kiosk/kiosk-logic';

// La version que joue le lecteur (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.1,
// 4.3 b et 4.4) : la décision unique, celle de la borne et du Cast — le choix fait pour ce film, sinon la version
// préférée du compte, sinon le défaut. Le lecteur ne tient plus de piste à lui. Tout changement fait ici (liste
// « Version », touches V et T, « Essayer en … », réponse à la question des sous-titres) est le choix de CE film ; la
// version préférée, que seul « Mon compte » règle, n'est jamais écrite.

export interface PlayerVersion {
  /** Ce que la location offre (les pistes audio et les sous-titres présents). */
  offer: VersionOffer;
  /** La version qui joue ; sous la question, celle que l'on garde par défaut ; null sans aucune piste lisible. */
  version: VersionChoice | null;
  /** Ce que l'écran doit dire d'une substitution (« VOSTFR · VF indisponible pour ce film »), ou d'un film sans version. */
  note: string | null;
  /** La question des sous-titres, telle que la décision la pose ; null quand rien n'est à demander. */
  question: Extract<VersionDecision, { kind: 'ask' }> | null;
  /** Une version choisie pour ce film. */
  choose(v: VersionChoice): void;
  /** Touche V : l'autre piste audio, si le film l'a. */
  cycleAudio(): void;
  /** Touche T : sans sous-titres → français → anglais, les langues présentes seulement. */
  cycleSubtitle(): void;
}

export function usePlayerVersion(filmId: number | null, urls: StreamingUrls | undefined): PlayerVersion {
  // versionDecisionFor rend un objet neuf à chaque appel : jamais en sélecteur du magasin (boucle de rendus). Elle est
  // relue quand l'une des valeurs qu'elle lit change — la location (ses adresses), les choix par film, la version
  // préférée —, chacune suivie par un sélecteur à valeur stable (comme dans KioskView).
  const filmVersions = useStore((state) => state.filmVersions);
  const versionPref = useStore((state) => state.versionPref);
  const chooseFilmVersion = useStore((state) => state.chooseFilmVersion);
  const decision = useMemo(
    () => (filmId === null ? null : versionDecisionFor(useStore.getState(), filmId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lues par la décision sur l'état complet (voir plus haut)
    [filmId, urls, filmVersions, versionPref],
  );
  const offer = useMemo(() => versionOffer(urls), [urls]);
  // Les couples rendus par la décision sont les constantes canoniques : leur identité ne change pas d'un rendu à l'autre.
  const version = decision === null ? null : resolvedVersion(decision);

  const choose = useCallback((v: VersionChoice) => {
    if (filmId !== null) chooseFilmVersion(filmId, v);
  }, [filmId, chooseFilmVersion]);

  // Un cycle qui ne change rien (une seule piste audio, aucun sous-titre) n'écrit rien : la version jouée par défaut ne
  // devient pas pour autant un choix fait pour ce film.
  const cycleAudio = useCallback(() => {
    if (version === null) return;
    const next = nextAudio(offer, version);
    if (!sameVersion(next, version)) choose(next);
  }, [offer, version, choose]);

  const cycleSubtitle = useCallback(() => {
    if (version === null) return;
    const next = nextSubtitle(offer, version);
    if (!sameVersion(next, version)) choose(next);
  }, [offer, version, choose]);

  return {
    offer,
    version,
    note: decision?.kind === 'play' ? decision.note : decision?.kind === 'none' ? NO_PLAYABLE_VERSION : null,
    question: decision?.kind === 'ask' ? decision : null,
    choose,
    cycleAudio,
    cycleSubtitle,
  };
}
