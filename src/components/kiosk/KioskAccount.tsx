import { useEffect, useMemo, useState } from 'react';
import { useCredits, useStore } from '../../store';
import type { Film } from '../../types';
import { FULL_OFFER, versionName, versionRows, type VersionChoice } from '../../utils/version-choice';
import { VersionList } from '../version/VersionList';
import { KioskPoster } from './KioskBrowse';
import { bonusButtonLabel, bonusLine, bonusLineText } from './kiosk-account-logic';
import { accountHistoryRows, creditsLabel, dayLabel, rentalRows, reviewStateFor, type KioskReviewState } from './kiosk-logic';
import styles from './KioskPanels.module.css';

// « Mon compte » : ouvert par « Compte » à tout moment, sans avoir à louer d'abord
// (docs/superpowers/specs/2026-11-17-borne-mon-compte-design.md, § 4). Crédits, version préférée, locations en
// cours, tout l'historique avec le rembobinage, le retour anticipé et la critique de chaque film.

interface KioskAccountProps {
  /** Tout le catalogue, sans doublon : jaquettes et titres. */
  films: Film[];
  /**
   * La liste « Version préférée » remplace le contenu de l'écran. La borne tient cet état : son geste retour ferme la
   * liste avant le compte (`kioskBackAction`, « close-pref »).
   */
  prefOpen: boolean;
  onPrefOpen: (open: boolean) => void;
  onWatch: (filmId: number) => void;
  onReview: (filmId: number) => void;
  onLogout: () => void;
  onBack: () => void;
}

/** Durée pendant laquelle la ligne « Version préférée » dit « Enregistré » après un choix accepté par le serveur. */
const PREF_SAVED_MS = 2000;

/** Coche ou croix dessinées (aucun glyphe tiré d'une police de secours). */
function Mark({ ok }: { ok: boolean }) {
  return (
    <svg className={ok ? styles.kMarkOk : styles.kMarkNo} viewBox="0 0 12 12" aria-hidden="true">
      {ok ? <path d="M2 6.5 5 9.5 10.5 3" /> : <path d="M3 3l6 6M9 3 3 9" />}
    </svg>
  );
}

function ReviewLine({ state, onWrite }: { state: KioskReviewState; onWrite: () => void }) {
  if (state.kind === 'publiée') {
    // Une seule critique par film et par visiteur, mais elle se modifie toujours (spec § 5) — sans crédit.
    return (
      <>
        <span className={styles.kAccountFact}>
          <Mark ok /> Critique publiée
        </span>
        <button type="button" className={`${styles.kNoticeBtn} ${styles.kAccountReview}`} onClick={onWrite}>
          Modifier ma critique
        </button>
      </>
    );
  }
  if (state.kind === 'possible') {
    return (
      <button type="button" className={`${styles.kNoticeBtn} ${styles.kAccountReview}`} onClick={onWrite}>
        Écrire ma critique · +1 crédit
      </button>
    );
  }
  return <span className={styles.kAccountReason}>{state.reason}</span>;
}

export function KioskAccount({ films, prefOpen, onPrefOpen, onWatch, onReview, onLogout, onBack }: KioskAccountProps) {
  const authUser = useStore((state) => state.authUser);
  const rentals = useStore((state) => state.rentals);
  const history = useStore((state) => state.rentalHistory);
  const userReviews = useStore((state) => state.userReviews);
  const eligibility = useStore((state) => state.reviewEligibility);
  const fetchMe = useStore((state) => state.fetchMe);
  const versionPref = useStore((state) => state.versionPref);
  const setVersionPref = useStore((state) => state.setVersionPref);
  const credits = useCredits();

  // ----- « Bonus de la semaine » : une ligne toujours présente sous le solde, qui dit son état (spec 2026-11-20, § 5.5) -----
  const bonus = bonusLine(useStore((state) => state.weeklyBonusStatus));
  const claimWeeklyBonus = useStore((state) => state.claimWeeklyBonus);
  const [bonusBusy, setBonusBusy] = useState(false);
  // Le montant qui vient d'être reçu (« +3 crédits reçus »), ou un refus.
  const [bonusGot, setBonusGot] = useState<number | null>(null);
  const [bonusFailed, setBonusFailed] = useState(false);
  const claimBonus = async (amount: number) => {
    if (bonusBusy) return;
    setBonusBusy(true);
    setBonusFailed(false);
    const ok = await claimWeeklyBonus();
    setBonusBusy(false);
    if (ok) setBonusGot(amount);
    else setBonusFailed(true);
  };

  // ----- « Version préférée » : un réglage que le visiteur fait lui-même, jamais déduit (spec 2026-11-19, § 4.2) -----
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Compteur plutôt que booléen : un second choix accepté relance les deux secondes de « Enregistré ».
  const [savedTick, setSavedTick] = useState(0);
  useEffect(() => {
    if (savedTick === 0) return;
    const id = window.setTimeout(() => setSavedTick(0), PREF_SAVED_MS);
    return () => window.clearTimeout(id);
  }, [savedTick]);
  const prefRows = useMemo(() => versionRows({ offer: FULL_OFFER, current: versionPref, expanded, withAuto: true }), [versionPref, expanded]);
  const openPref = () => {
    setExpanded(false);
    setFailed(false);
    onPrefOpen(true);
  };
  // Le magasin n'écrit la préférence qu'après le oui du serveur : la liste se ferme alors, sinon elle reste et le dit.
  const pickPref = async (pref: VersionChoice | null) => {
    setSaving(true);
    setFailed(false);
    const ok = await setVersionPref(pref);
    setSaving(false);
    if (ok) {
      setSavedTick((tick) => tick + 1);
      onPrefOpen(false);
    } else setFailed(true);
  };

  // Les données du compte sont relues à l'ouverture : un retour, un rembobinage ou une critique faits
  // ailleurs (vidéoclub, autre appareil, serveur à la fin d'un Cast) doivent s'y voir.
  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  // Le temps restant des locations en cours se recalcule une fois par minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const reviewed = useMemo(() => new Set(userReviews.map((r) => r.film_id)), [userReviews]);
  const current = useMemo(() => rentalRows(rentals, films, now), [rentals, films, now]);
  const past = useMemo(() => accountHistoryRows(history, reviewed, eligibility), [history, reviewed, eligibility]);
  const filmById = useMemo(() => new Map(films.map((f) => [f.id, f])), [films]);

  if (prefOpen) {
    return (
      <div className={styles.kSearchPane}>
        <VersionList
          title="Version préférée"
          rows={prefRows}
          classes={{
            list: styles.kVersionList,
            title: styles.kRentalsTitle,
            row: styles.kVersionRow,
            rowSelected: styles.kVersionRowOn,
            absent: styles.kVersionAbsent,
            name: styles.kVersionName,
            sub: styles.kVersionSub,
            more: styles.kVersionMore,
            back: `${styles.kAuthBack} ${styles.kVersionBack}`,
          }}
          onPick={(pref) => void pickPref(pref)}
          onMore={() => setExpanded(true)}
          onBack={() => onPrefOpen(false)}
          busy={saving}
        />
        {failed && (
          <p className={styles.kAuthError} role="alert">
            L'enregistrement n'a pas abouti. Réessayez.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.kSearchPane}>
      <button type="button" className={styles.kAuthBack} onClick={onBack}>
        Retour
      </button>
      <h2 className={styles.kRentalsTitle}>Mon compte</h2>
      <p className={styles.kAccountWho}>
        <span>{authUser?.username ?? ''}</span>
        <span className={styles.kAccountCredits}>{creditsLabel(credits)}</span>
      </p>
      <div className={styles.kBonusLine} data-testid="borne-bonus">
        <span>Bonus de la semaine</span>
        {bonus.state === 'available' ? (
          <button type="button" className={`${styles.kNoticeBtn} ${styles.kNoticeBtnPrimary} ${styles.kBonusGet}`} aria-busy={bonusBusy} onClick={() => void claimBonus(bonus.amount)}>
            {bonusButtonLabel(bonus.amount)}
          </button>
        ) : (
          <span className={styles.kBonusState}>
            {bonusGot !== null ? `+${creditsLabel(bonusGot)} reçu${bonusGot > 1 ? 's' : ''}` : bonusLineText(bonus)}
          </span>
        )}
      </div>
      {bonusFailed && <p className={styles.kBonusFail} role="alert">Le bonus n’a pas pu être reçu. Réessayez dans un instant.</p>}
      <button type="button" className={styles.kPrefLine} onClick={openPref}>
        <span>Version préférée</span>
        <span className={styles.kPrefValue}>
          {savedTick > 0 ? (
            <>
              <Mark ok /> Enregistré
            </>
          ) : versionPref === null ? 'Automatique' : versionName(versionPref)}
        </span>
      </button>

      <div className={styles.kSearchResults}>
        <h3 className={styles.kAccountSection}>En cours</h3>
        {current.length === 0 && <p className={styles.kSearchHint}>Aucune location en cours.</p>}
        <div role="list">
          {current.map((row) => {
            const film = filmById.get(row.filmId);
            return (
              <div key={row.filmId} role="listitem" className={`${styles.kSearchRow} ${styles.kAccountRow}`}>
                {film && <KioskPoster film={film} size="w185" className={styles.kSearchPoster} />}
                <span className={styles.kSearchText}>
                  <span className={styles.kSearchTitle}>{row.title}</span>
                  <span className={styles.kSearchMeta}>{row.timeLeft}</span>
                  <ReviewLine state={reviewStateFor(row.filmId, reviewed, eligibility)} onWrite={() => onReview(row.filmId)} />
                </span>
                <button type="button" className={`${styles.kNoticeBtn} ${styles.kNoticeBtnPrimary} ${styles.kRentalWatch}`} onClick={() => onWatch(row.filmId)}>
                  Regarder
                </button>
              </div>
            );
          })}
        </div>

        <h3 className={styles.kAccountSection}>Historique</h3>
        {past.length === 0 && <p className={styles.kSearchHint}>Aucune location terminée.</p>}
        <div role="list">
          {past.map((row, i) => {
            const film = filmById.get(row.filmId);
            const end = row.end.atMs === null ? 'terminée' : `${row.end.kind} le ${dayLabel(row.end.atMs)}`;
            return (
              <div key={`${row.filmId}-${i}`} role="listitem" className={`${styles.kSearchRow} ${styles.kAccountRow}`}>
                {film && <KioskPoster film={film} size="w185" className={styles.kSearchPoster} />}
                <span className={styles.kSearchText}>
                  <span className={styles.kSearchTitle}>{row.title}</span>
                  <span className={styles.kSearchMeta}>{end}</span>
                  <span className={styles.kAccountFact}>
                    <Mark ok={row.rewound} /> {row.rewound ? 'Rembobiné · +1 crédit' : 'Pas rembobiné'}
                  </span>
                  <span className={styles.kAccountFact}>
                    <Mark ok={row.returnedEarly} /> {row.returnedEarly ? 'Rendu en avance · +1 crédit' : 'Pas rendu en avance'}
                  </span>
                  <ReviewLine state={row.review} onWrite={() => onReview(row.filmId)} />
                </span>
              </div>
            );
          })}
        </div>

        <button type="button" className={`${styles.kNoticeBtn} ${styles.kAccountLogout}`} onClick={onLogout}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
