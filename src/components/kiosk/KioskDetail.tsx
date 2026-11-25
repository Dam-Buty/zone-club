import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../../store';
import api, { type FilmExtrasResponse, type RelatedFilmsResponse, type ReviewsResponse } from '../../api';
import { trailerNotice, trailerReady, trailerUrl, useTrailerPlayback, useTrailerStatus, type TrailerState } from '../../hooks/useTrailer';
import type { Film } from '../../types';
import { parseServerDate } from '../../utils/server-date';
import type { KioskFilmDetail } from './KioskAction';
import { KioskPoster, KioskSlate } from './KioskBrowse';
import {
  DETAIL_TABS,
  allFilms,
  audienceLabel,
  availabilityText,
  frenchDate,
  starsFor,
  synopsisText,
  tabLabel,
  type DetailTab,
} from './kiosk-logic';
import styles from './KioskBrowse.module.css';

// Fiche détaillée d'un film, ouverte d'un appui sur sa jaquette (Rusmir, 17/11/2026 : « une
// nouvelle page où on conserve la jaquette, le bouton location ou le retour, et où on aura toute
// la place pour afficher ce qu'on veut »). Elle garde les codes du parcours : la colonne d'onglets
// de gauche y porte les rubriques du film au lieu des rayons, l'ardoise du clap reste en haut, et
// la rubrique choisie prend tout le cadre du dessous. Pas de points, pas de feuilletage.
//
// Les données viennent de quatre sources : la base (rôles, stock), TMDB par une route du serveur qui
// garde ses réponses 30 jours (/api/films/[tmdbId]/extras : accroche, public, équipe, note), notre
// propre catalogue (/api/films/[tmdbId]/related : « À voir aussi »), et la bande-annonce, récupérée
// chez Allociné par le serveur et jouée par le lecteur de la borne (lib/trailers.ts) — jamais de
// lecteur YouTube, qui peut diffuser des publicités.

type Loaded<T> = T | 'loading' | 'error';

/** Une requête par film ; la réponse d'un film qu'on ne regarde plus est ignorée. */
function useFilmLoad<T>(key: number | null, load: (key: number) => Promise<T>): Loaded<T> {
  const [result, setResult] = useState<{ key: number; value: T | 'error' } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    load(key).then(
      (value) => {
        if (!cancelled) setResult({ key, value });
      },
      () => {
        if (!cancelled) setResult({ key, value: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
    // `load` est une fonction stable de module : seule la clé relance la requête.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null || result === null || result.key !== key) return 'loading';
  return result.value;
}

const loadExtras = (tmdbId: number) => api.films.getExtras(tmdbId);
const loadRelated = (tmdbId: number) => api.films.getRelated(tmdbId);
const loadReviews = (filmId: number) => api.reviews.getByFilm(filmId);

/** « 4,2 » : une décimale, virgule française. */
function decimal(value: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function Pending({ what }: { what: Loaded<unknown> }) {
  return <p className={styles.kDetailNote}>{what === 'loading' ? 'Chargement…' : 'Ces informations ne sont pas disponibles pour le moment.'}</p>;
}

/** Une ligne « étiquette : valeur » de la fiche, absente quand la valeur manque. */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function Resume({ film, detail, extras }: { film: Film; detail: KioskFilmDetail | null; extras: Loaded<FilmExtrasResponse> }) {
  const x = typeof extras === 'object' ? extras : null;
  const original = detail?.titleOriginal && detail.titleOriginal !== film.title ? detail.titleOriginal : null;
  return (
    <>
      {x?.tagline && <p className={styles.kDetailTagline}>« {x.tagline} »</p>}
      <p className={styles.kDetailText}>{synopsisText(film.overview)}</p>
      <dl className={styles.kDetailFacts}>
        <Fact label="Sortie en France" value={frenchDate(x?.releaseDate)} />
        <Fact label="Pays" value={x?.countries.join(', ')} />
        <Fact label="Titre original" value={original} />
        <Fact label="Genres" value={film.genres.map((g) => g.name).join(', ')} />
        <Fact label="Rayon" value={tabLabel(film.aisle)} />
      </dl>
    </>
  );
}

function Distribution({ detail, failed }: { detail: KioskFilmDetail | null; failed: boolean }) {
  if (!detail) return <Pending what={failed ? 'error' : 'loading'} />;
  if (detail.roles.length === 0) return <p className={styles.kDetailNote}>La distribution de ce film n&apos;est pas renseignée.</p>;
  return (
    <ul className={styles.kDetailCast}>
      {detail.roles.map((role) => (
        <li key={`${role.name}-${role.character}`}>
          <b>{role.name}</b>
          {role.character && <span> — {role.character}</span>}
        </li>
      ))}
    </ul>
  );
}

function Equipe({ detail, extras }: { detail: KioskFilmDetail | null; extras: Loaded<FilmExtrasResponse> }) {
  const crew = typeof extras === 'object' ? extras.crew : null;
  const join = (names: string[] | undefined) => (names && names.length ? names.join(', ') : null);
  return (
    <>
      <dl className={styles.kDetailFacts}>
        <Fact label="Réalisation" value={join(detail?.directors)} />
        <Fact label="Scénario" value={join(crew?.screenplay)} />
        <Fact label="Musique" value={join(crew?.music)} />
        <Fact label="Photographie" value={join(crew?.photography)} />
        <Fact label="Montage" value={join(crew?.editing)} />
      </dl>
      {!crew && <Pending what={extras} />}
    </>
  );
}

function Avis({ reviews, extras }: { reviews: Loaded<ReviewsResponse>; extras: Loaded<FilmExtrasResponse> }) {
  const vote = typeof extras === 'object' ? extras.vote : null;
  const tmdb = vote && (
    <p className={styles.kDetailNote}>
      Spectateurs de TMDB : {decimal(vote.average)} / 10, {vote.count.toLocaleString('fr-FR')} votes
    </p>
  );
  if (typeof reviews !== 'object') {
    return (
      <>
        <Pending what={reviews} />
        {tmdb}
      </>
    );
  }
  const { ratings } = reviews;
  if (!ratings) {
    return (
      <>
        <p className={styles.kDetailText}>Pas encore de critique de client pour ce film.</p>
        <p className={styles.kDetailNote}>Une critique publiée rapporte 1 crédit à son auteur.</p>
        {tmdb}
      </>
    );
  }
  return (
    <>
      <p className={styles.kDetailStars}>
        <span aria-hidden="true">{starsFor(ratings.overall)}</span> {decimal(ratings.overall)} / 5
        <small>
          {ratings.count} critique{ratings.count > 1 ? 's' : ''} de clients
        </small>
      </p>
      <dl className={styles.kDetailFacts}>
        <Fact label="Réalisation" value={`${decimal(ratings.direction)} / 5`} />
        <Fact label="Scénario" value={`${decimal(ratings.screenplay)} / 5`} />
        <Fact label="Jeu" value={`${decimal(ratings.acting)} / 5`} />
      </dl>
      {reviews.reviews.slice(0, 2).map((review) => (
        <div key={review.id} className={styles.kDetailReview}>
          <p className={styles.kDetailReviewHead}>
            <b>{review.username}</b> <span aria-hidden="true">{starsFor(review.average_rating)}</span>
          </p>
          <p className={styles.kDetailReviewText}>{review.content}</p>
        </div>
      ))}
      {tmdb}
    </>
  );
}

const TRAILER_LANG: Record<'vf' | 'vost' | 'vo', string> = {
  vf: 'Version française',
  vost: 'Version originale sous-titrée',
  vo: 'Version originale',
};

// La rubrique « Bande-annonce » : le lecteur lui-même est monté plus haut, dès l'ouverture de la
// fiche, pour se précharger (voir KioskDetail) ; la rubrique dit où elle en est, ou sa langue.
function BandeAnnonceNote({ state, broken }: { state: TrailerState; broken: boolean }) {
  const notice = trailerNotice(state, broken);
  if (notice) return <p className={styles.kDetailNote}>{notice}</p>;
  return trailerReady(state) ? <p className={styles.kDetailNote}>{TRAILER_LANG[state.lang]}</p> : null;
}

function VoirAussi({ related, onOpenFilm }: { related: Loaded<RelatedFilmsResponse>; onOpenFilm: (film: Film) => void }) {
  const films = useStore((state) => state.films);
  const byId = useMemo(() => new Map(allFilms(films).map((f) => [f.id, f] as const)), [films]);
  if (typeof related !== 'object') return <Pending what={related} />;
  const director = related.sameDirector.map((id) => byId.get(id)).filter((f): f is Film => !!f);
  const cast = related.sameCast.flatMap(({ id, names }) => {
    const film = byId.get(id);
    return film ? [{ film, names }] : [];
  });
  if (director.length === 0 && cast.length === 0) {
    return <p className={styles.kDetailNote}>Aucun autre film de ce réalisateur ou de ces acteurs en rayon.</p>;
  }
  const row = (items: { film: Film; caption: string }[]) => (
    <div className={styles.kDetailRow}>
      {items.map(({ film, caption }) => (
        <button key={film.id} type="button" className={styles.kDetailRelated} aria-label={`${film.title} — ${caption}`} onClick={() => onOpenFilm(film)}>
          <KioskPoster film={film} size="w185" className={styles.kDetailRelatedPoster} />
          <span className={styles.kDetailRelatedCaption}>{caption}</span>
        </button>
      ))}
    </div>
  );
  return (
    <>
      {director.length > 0 && (
        <>
          <h3 className={styles.kDetailHeading}>Du même réalisateur</h3>
          {row(director.map((film) => ({ film, caption: film.title })))}
        </>
      )}
      {cast.length > 0 && (
        <>
          <h3 className={styles.kDetailHeading}>Avec les mêmes acteurs</h3>
          {row(cast.map(({ film, names }) => ({ film, caption: names.join(', ') })))}
        </>
      )}
    </>
  );
}

interface KioskDetailProps {
  film: Film;
  /** Détail du film (base) ; `null` tant qu'il n'est pas arrivé. */
  detail: KioskFilmDetail | null;
  /** Le détail a été demandé et n'est pas arrivé (panne) : la fiche le dit au lieu d'attendre sans fin. */
  detailFailed: boolean;
  /** Autre chose est affiché par-dessus la fiche : la bande-annonce se met en pause. */
  covered: boolean;
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  onBack: () => void;
  /** Ouvre la fiche d'un autre film (« À voir aussi »). */
  onOpenFilm: (film: Film) => void;
  /** Le bouton « LOUER » du film, le même que sur le parcours. */
  action: ReactNode;
}

export function KioskDetail({ film, detail, detailFailed, covered, tab, onTab, onBack, onOpenFilm, action }: KioskDetailProps) {
  const tmdbId = film.tmdb_id ?? null;
  const extras = useFilmLoad(tmdbId, loadExtras);
  const related = useFilmLoad(tab === 'voir-aussi' ? tmdbId : null, loadRelated);
  const reviews = useFilmLoad(tab === 'avis' ? film.id : null, loadReviews);
  // La bande-annonce se prépare dès l'ouverture de la fiche : le serveur la récupère s'il ne l'a pas
  // (quelques secondes la première fois), puis le lecteur, monté caché, la télécharge. Elle est prête
  // quand on ouvre sa rubrique. Recouverte (message, connexion, location, lecteur, téléphone couché),
  // elle se tait : elle jouait avec le son sous le film loué (batterie de tests du 25/11/2026).
  const trailer = useTrailerStatus(tmdbId);
  const trailerVideo = useRef<HTMLVideoElement>(null);
  const [trailerBroken, setTrailerBroken] = useState<number | null>(null);
  const trailerBrokenNow = trailerBroken === tmdbId;
  const trailerShown = tab === 'bande-annonce' && trailerReady(trailer) && !trailerBrokenNow;
  useTrailerPlayback(trailerVideo, trailerShown && !covered);

  const audience = typeof extras === 'object' ? audienceLabel(extras.certification) : null;
  const availability = availabilityText(
    detail ? { stock: detail.stock, copiesLeft: detail.copiesLeft, earliestReturnMs: parseServerDate(detail.earliestReturn) } : null,
  );
  const tabName = DETAIL_TABS.find((t) => t.id === tab)?.label ?? '';

  // Une rubrique plus longue que le cadre se signale par un triangle au coin bas du cadre, tant
  // qu'il reste du texte en dessous. Écrit sur le cadre, sans état React : il suit le défilement.
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const syncMore = () => {
    const el = scrollRef.current;
    if (el && bodyRef.current) bodyRef.current.dataset.more = String(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  };
  // Après chaque rendu : le contenu change quand une réponse arrive.
  useLayoutEffect(syncMore);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(syncMore);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.kDetail}>
      {/* Les rubriques du film, à la place des rayons : six onglets dans la même colonne. */}
      <div className={`${styles.kSide} ${styles.kSideDetail}`} role="tablist" aria-label="Rubriques de la fiche">
        {DETAIL_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === tab}
            className={`${styles.kTab} ${id === tab ? styles.kTabOn : ''}`}
            onClick={() => onTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <KioskSlate
        key={`ardoise-${film.id}`}
        film={film}
        versions={detail ? { vf: detail.vf, vo: detail.vo } : null}
        third={audience ? { label: 'PUBLIC', value: audience } : { label: 'RAYON', value: tabLabel(film.aisle) }}
        poster={
          <div className={`${styles.kPoster} ${styles.kRise}`}>
            <KioskPoster film={film} size="w342" className={styles.kPosterFill} eager />
          </div>
        }
      />

      {/* La rubrique choisie, dans tout le cadre du dessous ; la disponibilité y reste affichée. */}
      <div ref={bodyRef} className={styles.kDetailBody} role="tabpanel" aria-label={tabName}>
        {availability && <p className={styles.kDetailAvail}>{availability}</p>}
        {tmdbId !== null && trailerReady(trailer) && !trailerBrokenNow && (
          <div className={styles.kTrailer} hidden={!trailerShown}>
            <video
              key={tmdbId}
              ref={trailerVideo}
              src={trailerUrl(tmdbId)}
              controls
              playsInline
              preload="auto"
              aria-label={`Bande-annonce de ${film.title}`}
              onError={() => setTrailerBroken(tmdbId)}
            />
          </div>
        )}
        <div ref={scrollRef} className={`${styles.kDetailScroll} ${styles.kRise}`} key={`${film.id}-${tab}`} onScroll={syncMore}>
          {tab === 'resume' && <Resume film={film} detail={detail} extras={extras} />}
          {tab === 'distribution' && <Distribution detail={detail} failed={detailFailed} />}
          {tab === 'equipe' && <Equipe detail={detail} extras={extras} />}
          {tab === 'avis' && <Avis reviews={reviews} extras={extras} />}
          {tab === 'bande-annonce' && <BandeAnnonceNote state={trailer} broken={trailerBrokenNow} />}
          {tab === 'voir-aussi' && <VoirAussi related={related} onOpenFilm={onOpenFilm} />}
        </div>
      </div>

      <button type="button" className={`${styles.kBtn} ${styles.kSearch} ${styles.kBack}`} onClick={onBack}>
        <span className={styles.kBtnLabel}>Retour</span>
      </button>
      {action}
    </div>
  );
}
