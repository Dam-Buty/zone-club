import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from '../../store';
import { castView } from '../../cast/cast-machine';
import { castDeviceLabel } from '../../cast/cast-labels';
import { appleAirPlay } from '../../utils/cast-on-open';
import type { VersionChoice, VersionDecision, VersionRow } from '../../utils/version-choice';
import { VersionList } from '../version/VersionList';
import { allFilms, readyUntilText, tvChoiceLine, tvEntry, watchHereLabel } from './kiosk-logic';
import styles from './KioskPanels.module.css';

// La distribution de la K7 après « LOUER » confirmé
// (docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md). Livraison 1 : l'attente du
// serveur, puis le panneau « Votre K7 est prête ». La livraison 2 insérera ici, entre les deux,
// l'animation du robot. Le même panneau pose la question à chaque reprise d'un film déjà loué
// (refonte du Cast, docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.4). Il porte aussi la ligne
// « Version », sa liste et la question des sous-titres (spec 2026-11-19-versions-et-erreurs-de-lecture, § 4.3 a et 4.4).

/** Pendant l'appel au serveur. Sans bouton : l'enregistrement d'une location ne s'annule pas. */
export function KioskWaiting() {
  return (
    <div className={styles.kNoticeScrim}>
      <div className={styles.kNotice} role="status">
        <p className={styles.kNoticeTitle}>Veuillez patienter</p>
        <p className={styles.kNoticeBody}>Location en cours…</p>
        <div className={styles.kWaitBar} aria-hidden="true" />
      </div>
    </div>
  );
}

type TvEntry = ReturnType<typeof tvEntry>;

interface KioskReadyProps {
  /** Le film loué : si la TV en joue un autre, « Sur ma télé » dit qu'il le remplacera. */
  filmId: number;
  /**
   * Vrai juste après la location : « Votre K7 est prête », la question en dessous. Faux pour la reprise d'un film déjà
   * loué : la question devient le titre, sans être répétée.
   */
  fresh: boolean;
  /** Titre du film loué ; « Titre indisponible » si le catalogue chargé ne le connaît pas. */
  title: string;
  /** Échéance de la location (ms) ; `null` si le magasin ne la connaît pas encore. */
  expiresAt: number | null;
  onWatch: () => void;
  /** « Sur ma télé », avec le moyen lu sur l'appareil : AirPlay ou le Cast. */
  onTv: (entry: TvEntry) => void;
  onAccount: () => void;
  /** « Plus tard » : fermer sans rien lancer — le panneau ne doit jamais enfermer le visiteur. */
  onLater: () => void;
  /**
   * La ligne « Version » (`readyVersionRow`) : la version qui jouera, si un appui ouvre la liste (le film a plus d'une
   * version), et la note d'une substitution, écrite dessous.
   */
  version: { text: string; openable: boolean; note: string | null };
  /** Ce que le panneau montre : son contenu, la liste des versions de ce film, ou la question des sous-titres. */
  view: 'panel' | 'versions' | 'question';
  /** Les lignes de la liste (`versionRows`, versions du film seulement). */
  rows: VersionRow[];
  /** La question des sous-titres, telle que la décision la pose ; `null` hors de la vue « question ». */
  question: Extract<VersionDecision, { kind: 'ask' }> | null;
  onOpenVersions: () => void;
  /** Une version choisie dans la liste : elle vaut pour ce film. */
  onPickVersion: (v: VersionChoice) => void;
  /** « Autres versions » : déplier les combinaisons plus rares. */
  onMoreVersions: () => void;
  /** La réponse à la question : le choix de ce film, et le lancement là où le visiteur l'a demandé, dans cet appui. */
  onAnswer: (v: VersionChoice) => void;
  /** « Retour » de la liste : revenir au contenu du panneau. */
  onCloseSub: () => void;
}

/** Où regarder et comment, lus sur l'appareil (pointeur, petit côté de l'écran, AirPlay). */
function readWatchLabels(): { here: string; airPlay: boolean; entry: TvEntry } {
  if (typeof window === 'undefined') return { here: watchHereLabel({ coarsePointer: false, shortSide: 1080 }), airPlay: false, entry: tvEntry({ airPlay: false }) };
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  const airPlay = typeof HTMLVideoElement !== 'undefined' && appleAirPlay(navigator.userAgent, HTMLVideoElement.prototype as { webkitShowPlaybackTargetPicker?: unknown });
  return { here: watchHereLabel({ coarsePointer, shortSide }), airPlay, entry: tvEntry({ airPlay }) };
}

/** Pictogrammes dessinés (aucun glyphe tiré d'une police) : un téléphone, une télé. */
function HereIcon() {
  return (
    <svg className={styles.kReadyIcon} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}
export function TvIcon({ className = styles.kReadyIcon }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="13" rx="1.5" />
      <path d="M8 21h8M12 17.5V21" />
    </svg>
  );
}

/**
 * La K7 est distribuée, ou un film déjà loué est repris : où la regarder — ici, ou sur la télé — et un lien vers
 * « Mon compte ».
 */
export function KioskReady({
  filmId, fresh, title, expiresAt, onWatch, onTv, onAccount, onLater,
  version, view, rows, question, onOpenVersions, onPickVersion, onMoreVersions, onAnswer, onCloseSub,
}: KioskReadyProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const watchRef = useRef<HTMLButtonElement>(null);
  const [labels] = useState(readWatchLabels);
  const startCast = useStore((state) => state.startCast);
  // La TV joue (ou prend) un AUTRE film : « Sur ma télé » le remplacera, sans second appui — une confirmation en deux
  // temps ferait perdre l'activation dont le sélecteur a besoin. Le bouton le dit donc avant l'appui, et suit la TV
  // tant que le panneau est ouvert (correctif 1 de la refonte du Cast).
  const tvFilmId = useStore((state) => (castView(state.cast, filmId) === 'other-on-tv' ? state.cast.filmId : null));
  const tvFilmTitle = useStore((state) => (tvFilmId === null ? null : allFilms(state.films).find((f) => f.id === tvFilmId)?.title ?? null));
  const tvDevice = useStore((state) => castDeviceLabel(state.cast.deviceName));
  const tvLine = tvChoiceLine({ airPlay: labels.airPlay, replacing: tvFilmId === null ? null : { title: tvFilmTitle, device: tvDevice } });

  useEffect(() => {
    // Le service du Cast démarre maintenant, SDK chargé et initialisé, pour que l'appui sur « Sur ma télé » ouvre
    // le sélecteur pendant que le navigateur tient encore cet appui pour un geste de l'utilisateur.
    startCast();
  }, [startCast]);

  // Le focus suit ce que montre le panneau : « Sur ce téléphone » sur son contenu ; sinon le premier bouton de la liste
  // ou de la question (celui qui avait le focus vient de disparaître).
  useEffect(() => {
    if (view === 'panel') watchRef.current?.focus();
    else dialogRef.current?.querySelector('button')?.focus();
  }, [view]);

  return (
    <div className={styles.kNoticeScrim}>
      <div
        ref={dialogRef}
        className={styles.kNotice}
        role="dialog"
        aria-modal="true"
        // La liste porte son propre titre (VersionList) : le dialogue prend son nom.
        aria-labelledby={view === 'versions' ? undefined : titleId}
        aria-label={view === 'versions' ? 'Version' : undefined}
      >
        {view === 'versions' ? (
          <VersionList
            title="Version"
            rows={rows}
            classes={{
              list: styles.kVersionList,
              title: styles.kNoticeTitle,
              row: styles.kVersionRow,
              rowSelected: styles.kVersionRowOn,
              absent: styles.kVersionAbsent,
              name: styles.kVersionName,
              sub: styles.kVersionSub,
              more: styles.kVersionMore,
              back: `${styles.kAuthBack} ${styles.kVersionBack}`,
            }}
            // La liste du panneau n'a pas de ligne « Automatique » : un appui rend toujours un couple.
            onPick={(v) => {
              if (v) onPickVersion(v);
            }}
            onMore={onMoreVersions}
            onBack={onCloseSub}
          />
        ) : view === 'question' && question ? (
          <>
            <h2 id={titleId} className={styles.kNoticeTitle}>{question.title}</h2>
            {question.body && <p className={styles.kNoticeBody}>{question.body}</p>}
            <button type="button" className={`${styles.kNoticeBtn} ${styles.kReadyAnswer}`} onClick={() => onAnswer(question.keep.version)}>
              {question.keep.label}
            </button>
            <button type="button" className={`${styles.kNoticeBtn} ${styles.kReadyAnswer}`} onClick={() => onAnswer(question.other.version)}>
              {question.other.label}
            </button>
          </>
        ) : (
          /* Le panneau */
          <>
            <h2 id={titleId} className={styles.kNoticeTitle}>{fresh ? 'Votre K7 est prête' : 'Où voulez-vous regarder ?'}</h2>
            <p className={styles.kReadyFilm}>{title}</p>
            {expiresAt !== null && <p className={styles.kNoticeBody}>{readyUntilText(expiresAt)}</p>}
            {/* La ligne « Version » : elle montre et se change, sans rien demander. Un film à une seule version n'a rien à
                ouvrir — du texte, sans chevron (jamais un bouton grisé). */}
            {version.openable ? (
              <button type="button" className={`${styles.kPrefLine} ${styles.kReadyVersion}`} onClick={onOpenVersions}>
                <span>Version</span>
                <span className={styles.kPrefValue}>{version.text}</span>
              </button>
            ) : (
              <p className={`${styles.kReadyVersion} ${styles.kReadyVersionFixed}`}>
                <span>Version</span>
                <span className={styles.kPrefValue}>{version.text}</span>
              </p>
            )}
            {version.note && <p className={styles.kReadyVersionNote}>{version.note}</p>}
            {fresh && <p className={styles.kReadyQuestion}>Où voulez-vous regarder ?</p>}
            <button ref={watchRef} type="button" className={`${styles.kNoticeBtn} ${styles.kNoticeBtnPrimary} ${styles.kReadyChoice}`} onClick={onWatch}>
              <HereIcon />
              <span className={styles.kReadyChoiceText}>
                <span>{labels.here}</span>
                <small>le film démarre ici</small>
              </span>
            </button>
            <button type="button" className={`${styles.kNoticeBtn} ${styles.kReadyChoice}`} onClick={() => onTv(labels.entry)}>
              <TvIcon />
              <span className={styles.kReadyChoiceText}>
                <span>Sur ma télé</span>
                <small>{tvLine}</small>
              </span>
            </button>
            <div className={styles.kReadyLinks}>
              <button type="button" className={styles.kReadyLink} onClick={onLater}>
                Plus tard
              </button>
              <button type="button" className={styles.kReadyLink} onClick={onAccount}>
                Mon compte ›
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
