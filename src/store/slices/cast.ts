import type { StateCreator } from 'zustand'
import api from '../../api'
import type { VideoClubState } from '../index'
import { castOwnsFilm, initialCastState } from '../../cast/cast-machine'
import type { CastEvent, CastState } from '../../cast/cast-machine'
import { castMediaRequest, rentalGoneFilm, settle } from '../../cast/cast-wire'
import { getCastState, initCast, sendCast, setCastSubtitle, subscribeCast } from '../../cast/cast-service'
import type { CastPorts } from '../../cast/cast-service'
import { buildCastSubtitleTracks } from '../../utils/cast-subtitles'
import { resolvedVersion } from '../../utils/version-choice'
import type { VersionChoice } from '../../utils/version-choice'
import { versionDecisionFor } from './version'

// Tranche « Cast » du magasin (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.3) : le SEUL endroit
// de l'application qui parle au service (src/cast/cast-service.ts). Elle publie son état, lui branche l'API et le
// magasin (les ports), et traduit les gestes du visiteur en événements de la machine. Les composants lisent `cast`
// et demandent par les actions ci-dessous ; aucun n'écrit l'état du Cast.

export interface CastSlice {
  /** Ce que fait le Cast, tel que la machine le dit. Jamais persisté : il porte l'adresse du film et des drapeaux passagers. */
  cast: CastState
  /** Le film dont le Cast court peut-être encore, pour la page rechargée. Persisté ; écrit par le service (REMEMBER_FILM). */
  lastCastFilmId: number | null
  /** Démarre le service du Cast (SDK chargé et initialisé une fois) et s'y abonne. Idempotent : à appeler à l'entrée. */
  startCast: () => void
  /**
   * « Regarder sur TV ». À appeler DIRECTEMENT dans le gestionnaire de l'appui : le sélecteur d'appareils exige son
   * activation, aucune attente ne doit précéder l'envoi. Sans source, un message `no_source` et rien d'autre.
   * `startAt` : par défaut la position de la location, 0 si elle est vue jusqu'au bout. `version` : celle que
   * l'appelant a décidée (le lecteur, le panneau de la borne) ; sans elle, la décision unique pour ce film
   * (`versionDecisionFor`, spec 2026-11-19, § 4.4) — jamais une piste choisie ici.
   */
  castFilm: (filmId: number, opts?: { version?: VersionChoice; startAt?: number }) => void
  castToggle: () => void
  castSeekBy: (seconds: number) => void
  castVolume: (level: number) => void
  /** « Arrêter » : la TV s'arrête, la séance se termine. */
  castStop: () => void
  /** « Continuer sur ce téléphone » : la TV s'arrête, `takeCastResume` donne où reprendre. */
  castToPhone: () => void
  /** « Réessayer » de la liaison perdue. */
  castRetry: () => void
  castCancel: () => void
  /** Ferme le message du Cast ; film terminé : rembobiné ou éjecté, la puce disparaît. */
  castDismiss: () => void
  /**
   * Bascule les sous-titres de la TV pendant qu'elle joue, sans recharger le film (`null` les coupe). Vrai quand la TV a
   * accusé réception ; faux sans média, sur refus ou sans réponse (la liaison est alors revérifiée par le service).
   */
  castSubtitle: (trackId: number | null) => Promise<boolean>
  /**
   * La reprise locale de `filmId` demandée par le Cast (arrêt, « Continuer sur ce téléphone »), prise une seule fois.
   * `position` null : inconnue, le lecteur reprend à celle de la location. `play` : lancer la lecture (sinon en pause).
   */
  takeCastResume: (filmId: number) => { position: number | null; play: boolean } | null
  /** Le compte se déconnecte : la location du film qui est sur la TV disparaît avec lui. Appelé par `logout`. */
  castLoggedOut: () => void
  /**
   * Le lecteur de `filmId` se ferme : le message du Cast qu'il montrait et la reprise de ce film qu'il n'a pas prise
   * partent avec lui (« Location terminée » excepté : la borne le montre lecteur fermé). Appelé par `closePlayer`.
   */
  castPlayerClosed: (filmId: number) => void
  /**
   * Le lecteur s'est trouvé ouvert sur `filmId` sans location (échue pendant le film, prévisualisation adoptée) : si la
   * TV a ce film, elle s'arrête et « Location terminée » reste. La machine en juge (elle ignore un autre film).
   */
  castRentalGone: (filmId: number) => void
}

/** Titre du film pour la TV : catalogue chargé, prévisualisation /admin, sinon l'historique (borne : rayons non chargés). */
function titleOf(s: VideoClubState, filmId: number): string | null {
  if (s.previewFilm?.id === filmId) return s.previewFilm.title
  const film = Object.values(s.films).flat().find((f) => f.id === filmId)
  return film?.title ?? s.rentalHistory.find((h) => h.filmId === filmId)?.title ?? null
}

/** Les ports du service : l'API, le magasin, la mémoire du film. Chacun se règle (voir `settle`). */
function createPorts(get: () => VideoClubState, set: (patch: Partial<VideoClubState>) => void): CastPorts {
  return {
    serverOpen: (filmId, position, duration) =>
      settle(() => api.castSessions.create(filmId, position, duration ?? undefined), null),
    serverReport: (filmId, position, duration) =>
      settle(async () => {
        // La séance de Cast ET la progression de la location : lecteur fermé, c'est le service qui les tient.
        const jobs: Promise<unknown>[] = [api.castSessions.updatePosition(filmId, position, duration ?? undefined)]
        if (duration !== null && duration > 0) {
          jobs.push(get().updateRentalProgress(filmId, Math.min(100, Math.round((position / duration) * 100)), position))
        }
        await Promise.allSettled(jobs)
      }, null),
    serverClose: (filmId, position, finished) =>
      settle(async () => {
        await api.castSessions.end(filmId, { position: position ?? undefined, finished })
        // Un film fini côté serveur passe la location à 100 % : le magasin la relit. Jamais par fetchMe, qui dirait le
        // visiteur déconnecté sur une simple panne réseau, au moment où le réseau est le plus fragile.
        await get().refreshRentals()
      }, null),
    readRental: async (filmId) => {
      const read = await settle(async () => {
        // Une panne, ou un compte déconnecté, rejette : on ne sait pas si la location existe encore, et conclure
        // « disparue » arrêterait la TV sur une panne réseau.
        await get().refreshRentals()
        const rental = get().rentals.find((r) => r.filmId === filmId)
        return { exists: rental !== undefined, watchProgress: rental?.watchProgress ?? 0, watchPosition: rental?.watchPosition ?? 0 }
      }, null)
      // Se règle par un rejet, pas par un faux « n'existe pas » : le service ignore un port qui rejette, et la
      // machine garde ce qu'elle sait (un « Location terminée » à tort vaudrait pire qu'une lecture manquée).
      if (read === null) throw new Error('location illisible')
      return read
    },
    remember: (filmId) => set({ lastCastFilmId: filmId }),
    remembered: () => get().lastCastFilmId,
  }
}

export const createCastSlice: StateCreator<VideoClubState, [['zustand/persist', unknown]], [], CastSlice> = (set, get, store) => {
  /** Le service est démarré et branché : une seule fois pour la page (ses écouteurs vivent autant qu'elle). */
  let started = false
  /**
   * « Pas de source » est la tranche qui le dit, le service ne le connaît pas : sans cela le prochain état du
   * service (une position, chaque seconde) l'effacerait. Repasse derrière tout message du service.
   */
  let noSource: CastState['notice'] = null

  const shown = (service: CastState): CastState => {
    if (service.notice) noSource = null
    return noSource ? { ...service, notice: noSource } : service
  }

  /** Publie l'état du service : les composants le lisent (`castView`, `castOwnsFilm`), aucun ne l'écrit. */
  const publish = (service: CastState): void => {
    set({ cast: shown(service) })
  }

  /** Un geste du visiteur → un événement de la machine. Le service est démarré d'abord (idempotent). */
  const ask = (event: CastEvent): void => {
    get().startCast()
    sendCast(event)
  }

  return {
    cast: initialCastState,
    lastCastFilmId: null,

    startCast: () => {
      if (started) return
      started = true
      initCast(createPorts(get, set))
      publish(getCastState())
      subscribeCast(publish)
      // Une location qui disparaît pendant un Cast (échéance, retour) arrête la TV. Seulement celle qui ÉTAIT là : la
      // liste est vide avant la première réponse du serveur (voir rentalGoneFilm).
      store.subscribe((next, prev) => {
        if (next.rentals === prev.rentals) return
        const service = getCastState()
        const gone = rentalGoneFilm({ owned: castOwnsFilm(service), tracked: service.tracked, before: prev.rentals, after: next.rentals })
        if (gone !== null) sendCast({ type: 'RENTAL_GONE', filmId: gone })
      })
    },

    castFilm: (filmId, opts) => {
      get().startCast()
      const s = get()
      const rental = s.getRental(filmId)
      // La version jouée sur la TV : la même décision que partout ; sans version lisible, rien à envoyer.
      const version = opts?.version ?? resolvedVersion(versionDecisionFor(s, filmId))
      const media = version && castMediaRequest({
        rental,
        audio: version.audio,
        title: titleOf(s, filmId),
        startAt: opts?.startAt,
        subtitles: buildCastSubtitleTracks(rental?.streamingUrls),
        subtitle: version.subtitle,
      })
      if (!media) {
        noSource = { code: 'no_source', filmId, deviceName: null }
        set({ cast: shown(getCastState()) })
        return
      }
      noSource = null
      // Une prévisualisation /admin n'a pas de location : le service ne l'annonce pas au serveur.
      sendCast({ type: 'REQUEST_CAST', filmId, tracked: s.previewRental?.filmId !== filmId, media })
    },

    castToggle: () => ask({ type: 'COMMAND', command: { kind: 'toggle' } }),
    castSeekBy: (seconds) => ask({ type: 'COMMAND', command: { kind: 'seekBy', seconds } }),
    castVolume: (level) => ask({ type: 'COMMAND', command: { kind: 'volume', level } }),
    castStop: () => ask({ type: 'USER_STOP' }),
    castToPhone: () => ask({ type: 'USER_TO_PHONE' }),
    castRetry: () => ask({ type: 'USER_RETRY' }),
    castCancel: () => ask({ type: 'USER_CANCEL' }),
    castDismiss: () => {
      // Le message affiché est celui de la tranche : le fermer ne touche pas à un film terminé que la machine garde.
      if (noSource) {
        noSource = null
        set({ cast: getCastState() })
        return
      }
      ask({ type: 'USER_DISMISS' })
    },

    castSubtitle: (trackId) => setCastSubtitle(trackId),

    takeCastResume: (filmId) => {
      const resume = get().cast.resume
      if (!resume || resume.filmId !== filmId) return null
      sendCast({ type: 'RESUME_TAKEN' })
      return { position: resume.position, play: resume.play }
    },

    castLoggedOut: () => {
      const service = getCastState()
      const owned = castOwnsFilm(service)
      if (owned !== null && service.tracked) sendCast({ type: 'RENTAL_GONE', filmId: owned })
    },

    castPlayerClosed: (filmId) => {
      // « Pas de source » est le message de la tranche (la machine ne le connaît pas) : il part de la même façon.
      const dropNoSource = noSource !== null && (noSource.filmId === filmId || noSource.filmId === null)
      if (dropNoSource) noSource = null
      sendCast({ type: 'PLAYER_CLOSED', filmId })
      if (dropNoSource) set({ cast: shown(getCastState()) })
    },

    castRentalGone: (filmId) => ask({ type: 'RENTAL_GONE', filmId }),
  }
}
