import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore, useCredits } from '../../store';
import { useBackGuard } from '../../hooks/useBackGuard';
import api from '../../api';
import type { Film } from '../../types';
import { KioskAction, type KioskFilmDetail } from './KioskAction';
import { KioskAuth } from './KioskAuth';
import { KioskBrowse } from './KioskBrowse';
import { KioskNotice, type KioskNoticeSpec } from './KioskNotice';
import { KioskSearch } from './KioskSearch';
import { allFilms, catalogState, createPendingAction, creditsLabel, filmsForTab, firstNonEmptyTab, type KioskTab } from './kiosk-logic';
import styles from './KioskView.module.css';

// Borne de location : seconde façon de louer, sans aucun rendu 3D. Cette coque porte le corps
// de la borne (métal, enseigne, fente, vitrines), son écran, la barre du haut et les messages ;
// le parcours des films vit dans KioskBrowse.

/**
 * Vrai une image après le montage. La garde du geste retour ne doit pas être posée dès le
 * montage : en dev, StrictMode rejoue les effets de montage (pose, retrait, pose), et le retrait
 * de l'entrée d'historique étant asynchrone, il retombe une entrée trop loin — « quitter »
 * faisait alors sortir du site. Posée sur un changement d'état, la garde n'est installée qu'une fois.
 */
function useArmedAfterMount(): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return armed;
}

// Tranches de K7 des vitrines : teintes tirées d'une suite fixe, identiques d'un affichage à l'autre.
const SPINE_TINTS = ['#1e1e24', '#b3261e', '#1f4fa8', '#e0b12a', '#2f7d4f', '#6b2fa8', '#d8d4c8', '#c9571b', '#14141a', '#0f8a8a', '#2a2a33', '#8c1d4b'];
function spineTints(count: number, seed: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const r = Math.abs(Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453) % 1;
    return SPINE_TINTS[Math.floor(r * SPINE_TINTS.length)];
  });
}
const SPINES_SIDE = spineTints(46, 1);
const SPINES_BELOW = spineTints(9, 0);

function Spines({ tints, className }: { tints: string[]; className: string }) {
  return (
    <div className={className} aria-hidden="true">
      {tints.map((tint, i) => (
        <i key={i} style={{ background: tint }} />
      ))}
    </div>
  );
}

export function KioskView() {
  const setScene = useStore((state) => state.setScene);
  const films = useStore((state) => state.films);
  const loadFilmsFromApi = useStore((state) => state.loadFilmsFromApi);
  const isAuthenticated = useStore((state) => state.isAuthenticated);
  const authUser = useStore((state) => state.authUser);
  const logout = useStore((state) => state.logout);
  const credits = useCredits();

  const [mode, setMode] = useState<'browse' | 'search'>('browse');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Un seul message à la fois dans l'écran.
  const [notice, setNotice] = useState<KioskNoticeSpec | null>(null);

  const quit = useCallback(() => setScene('exterior'), [setScene]);
  const guardArmed = useArmedAfterMount();
  useBackGuard(guardArmed, quit);

  // ----- Catalogue : jamais un écran vide -----
  const catalogue = useMemo(() => allFilms(films), [films]);
  const total = catalogue.length;
  const [waitStart, setWaitStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (total > 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [total, waitStart]);
  const catalog = catalogState(total, now - waitStart);

  const retryCatalog = useCallback(() => {
    const t = Date.now();
    setWaitStart(t);
    setNow(t);
    void loadFilmsFromApi();
  }, [loadFilmsFromApi]);

  // Film affiché : celui qu'on a choisi, sinon le premier de Nouveautés (ou du premier rayon garni).
  const displayed = useMemo<Film | null>(() => {
    const chosen = selectedId === null ? undefined : catalogue.find((f) => f.id === selectedId);
    return chosen ?? filmsForTab(films, firstNonEmptyTab(films), 'rayon')[0] ?? null;
  }, [catalogue, films, selectedId]);

  // ----- Recherche -----
  // Choisir un résultat affiche le film et ramène aux rayons, sur l'onglet de SON rayon : le
  // parcours est remonté (clé) pour repartir de cet onglet, bande au début.
  const [browse, setBrowse] = useState<{ key: number; tab?: KioskTab }>({ key: 0 });
  const closeSearch = useCallback(() => setMode('browse'), []);
  const pickFromSearch = (film: Film) => {
    setSelectedId(film.id);
    setBrowse((current) => ({ key: current.key + 1, tab: film.aisle ?? 'tous' }));
    setMode('browse');
  };
  // Le geste retour ferme la recherche avant de quitter la borne.
  useBackGuard(mode === 'search', closeSearch);

  // ----- Détail du film affiché : versions jouables et copies restantes -----
  // La réponse porte l'identifiant du film demandé : celle d'un film qu'on ne regarde déjà plus
  // est ignorée. En cas d'échec le détail reste inconnu (version « — », stock non vérifié).
  const [detail, setDetail] = useState<{ filmId: number; data: KioskFilmDetail } | null>(null);
  const displayedId = displayed?.id ?? null;
  const displayedTmdbId = displayed?.tmdb_id ?? null;
  useEffect(() => {
    if (displayedId === null || displayedTmdbId === null) return;
    let cancelled = false;
    api.films.getById(displayedTmdbId).then(
      (film) => {
        if (cancelled) return;
        setDetail({
          filmId: displayedId,
          data: {
            vf: !!film.has_vf,
            vo: !!film.has_vo,
            copiesLeft: film.rental_status.available_copies,
            earliestReturn: film.rental_status.earliest_return ?? null,
          },
        });
      },
      () => {
        // Détail indisponible : la fiche reste utilisable, le serveur tranchera à la location.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [displayedId, displayedTmdbId]);
  const currentDetail = detail !== null && detail.filmId === displayedId ? detail.data : null;

  const closeNotice = useCallback(() => setNotice(null), []);

  // ----- Connexion de la borne -----
  // `then` est ce que le visiteur voulait faire quand la connexion s'est imposée (louer) : on le
  // reprend une fois connecté. Une phrase de récupération pas encore confirmée garde le panneau
  // ouvert, quoi qu'il arrive : elle ne se retrouve nulle part ailleurs.
  const [authOpen, setAuthOpen] = useState(false);
  // L'action en attente vit hors du rendu : une connexion annulée pendant qu'elle était en cours
  // aboutit après coup et rappelle un `finishAuth` d'un rendu passé — il ne doit plus rien trouver.
  const [pendingAction] = useState(createPendingAction);
  const pendingPhrase = useStore((state) => state.recoveryPhrase);
  const authVisible = authOpen || pendingPhrase !== null;

  const requestAuth = useCallback((then?: () => void) => {
    pendingAction.set(then);
    setAuthOpen(true);
  }, [pendingAction]);
  const cancelAuth = useCallback(() => {
    pendingAction.cancel();
    setAuthOpen(false);
  }, [pendingAction]);
  const finishAuth = useCallback(() => {
    const then = pendingAction.take();
    setAuthOpen(false);
    then?.();
  }, [pendingAction]);
  // Le geste retour ferme d'abord la connexion, puis la borne (dernière garde posée, première
  // servie). Pas de garde sur l'écran de la phrase : un retour arrière ne doit pas la faire perdre.
  useBackGuard(authOpen && pendingPhrase === null, cancelAuth);

  const openAccount = () => {
    if (authVisible) return;
    if (!isAuthenticated || !authUser) {
      requestAuth();
      return;
    }
    setNotice({
      title: 'Compte',
      body: `${authUser.username} — ${creditsLabel(credits)}`,
      primary: { label: 'Fermer', onPress: closeNotice },
      secondary: {
        label: 'Se déconnecter',
        onPress: () => {
          closeNotice();
          void logout();
        },
      },
    });
  };

  const overlay: KioskNoticeSpec | null =
    catalog === 'unavailable'
      ? {
          title: 'Catalogue indisponible',
          body: 'Vérifiez votre connexion.',
          primary: { label: 'Réessayer', onPress: retryCatalog },
          // Le message couvre la barre du haut : sans ce bouton, un visiteur hors ligne
          // n'aurait plus aucun moyen de revenir à la devanture.
          secondary: { label: 'Quitter', onPress: quit },
        }
      : notice;

  return (
    <div className={styles.root}>
      <div className={styles.sign} aria-hidden="true">
        <span className={styles.neonTxt}>Location 24/7</span>
      </div>

      <div className={styles.body}>
        <Spines tints={SPINES_SIDE} className={`${styles.spines} ${styles.sideVitrine}`} />

        <div className={styles.column}>
          <div className={styles.bezel}>
            <div className={styles.ks}>
              <div className={styles.screen} data-mode={mode}>
                <div className={styles.kTop} inert={overlay !== null}>
                  <div className={styles.kLogo}>
                    VIDÉOCLUB<small>borne 24/7</small>
                  </div>
                  <div className={styles.kNav}>
                    <button type="button" className={styles.kNavBtn} onClick={openAccount}>
                      compte
                    </button>
                    <button type="button" className={styles.kNavBtn} onClick={quit}>
                      quitter<span className={styles.kNavTri} aria-hidden="true">◀</span>
                    </button>
                  </div>
                </div>

                <div className={styles.kPane} inert={overlay !== null || authVisible || mode === 'search'}>
                  {catalog === 'loading' && (
                    <p className={styles.kMessage} role="status">
                      Chargement du catalogue…
                    </p>
                  )}
                  {catalog === 'ready' && (
                    <KioskBrowse
                      key={browse.key}
                      initialTab={browse.tab}
                      selectedId={displayed?.id ?? null}
                      versions={currentDetail ? { vf: currentDetail.vf, vo: currentDetail.vo } : null}
                      onSelect={(film) => setSelectedId(film.id)}
                      onSearch={() => setMode('search')}
                      actionSlot={(film) => (
                        <KioskAction film={film} detail={currentDetail} onNotice={setNotice} onRequestAuth={requestAuth} />
                      )}
                    />
                  )}
                </div>

                {mode === 'search' && catalog === 'ready' && (
                  <div className={styles.kLayer} inert={overlay !== null || authVisible}>
                    <KioskSearch films={catalogue} onPick={pickFromSearch} onBack={closeSearch} />
                  </div>
                )}

                {authVisible && <KioskAuth onDone={finishAuth} onCancel={cancelAuth} />}

                {overlay && <KioskNotice {...overlay} />}
              </div>
            </div>
          </div>

          <div className={styles.slot} aria-hidden="true">retour des cassettes</div>
          <div className={styles.vitrine}>
            <Spines tints={SPINES_BELOW} className={styles.spines} />
          </div>
        </div>
      </div>
    </div>
  );
}
