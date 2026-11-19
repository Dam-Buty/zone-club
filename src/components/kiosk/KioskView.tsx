import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react';
import { useStore, useCredits } from '../../store';
import { useBackGuard } from '../../hooks/useBackGuard';
import api from '../../api';
import type { Film } from '../../types';
import { castOwnsFilm, castView } from '../../cast/cast-machine';
import { KioskAction, type KioskFilmDetail } from './KioskAction';
import { KioskAuth } from './KioskAuth';
import { KioskBrowse } from './KioskBrowse';
import { KioskCastBar } from './KioskCastBar';
import { KioskDetail } from './KioskDetail';
import { KioskReady, KioskWaiting } from './KioskDistribution';
import { KioskAccount } from './KioskAccount';
import { KioskReview } from './KioskReview';
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
  followBaseline,
  KIOSK_RENT_TIMEOUT_MS,
  hidesKioskInLandscape,
  kioskBackAction,
  lcdDevicePixel,
  lcdPitchInDevicePixels,
  phoneLayout,
  phoneLayoutVars,
  rentalOverStep,
  viewingAngle,
  watchEntry,
  type DetailTab,
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

/** Même requête que la feuille de style : l'écran 2:3 du PC garde sa mise en page fixe. */
const PC_QUERY = '(min-width: 769px) and (pointer: fine)';

/**
 * Sur un téléphone, la mise en page de l'écran de la borne dépend de sa taille réelle : chaque
 * commande garde une hauteur minimale en pixels, la place qui reste va au résumé et aux jaquettes
 * (phoneLayout). Mesurée sur l'écran de la borne lui-même, à chaque changement de taille. `castBar` :
 * la barre du Cast est montrée, sa place est réservée au-dessus de la bande.
 */
function usePhoneLayoutVars(screen: RefObject<HTMLDivElement | null>, castBar: boolean): CSSProperties | undefined {
  const [pxPerCqw, setPxPerCqw] = useState<number | null>(null);
  const [isPc, setIsPc] = useState(() => typeof window !== 'undefined' && window.matchMedia(PC_QUERY).matches);
  useLayoutEffect(() => {
    const el = screen.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPxPerCqw(width / 100);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [screen]);
  useEffect(() => {
    const query = window.matchMedia(PC_QUERY);
    const update = () => setIsPc(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return useMemo(() => (isPc || !pxPerCqw ? undefined : (phoneLayoutVars(phoneLayout(pxPerCqw, castBar)) as CSSProperties)), [isPc, pxPerCqw, castBar]);
}

/**
 * L'angle de vue d'une dalle TN, d'après l'inclinaison du téléphone (viewingAngle) : vue d'en
 * dessus l'image se délave, vue d'en dessous elle s'assombrit, de côté sa teinte glisse, et le
 * reflet glisse sur la vitre. Écrit en variables CSS sur l'écran de la borne, à chaque image, sans
 * passer par React. Rien sur un appareil sans capteur (PC), ni sur iPhone, qui exigerait une
 * autorisation, ni pour qui a demandé moins de mouvement.
 */
function useViewingAngle(screen: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = screen.current;
    if (!el || typeof window.DeviceOrientationEvent === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let baseBeta = NaN;
    let baseGamma = NaN;
    let last = 0;
    let frame = 0;
    let sample: { beta: number; gamma: number } | null = null;
    const apply = () => {
      frame = 0;
      if (!sample) return;
      const now = performance.now();
      const dt = last ? now - last : 0;
      last = now;
      baseBeta = followBaseline(baseBeta, sample.beta, dt);
      baseGamma = followBaseline(baseGamma, sample.gamma, dt);
      const a = viewingAngle(sample.beta - baseBeta, sample.gamma - baseGamma);
      el.style.setProperty('--k-view-wash', a.washOut.toFixed(3));
      el.style.setProperty('--k-view-dark', a.darken.toFixed(3));
      el.style.setProperty('--k-view-warm', a.warm.toFixed(3));
      el.style.setProperty('--k-view-cool', a.cool.toFixed(3));
      el.style.setProperty('--k-reflect-x', a.reflectX.toFixed(3));
      el.style.setProperty('--k-reflect-y', a.reflectY.toFixed(3));
    };
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return;
      sample = { beta: event.beta, gamma: event.gamma };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      cancelAnimationFrame(frame);
    };
  }, [screen]);
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
  const openPlayer = useStore((state) => state.openPlayer);
  const castFilm = useStore((state) => state.castFilm);
  const castDismiss = useStore((state) => state.castDismiss);
  const castNotice = useStore((state) => state.cast.notice);
  // Le film que la TV signale (elle le joue, ne répond plus, ou vient de le finir) : lecteur fermé, la barre du Cast
  // le montre au-dessus de la bande, à la place que phoneLayout lui réserve.
  const castFilmId = useStore((state) => castOwnsFilm(state.cast));
  const castBarFilm = isPlayerOpen ? null : castFilmId;
  // Le lecteur ne dessine rien sans location (voir « Location terminée » plus bas).
  const playerHasRental = useStore((state) => state.currentPlayingFilm !== null && state.getRental(state.currentPlayingFilm) !== undefined);
  const credits = useCredits();
  const phoneLandscape = usePhoneLandscape();
  const density = useScreenDensity();
  const screenRef = useRef<HTMLDivElement>(null);
  const layoutVars = usePhoneLayoutVars(screenRef, castBarFilm !== null);
  useViewingAngle(screenRef);
  // Allumage du rétroéclairage à l'ouverture de la borne (.kWarm), une seule fois ; pas pour qui a
  // demandé moins de mouvement.
  const [warming, setWarming] = useState(() => typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const [mode, setMode] = useState<'browse' | 'search'>('browse');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Fiche détaillée du film affiché, ouverte d'un appui sur sa jaquette, et sa rubrique.
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('resume');
  const openDetail = useCallback(() => {
    setDetailTab('resume');
    setDetailOpen(true);
  }, []);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  // Un seul message à la fois dans l'écran.
  const [notice, setNotice] = useState<KioskNoticeSpec | null>(null);

  // ----- Distribution de la K7 (spec 2026-11-17) -----
  // « Veuillez patienter » pendant l'appel au serveur, puis le panneau « Votre K7 est prête ». Le même panneau, titré
  // « Où voulez-vous regarder ? » (`fresh` faux), pose la question à chaque reprise d'un film déjà loué.
  const [distribution, setDistribution] = useState<{ phase: 'waiting' | 'ready'; filmId: number; fresh: boolean } | null>(null);
  // « Mon compte » (spec 2026-11-17-borne-mon-compte) : ouvert par « Compte » ou depuis le panneau d'après location.
  const [accountOpen, setAccountOpen] = useState(false);
  // Film dont la critique s'écrit (formulaire de la tâche 6 du plan « Mon compte »).
  const [reviewFilmId, setReviewFilmId] = useState<number | null>(null);
  const onRenting = useCallback((filmId: number | null) => {
    setDistribution(filmId === null ? null : { phase: 'waiting', filmId, fresh: true });
  }, []);
  const onRented = useCallback((filmId: number) => setDistribution({ phase: 'ready', filmId, fresh: true }), []);
  const closeReady = useCallback(() => setDistribution(null), []);

  // ----- « Où voulez-vous regarder ? » (refonte du Cast, spec 2026-11-18, § 5.4) -----
  // Toute ouverture du lecteur par la borne en porte l'origine : son en-tête et sa télécommande ramènent ici.
  /** « REGARDER » d'un film loué, « Regarder » de « Mon compte » : la TV a déjà ce film → le lecteur ; sinon le panneau. */
  const watch = (filmId: number) => {
    if (watchEntry({ view: castView(useStore.getState().cast, filmId) }) === 'remote') {
      openPlayer(filmId, { from: 'kiosk', ask: false });
      return;
    }
    setDistribution({ phase: 'ready', filmId, fresh: false });
  };
  /** « Sur ce téléphone » : le panneau a demandé, le lecteur ne redemande pas et lance le film. */
  const watchHere = (filmId: number) => {
    closeReady();
    openPlayer(filmId, { from: 'kiosk', ask: false });
  };
  /**
   * « Sur ma télé ». Apple avec AirPlay : le Cast de Google n'y existe pas, et le sélecteur d'AirPlay exige un appui
   * direct — le lecteur s'ouvre avec son invite, qui le porte. Ailleurs, le Cast part DANS cet appui (le sélecteur
   * d'appareils exige son activation : ni attente ni promesse avant castFilm), puis le lecteur montre l'attente.
   */
  const watchOnTv = (filmId: number, entry: 'airplay' | 'cast') => {
    closeReady();
    if (entry === 'airplay') {
      openPlayer(filmId, { from: 'kiosk', ask: true });
      return;
    }
    castFilm(filmId);
    openPlayer(filmId, { from: 'kiosk', ask: false });
  };
  // Un serveur muet ne doit pas enfermer le visiteur : au bout de KIOSK_RENT_TIMEOUT_MS, l'attente
  // laisse place à un message qui mène à « Mes locations » (la location a pu aboutir) et à « Quitter ».
  // Si la réponse arrive ensuite, le parcours normal reprend (panneau ou message d'erreur).
  const waitingFilmId = distribution?.phase === 'waiting' ? distribution.filmId : null;
  useEffect(() => {
    if (waitingFilmId === null) return;
    const id = window.setTimeout(() => {
      setDistribution(null);
      setNotice({
        title: 'La borne ne répond pas',
        body: 'La location a peut-être été enregistrée : vérifiez dans Mon compte.',
        primary: {
          label: 'Mon compte',
          onPress: () => {
            setNotice(null);
            setAccountOpen(true);
          },
        },
        // La sortie de la borne, comme « quitter » (déclaré plus bas).
        secondary: { label: 'Quitter', onPress: () => setScene('exterior') },
      });
    }, KIOSK_RENT_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [waitingFilmId, setScene]);

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
            stock: film.rental_status.stock,
            earliestReturn: film.rental_status.earliest_return ?? null,
            directors: (film.directors ?? []).map((d) => d.name),
            cast: (film.actors ?? []).map((a) => a.name),
            roles: (film.actors ?? []).map((a) => ({ name: a.name, character: a.character ?? '' })),
            titleOriginal: film.title_original ?? null,
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
    // Le compte se pose au même niveau que la recherche : on la ferme d'abord, sinon il s'ouvrirait dessous.
    closeSearch();
    if (!isAuthenticated || !authUser) {
      // Une fois connecté, on arrive directement sur « Mon compte ».
      requestAuth(() => setAccountOpen(true));
      return;
    }
    // Le compte se consulte à tout moment, sans avoir à louer d'abord (Rusmir, 17/11/2026).
    setAccountOpen(true);
  };

  // ----- « Location terminée » (refonte du Cast, spec 2026-11-18, § 5.2 bis) -----
  // La location du film qui passait sur la TV a disparu (échéance, retour, déconnexion) : le service a arrêté la TV et
  // laissé ce message. Le lecteur ne peut pas le dire (il ne dessine rien sans location) : la borne le dit, après ses
  // propres messages, et le fermer l'efface (castDismiss). Un lecteur resté ouvert sans location est fermé d'abord.
  const rentalOver = castNotice?.code === 'rental_over' ? castNotice : null;
  const rentalStep = rentalOver ? rentalOverStep({ playerOpen: isPlayerOpen, playerHasRental }) : null;
  useEffect(() => {
    if (rentalStep === 'close-player') closePlayer();
  }, [rentalStep, closePlayer]);
  const rentalOverTitle = rentalOver ? catalogue.find((f) => f.id === rentalOver.filmId)?.title : undefined;
  const rentalOverBody = rentalOverTitle ? `«\u00a0${rentalOverTitle}\u00a0»` : undefined;
  const rentalOverNotice: KioskNoticeSpec | null =
    rentalStep === 'show' ? { title: 'Location terminée', body: rentalOverBody, primary: { label: 'Fermer', onPress: castDismiss } } : null;

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
      : notice ?? rentalOverNotice;

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
      waiting: distribution?.phase === 'waiting',
      readyOpen: distribution?.phase === 'ready',
      accountOpen,
      reviewOpen: reviewFilmId !== null,
      noticeClosable: catalog !== 'unavailable',
      authOpen,
      phrasePending: pendingPhrase !== null,
      searchOpen: mode === 'search',
      detailOpen,
      trailerOpen: detailOpen && detailTab === 'bande-annonce',
    });
    if (action === 'close-player') closePlayer();
    // Le message de la borne d'abord ; sinon c'est « Location terminée », qui vient du Cast.
    else if (action === 'close-notice') {
      if (notice) closeNotice();
      else castDismiss();
    }
    else if (action === 'close-ready') closeReady();
    else if (action === 'close-review') setReviewFilmId(null);
    else if (action === 'close-account') setAccountOpen(false);
    else if (action === 'cancel-auth') cancelAuth();
    else if (action === 'close-trailer') setDetailTab('resume');
    else if (action === 'close-detail') closeDetail();
    else if (action === 'close-search') closeSearch();
    else if (overlay === null && !authVisible && distribution === null) setQuitHintTick((tick) => tick + 1);
  };
  const guardArmed = useArmedAfterMount();
  const [trapArmed, setTrapArmed] = useState(true);
  useBackGuard(guardArmed && trapArmed, onBack);
  useEffect(() => {
    if (trapArmed) return;
    const id = window.setTimeout(() => setTrapArmed(true), 0);
    return () => window.clearTimeout(id);
  }, [trapArmed]);

  // Tirer vers le bas en haut de page recharge la page sur Chrome Android — et une page rechargée
  // a quitté la borne, ce que seul « Quitter » doit faire. Le blog de Chrome : couper l'enchaînement
  // du défilement sur l'élément qui définit la fenêtre (html ou body) désactive ce geste. Le temps
  // que la borne est ouverte seulement.
  useEffect(() => {
    const targets = [document.documentElement, document.body];
    const before = targets.map((el) => el.style.overscrollBehaviorY);
    for (const el of targets) el.style.overscrollBehaviorY = 'none';
    return () => {
      targets.forEach((el, i) => {
        el.style.overscrollBehaviorY = before[i];
      });
    };
  }, []);

  // Un appui long ouvre le menu du navigateur sur Android (« ouvrir l'image », « télécharger »…) :
  // pas sur une borne. Les champs de saisie et la phrase de récupération le gardent, pour coller et copier.
  const blockContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest('input, textarea, code')) event.preventDefault();
  };

  // Téléphone en paysage : la borne s'efface (elle garde son état) devant l'invitation à
  // redresser l'appareil. Sous le lecteur, elle est inerte : ni focus clavier, ni appui.
  const hidden = phoneLandscape;

  return (
    <>
    <div className={`${styles.root} ${hidden ? states.rootHidden : ''}`} inert={isPlayerOpen || hidden} onContextMenu={blockContextMenu}>
      <div className={styles.sign} aria-hidden="true">
        {/* Décor : l'enseigne est une image rendue (voir .neonImg). Son conteneur est masqué aux lecteurs d'écran. */}
        <img className={styles.neonImg} src="/kiosk/neon-location-247.webp" alt="" width={1345} height={302} decoding="async" draggable={false} />
      </div>

      <div className={styles.body}>
        <Spines tints={SPINES_SIDE} className={`${styles.spines} ${styles.sideVitrine}`} />

        <div className={styles.column}>
          <div className={styles.bezel}>
            <div ref={screenRef} className={styles.ks} style={{ '--k-dpx': lcdDevicePixel(density), '--k-lcd-n': lcdPitchInDevicePixels(density) } as CSSProperties}>
              <div className={styles.screen} data-mode={mode} data-cast-bar={castBarFilm !== null || undefined} style={layoutVars}>
                <div className={styles.kTop} inert={overlay !== null || distribution !== null}>
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

                {/* Sous la fiche détaillée, le parcours reste monté (rayon, page, position de la bande) mais caché. */}
                <div
                  className={styles.kPane}
                  inert={overlay !== null || distribution !== null || authVisible || mode === 'search' || detailOpen || accountOpen}
                  style={detailOpen ? { visibility: 'hidden' } : undefined}
                >
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
                      onOpenDetail={openDetail}
                      actionSlot={(film) => (
                        <KioskAction film={film} detail={currentDetail} onNotice={setNotice} onRequestAuth={requestAuth} onRenting={onRenting} onRented={onRented} onWatch={watch} />
                      )}
                    />
                  )}
                  {castBarFilm !== null && (
                    <KioskCastBar filmId={castBarFilm} title={catalogue.find((f) => f.id === castBarFilm)?.title ?? 'Film en cours'} />
                  )}
                </div>

                {detailOpen && catalog === 'ready' && displayed && (
                  <div className={styles.kLayer} inert={overlay !== null || distribution !== null || authVisible}>
                    <KioskDetail
                      film={displayed}
                      detail={currentDetail}
                      tab={detailTab}
                      onTab={setDetailTab}
                      onBack={closeDetail}
                      onOpenFilm={(film) => {
                        setSelectedId(film.id);
                        setDetailTab('resume');
                      }}
                      action={<KioskAction film={displayed} detail={currentDetail} onNotice={setNotice} onRequestAuth={requestAuth} onRenting={onRenting} onRented={onRented} onWatch={watch} />}
                    />
                  </div>
                )}

                {accountOpen && (
                  <div className={styles.kLayer} inert={overlay !== null || distribution !== null || authVisible || reviewFilmId !== null}>
                    <KioskAccount
                      films={catalogue}
                      onWatch={watch}
                      onReview={(filmId) => setReviewFilmId(filmId)}
                      onLogout={() => {
                        setAccountOpen(false);
                        void logout();
                      }}
                      onBack={() => setAccountOpen(false)}
                    />
                  </div>
                )}

                {reviewFilmId !== null && (
                  <div className={styles.kLayer} inert={overlay !== null || authVisible}>
                    <KioskReview
                      filmId={reviewFilmId}
                      title={
                        catalogue.find((f) => f.id === reviewFilmId)?.title ??
                        useStore.getState().rentalHistory.find((h) => h.filmId === reviewFilmId)?.title ??
                        'Titre indisponible'
                      }
                      onDone={() => setReviewFilmId(null)}
                      onBack={() => setReviewFilmId(null)}
                    />
                  </div>
                )}

                {mode === 'search' && catalog === 'ready' && (
                  <div className={styles.kLayer} inert={overlay !== null || distribution !== null || authVisible}>
                    <KioskSearch films={catalogue} onPick={pickFromSearch} onBack={closeSearch} />
                  </div>
                )}

                {authVisible && <KioskAuth onDone={finishAuth} onCancel={cancelAuth} />}

                {distribution?.phase === 'waiting' && <KioskWaiting />}
                {distribution?.phase === 'ready' && (() => {
                  const { filmId, fresh } = distribution;
                  return (
                    <KioskReady
                      fresh={fresh}
                      title={catalogue.find((f) => f.id === filmId)?.title ?? 'Titre indisponible'}
                      expiresAt={useStore.getState().getRental(filmId)?.expiresAt ?? null}
                      onWatch={() => watchHere(filmId)}
                      onTv={(entry) => watchOnTv(filmId, entry)}
                      // Ouvert depuis « Mon compte », le compte est déjà dessous : le panneau se ferme et c'est tout.
                      onAccount={() => {
                        closeReady();
                        setAccountOpen(true);
                      }}
                      onLater={closeReady}
                    />
                  );
                })()}

                {overlay && <KioskNotice {...overlay} />}

                {/* Allumage des tubes du rétroéclairage : l'écran part du noir et monte, un peu chaud et terne. */}
                {warming && <div className={styles.kWarm} aria-hidden="true" onAnimationEnd={() => setWarming(false)} />}

                {/* Fourmillement de la dalle (FRC) : décor, au-dessus de tout ce que l'écran affiche. */}
                <div className={styles.kFrc} aria-hidden="true" />
              </div>
            </div>
          </div>

          {/* Décor sous l'écran (fente, vitrine) : il prend la hauteur qui reste, et s'efface quand il n'en reste pas. */}
          <div className={styles.below}>
            <div className={styles.slot} aria-hidden="true">retour des cassettes</div>
            <div className={styles.vitrine}>
              <Spines tints={SPINES_BELOW} className={styles.spines} />
            </div>
          </div>
        </div>
      </div>
    </div>
    {hidden && !isPlayerOpen && <KioskRotate onQuit={quit} />}
    </>
  );
}
