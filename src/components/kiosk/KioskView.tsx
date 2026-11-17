import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useStore, useCredits } from '../../store';
import { useBackGuard } from '../../hooks/useBackGuard';
import api from '../../api';
import type { Film } from '../../types';
import { KioskAction, type KioskFilmDetail } from './KioskAction';
import { KioskAuth } from './KioskAuth';
import { KioskBrowse } from './KioskBrowse';
import { KioskNotice, type KioskNoticeSpec } from './KioskNotice';
import { KioskSearch } from './KioskSearch';
import {
  allFilms,
  catalogState,
  createPendingAction,
  creditsLabel,
  creditsLine,
  filmsForTab,
  firstNonEmptyTab,
  hidesKioskInLandscape,
  kioskBackAction,
  lcdDevicePixel,
  lcdPitchInDevicePixels,
  type KioskTab,
} from './kiosk-logic';
import states from './KioskStates.module.css';
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

/** Téléphone tenu en paysage ? Lu sur l'ÉCRAN, pas sur la fenêtre (le clavier virtuel la rétrécit). */
function readPhoneLandscape(): boolean {
  if (typeof window === 'undefined') return false;
  const type = window.screen?.orientation?.type;
  return hidesKioskInLandscape({
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    landscape: type ? type.startsWith('landscape') : window.matchMedia('(orientation: landscape)').matches,
    shortSide: Math.min(window.screen.width, window.screen.height),
  });
}

function usePhoneLandscape(): boolean {
  const [value, setValue] = useState(readPhoneLandscape);
  useEffect(() => {
    const update = () => setValue(readPhoneLandscape());
    const orientation = window.screen?.orientation;
    window.addEventListener('resize', update);
    orientation?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      orientation?.removeEventListener?.('change', update);
    };
  }, []);
  return value;
}

/**
 * Densité de l'écran sur lequel la fenêtre se trouve. La grille de la dalle s'y cale ; elle est
 * suivie quand elle change — zoom du navigateur, ou fenêtre glissée d'un écran dense vers un
 * écran qui ne l'est pas (ce cas ne déclenche pas toujours `resize`, d'où la requête média).
 */
function useScreenDensity(): number | undefined {
  const [ratio, setRatio] = useState(() => (typeof window === 'undefined' ? undefined : window.devicePixelRatio));
  useEffect(() => {
    let query: MediaQueryList | null = null;
    const watch = () => {
      query?.removeEventListener('change', onChange);
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', onChange);
    };
    function onChange() {
      setRatio(window.devicePixelRatio);
      watch();
    }
    watch();
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('resize', onChange);
      query?.removeEventListener('change', onChange);
    };
  }, []);
  return ratio;
}

/**
 * Sur un téléphone, le paysage est réservé au film : à la place de la borne, une invitation à
 * redresser l'appareil. Elle garde une sortie, pour ne jamais laisser le visiteur sans issue.
 */
function KioskRotate({ onQuit }: { onQuit: () => void }) {
  return (
    <div className={states.rotate} role="status">
      <div className={states.rotatePhone} aria-hidden="true" />
      <p className={states.rotateTitle}>Tournez votre téléphone</p>
      <p className={states.rotateText}>La borne s&apos;utilise à la verticale. Le paysage est réservé aux films.</p>
      <button type="button" className={states.rotateQuit} onClick={onQuit}>
        Quitter la borne
      </button>
    </div>
  );
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
  const isPlayerOpen = useStore((state) => state.isPlayerOpen);
  const closePlayer = useStore((state) => state.closePlayer);
  const credits = useCredits();
  const phoneLandscape = usePhoneLandscape();
  const density = useScreenDensity();

  const [mode, setMode] = useState<'browse' | 'search'>('browse');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Un seul message à la fois dans l'écran.
  const [notice, setNotice] = useState<KioskNoticeSpec | null>(null);

  // « quitter » est la SEULE sortie de la borne (avec ses deux relais : « Quitter » du message
  // « Catalogue indisponible » et de l'invitation à redresser le téléphone).
  const quit = useCallback(() => setScene('exterior'), [setScene]);

  // ----- Catalogue : jamais un écran vide -----
  const catalogue = useMemo(() => allFilms(films), [films]);
  const total = catalogue.length;
  const [waitStart, setWaitStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  // Le chargement a répondu sans rien rapporter : inutile de faire patienter 8 s.
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    if (total > 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [total, waitStart]);
  const catalog = catalogState(total, now - waitStart, loadFailed);

  const requestCatalog = useCallback(() => {
    void loadFilmsFromApi().finally(() => {
      setLoadFailed(allFilms(useStore.getState().films).length === 0);
    });
  }, [loadFilmsFromApi]);
  // La borne ne s'en remet pas au préchargement fait au chargement de la page : si le catalogue
  // manque à son ouverture (préchargement en échec, ou pas encore arrivé), elle le demande.
  useEffect(() => {
    if (allFilms(useStore.getState().films).length === 0) requestCatalog();
  }, [requestCatalog]);

  const retryCatalog = useCallback(() => {
    const t = Date.now();
    setWaitStart(t);
    setNow(t);
    setLoadFailed(false);
    requestCatalog();
  }, [requestCatalog]);

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
            directors: (film.directors ?? []).map((d) => d.name),
            cast: (film.actors ?? []).map((a) => a.name),
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

  // ----- Geste retour : il agit DANS la borne, il ne la quitte jamais -----
  // Une seule garde pour toute la borne, reposée dès qu'elle a servi : le geste (ou le bouton
  // retour du navigateur) ferme ce qui est ouvert, du plus haut au plus bas (kioskBackAction) ;
  // à la racine il ne fait rien, sinon rappeler où est la sortie. Le lecteur, lui, porte sa
  // propre garde, posée au-dessus de celle-ci.
  // Compteur plutôt que booléen : chaque geste relance les deux secondes du rappel.
  const [quitHintTick, setQuitHintTick] = useState(0);
  const quitHint = quitHintTick > 0;
  useEffect(() => {
    if (quitHintTick === 0) return;
    const id = window.setTimeout(() => setQuitHintTick(0), 2200);
    return () => window.clearTimeout(id);
  }, [quitHintTick]);

  const onBack = () => {
    setTrapArmed(false);
    const action = kioskBackAction({
      playerOpen: isPlayerOpen,
      noticeOpen: overlay !== null,
      noticeClosable: catalog !== 'unavailable',
      authOpen,
      phrasePending: pendingPhrase !== null,
      searchOpen: mode === 'search',
    });
    if (action === 'close-player') closePlayer();
    else if (action === 'close-notice') closeNotice();
    else if (action === 'cancel-auth') cancelAuth();
    else if (action === 'close-search') closeSearch();
    else if (overlay === null && !authVisible) setQuitHintTick((tick) => tick + 1);
  };
  const guardArmed = useArmedAfterMount();
  const [trapArmed, setTrapArmed] = useState(true);
  useBackGuard(guardArmed && trapArmed, onBack);
  useEffect(() => {
    if (trapArmed) return;
    const id = window.setTimeout(() => setTrapArmed(true), 0);
    return () => window.clearTimeout(id);
  }, [trapArmed]);

  // Téléphone en paysage : la borne s'efface (elle garde son état) devant l'invitation à
  // redresser l'appareil. Sous le lecteur, elle est inerte : ni focus clavier, ni appui.
  const hidden = phoneLandscape;

  return (
    <>
    <div className={`${styles.root} ${hidden ? states.rootHidden : ''}`} inert={isPlayerOpen || hidden}>
      <div className={styles.sign} aria-hidden="true">
        {/* Décor : l'enseigne est une image rendue (voir .neonImg). Son conteneur est masqué aux lecteurs d'écran. */}
        <img className={styles.neonImg} src="/kiosk/neon-location-247.webp" alt="" width={1345} height={302} decoding="async" draggable={false} />
      </div>

      <div className={styles.body}>
        <Spines tints={SPINES_SIDE} className={`${styles.spines} ${styles.sideVitrine}`} />

        <div className={styles.column}>
          <div className={styles.bezel}>
            <div className={styles.ks} style={{ '--k-dpx': lcdDevicePixel(density), '--k-lcd-n': lcdPitchInDevicePixels(density) } as CSSProperties}>
              <div className={styles.screen} data-mode={mode}>
                <div className={styles.kTop} inert={overlay !== null}>
                  <div className={styles.kLogo}>
                    VIDÉOCLUB<small>borne 24/7</small>
                  </div>
                  <div className={styles.kNav}>
                    <button type="button" className={styles.kNavBtn} onClick={openAccount}>
                      Compte
                      {isAuthenticated && authUser && (
                        <>
                          {/* L'espace ne se voit pas (bouton en flex) mais sépare les mots pour un lecteur d'écran. */}
                          {' '}
                          <span className={styles.kNavCredits}>{creditsLabel(credits)}</span>
                        </>
                      )}
                    </button>
                    <button type="button" className={`${styles.kNavBtn} ${quitHint ? styles.kNavHint : ''}`} onClick={quit}>
                      Quitter
                      <svg className={styles.kNavTri} viewBox="0 0 9 12" aria-hidden="true">
                        <path d="M8 1 1 6l7 5z" />
                      </svg>
                    </button>
                    <span className={states.srOnly} role="status">
                      {quitHint ? 'Pour sortir de la borne, utilisez le bouton quitter.' : ''}
                    </span>
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
                      credits={currentDetail ? creditsLine(currentDetail.directors, currentDetail.cast) : null}
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

                {/* Fourmillement de la dalle (FRC) : décor, au-dessus de tout ce que l'écran affiche. */}
                <div className={styles.kFrc} aria-hidden="true" />
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
    {hidden && !isPlayerOpen && <KioskRotate onQuit={quit} />}
    </>
  );
}
