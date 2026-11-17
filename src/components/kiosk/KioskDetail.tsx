import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../../store';
import api, { type FilmExtrasResponse, type RelatedFilmsResponse, type ReviewsResponse, type TrailerStatusResponse } from '../../api';
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

function Distribution({ detail }: { detail: KioskFilmDetail | null }) {
  if (!detail) return <Pending what="loading" />;
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
/** Relevés de l'état pendant la préparation : toutes les deux secondes, deux minutes au plus. */
const TRAILER_POLL_MS = 2000;
const TRAILER_POLL_MAX = 60;

// La bande-annonce, sans publicité (Rusmir, 17/11/2026 : « on veut la bande-annonce sans pub,
// point ») : le serveur la récupère une fois chez Allociné, la garde, et elle est jouée ici par un
// simple lecteur vidéo, dans l'écran de la borne, sous la dalle et la vitre.
function BandeAnnonce({ film }: { film: Film }) {
  const tmdbId = film.tmdb_id ?? null;
  const [status, setStatus] = useState<{ id: number; value: TrailerStatusResponse | 'error' } | null>(null);
  useEffect(() => {
    if (tmdbId === null) return;
    let cancelled = false;
    let timer = 0;
    let tries = 0;
    const poll = () => {
      api.films.getTrailerStatus(tmdbId).then(
        (value) => {
          if (cancelled) return;
          if (value.state === 'preparing' && ++tries >= TRAILER_POLL_MAX) {
            setStatus({ id: tmdbId, value: 'error' });
            return;
          }
          setStatus({ id: tmdbId, value });
          if (value.state === 'preparing') timer = window.setTimeout(poll, TRAILER_POLL_MS);
        },
        () => {
          if (!cancelled) setStatus({ id: tmdbId, value: 'error' });
        },
      );
    };
    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tmdbId]);

  const value = tmdbId !== null && status?.id === tmdbId ? status.value : null;
  if (value === null || (value !== 'error' && value.state === 'preparing')) {
    return <p className={styles.kDetailNote}>Préparation de la bande-annonce…</p>;
  }
  if (value !== 'error' && value.state === 'none') return <p className={styles.kDetailNote}>Pas de bande-annonce pour ce film.</p>;
  if (value === 'error' || value.state !== 'ready') {
    return <p className={styles.kDetailNote}>La bande-annonce n&apos;a pas pu être récupérée. Réessayez plus tard.</p>;
  }
  return (
    <>
      <div className={styles.kTrailer}>
        <video src={`/api/films/${tmdbId}/trailer`} controls autoPlay playsInline preload="auto" aria-label={`Bande-annonce de ${film.title}`} />
      </div>
      <p className={styles.kDetailNote}>{TRAILER_LANG[value.lang]}</p>
    </>
  );
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
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  onBack: () => void;
  /** Ouvre la fiche d'un autre film (« À voir aussi »). */
  onOpenFilm: (film: Film) => void;
  /** Le bouton « LOUER » du film, le même que sur le parcours. */
  action: ReactNode;
}

export function KioskDetail({ film, detail, tab, onTab, onBack, onOpenFilm, action }: KioskDetailProps) {
  const tmdbId = film.tmdb_id ?? null;
  const extras = useFilmLoad(tmdbId, loadExtras);
  const related = useFilmLoad(tab === 'voir-aussi' ? tmdbId : null, loadRelated);
  const reviews = useFilmLoad(tab === 'avis' ? film.id : null, loadReviews);
  // Dès l'ouverture de la fiche, le serveur commence à récupérer la bande-annonce (quelques
  // secondes la première fois) : elle est souvent prête quand on ouvre sa rubrique.
  useEffect(() => {
    if (tmdbId !== null) api.films.getTrailerStatus(tmdbId).catch(() => {});
  }, [tmdbId]);

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
        <div ref={scrollRef} className={`${styles.kDetailScroll} ${styles.kRise}`} key={`${film.id}-${tab}`} onScroll={syncMore}>
          {tab === 'resume' && <Resume film={film} detail={detail} extras={extras} />}
          {tab === 'distribution' && <Distribution detail={detail} />}
          {tab === 'equipe' && <Equipe detail={detail} extras={extras} />}
          {tab === 'avis' && <Avis reviews={reviews} extras={extras} />}
          {tab === 'bande-annonce' && <BandeAnnonce film={film} />}
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
