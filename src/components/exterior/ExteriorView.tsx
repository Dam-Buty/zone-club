import { useEffect, useRef, useState, useCallback } from 'react';
import { ExteriorScene } from './scene/ExteriorScene';
import { DoorBlockedNotice } from './DoorBlockedNotice';
import { useIsMobile } from '../../hooks/useIsMobile';
import { releaseInteriorPreload } from '../../utils/interior-preload-gate';
import { approachTransform, choiceSpans, fitBox, kioskScreenBox, kioskScreenBoxDesktop, stageBox, type Rect, type StorefrontLayout } from './storefront-layout';
import { useApproachFilm } from './useApproachFilm';
import storefrontLayout from '../../data/storefront-mobile.json';
import desktopLayout from '../../data/storefront-desktop.json';
import styles from './ExteriorView.module.css';

// Où sont la borne, son écran et la porte dans l'image de chaque devanture (mobile, bureau). Écrit
// par la fabrique des images (tools/devanture-borne/fabrique.sh) : jamais retouché à la main.
const LAYOUT: StorefrontLayout = storefrontLayout;
const LAYOUT_DESKTOP: StorefrontLayout = desktopLayout;
// Le film d'approche se fond sur la devanture en 150 ms (feuille de style) ; une fois ce fondu
// passé, la scène animée, désormais cachée dessous, est mise en pause.
const FILM_FADE_IN_MS = 180;
// Bureau : l'indicateur « PUSH » flotte au-dessus de la plaque, à cette distance (en hauteur d'image).
const DESKTOP_PUSH_INDICATOR_RISE = 0.105;

/** Une zone de la mise en page, en pourcentages de la scène. */
const zoneStyle = (r: Rect) => ({
  left: `${r.x0 * 100}%`,
  top: `${r.y0 * 100}%`,
  width: `${(r.x1 - r.x0) * 100}%`,
  height: `${(r.y1 - r.y0) * 100}%`,
});

// Hauteur de la barre des deux boutons, sous l'image (même valeur dans la feuille de style, qui y
// ajoute l'encoche du bas : la hauteur réelle est relue sur la barre elle-même).
const CHOICES_BAR_HEIGHT = 76;

const readViewport = () => (
  typeof window === 'undefined' ? { w: 390, h: 844 } : { w: window.innerWidth, h: window.innerHeight }
);

// Au-delà, on lève le rideau même sans devanture : une image qui n'arrive jamais ne doit pas
// interdire l'entrée dans la boutique.
const CURTAIN_MAX_WAIT_MS = 10000;
// Décompte du message de la porte avant la bascule vers la borne.
const DOOR_NOTICE_SECONDS = 15;

interface ExteriorViewProps {
  onEnter: () => void;
  /** Ouvre la borne de location. Appelé à la fin du film d'approche, ou tout de suite s'il ne peut pas jouer. */
  onOpenKiosk: () => void;
  /** Le visiteur vient d'appuyer sur la borne : appelé tout de suite, avant toute animation. */
  onKioskIntent?: () => void;
  /** Faux quand le vidéoclub 3D ne peut pas s'ouvrir sur cet appareil (pas de WebGPU). */
  canEnter: boolean;
  /** La devanture est à l'écran (appelé à chaque affichage, avec ou sans WebGPU). */
  onShown?: () => void;
}

export function ExteriorView({ onEnter, onOpenKiosk, onKioskIntent, canEnter, onShown }: ExteriorViewProps) {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ExteriorScene | null>(null);
  const [isHoveringDoor, setIsHoveringDoor] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  // La porte est poussée alors que le vidéoclub ne peut pas s'ouvrir : message vers la borne.
  const [isDoorBlocked, setIsDoorBlocked] = useState(false);
  // Sans WebGL, la devanture animée ne peut pas exister : on retombe sur l'image fixe.
  const [webglFailed, setWebglFailed] = useState(false);
  const isStatic = isMobile || webglFailed;

  // Rideau noir : l'indicateur PUSH et le bouton sont du HTML, ils s'affichent tout de suite,
  // alors que la devanture attend ses images. On les garde derrière un noir plein tant que la
  // devanture n'est pas à l'écran. Mémorisé par mode : passer de mobile à desktop referme le rideau.
  const mode = isStatic ? 'mobile' : 'desktop';
  const [storefrontShownFor, setStorefrontShownFor] = useState<'mobile' | 'desktop' | null>(null);
  const isStorefrontShown = storefrontShownFor === mode;
  const mobileImageRef = useRef<HTMLImageElement>(null);

  // Image fixe : la « scène » a les proportions de l'image et la couvre en entier. L'image, les
  // zones d'appui et l'indicateur PUSH sont ses enfants, placés en pourcentages : ils tombent sur
  // leurs objets quelle que soit la fenêtre (barres du navigateur, paysage, repli sans WebGL).
  // La fenêtre est suivie en permanence, bureau compris : rétrécie d'un coup sous 769 px, la
  // devanture passe à l'image fixe, et la scène doit déjà connaître la nouvelle fenêtre.
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // La barre des deux boutons est SOUS l'image : la scène lui laisse sa hauteur et remonte
  // d'autant (le ciel cède la place). Chaque bouton se pose sous son objet, à sa largeur.
  const choicesRef = useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = useState(CHOICES_BAR_HEIGHT);
  useEffect(() => {
    const bar = choicesRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => setReserve(bar.offsetHeight));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [isStatic]);
  const stage = stageBox(LAYOUT, viewport.w, viewport.h, reserve);
  const choices = choiceSpans(LAYOUT, stage, viewport.w);


  // Bureau : la boîte de l'image dans la fenêtre (l'image entière, bandes noires autour). La scène
  // animée y dessine la devanture ; les zones cliquables et les indicateurs s'y posent.
  const contentBox = fitBox(LAYOUT_DESKTOP.image, viewport.w, viewport.h);

  // Le film d'approche de la borne — celui de la devanture affichée (mobile ou bureau) : téléchargé
  // une fois la devanture à l'écran, lancé au choix de la borne ; à son arrivée la borne s'ouvre,
  // sur l'écran filmé.
  const approach = (isStatic ? LAYOUT : LAYOUT_DESKTOP).approche;
  const film = useApproachFilm({
    url: approach.src,
    durationMs: approach.duree * 1000,
    load: isStorefrontShown,
    onArrive: onOpenKiosk,
  });
  const filmPlaying = film.phase === 'playing';
  // La scène animée est sous le film : une fois celui-ci fondu, elle s'arrête et se cache (la boîte
  // du film bouge un peu pendant le trajet, la devanture figée dépasserait autour).
  const [sceneHidden, setSceneHidden] = useState(false);
  useEffect(() => {
    if (!filmPlaying) return;
    const timer = window.setTimeout(() => {
      sceneRef.current?.pause();
      setSceneHidden(true);
    }, FILM_FADE_IN_MS);
    return () => window.clearTimeout(timer);
  }, [filmPlaying]);

  // Initialize WebGL scene (desktop only)
  useEffect(() => {
    if (isStatic) return;
    if (!containerRef.current) return;

    // Create the exterior scene. Sans contexte WebGL (navigateur ancien, GPU sur liste noire),
    // le constructeur lève : la devanture retombe alors sur son image fixe.
    try {
      sceneRef.current = new ExteriorScene(
        containerRef.current,
        LAYOUT_DESKTOP.image.w / LAYOUT_DESKTOP.image.h,
        () => setStorefrontShownFor('desktop'),
      );
    } catch {
      sceneRef.current = null;
      // Bascule unique vers l'image fixe : c'est bien un second rendu qu'on veut ici, et l'échec
      // ne se constate qu'en créant le contexte, donc dans l'effet.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWebglFailed(true);
      return;
    }

    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [isStatic]);

  // Image fixe : la devanture est une <img>. decode() couvre les deux cas — image déjà en cache
  // (l'événement load est passé avant le montage) et image encore en route.
  useEffect(() => {
    if (!isStatic) return;
    const img = mobileImageRef.current;
    if (!img) return;
    let cancelled = false;
    const show = () => { if (!cancelled) setStorefrontShownFor('mobile'); };
    img.decode().then(show, show);
    return () => { cancelled = true; };
  }, [isStatic]);

  // La devanture est à l'écran : le code de la borne est demandé d'abord (onShown), puis les
  // préchargements de l'intérieur peuvent partir — ou repartir, au retour de la borne.
  // `onShown` est une fonction stable (définie au niveau du module dans App) : l'effet ne
  // repart qu'à un nouvel affichage de la devanture.
  useEffect(() => {
    if (!isStorefrontShown) return;
    onShown?.();
    releaseInteriorPreload();
  }, [isStorefrontShown, onShown]);

  // Garde-fou : ne jamais rester bloqué sur le noir.
  useEffect(() => {
    if (isStorefrontShown) return;
    const timer = setTimeout(() => setStorefrontShownFor(mode), CURTAIN_MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [isStorefrontShown, mode]);

  const handleEnterClick = () => {
    // Le bouton existe déjà sous le rideau (clavier, lecteur d'écran) : pas d'entrée à l'aveugle.
    // Et le film vers la borne est parti : jamais la borne puis le vidéoclub.
    if (!isStorefrontShown || film.phase !== 'idle') return;
    // Le vidéoclub ne peut pas s'ouvrir ici : la porte explique pourquoi et propose la borne.
    if (!canEnter) {
      setIsDoorBlocked(true);
      return;
    }
    setIsTransitioning(true);
    // Fade out then trigger scene change
    setTimeout(() => {
      onEnter();
    }, 600);
  };

  const closeDoorNotice = useCallback(() => setIsDoorBlocked(false), []);

  // Porte poussée : la transition vers le vidéoclub est partie, la borne ne s'ouvre plus (elle
  // s'ouvrait, puis le visiteur était emmené à l'intérieur 0,7 s plus tard).
  const openKiosk = () => {
    // Une seule transition : ni double appui, ni borne après la porte, ni appui sous le rideau.
    if (isTransitioning || film.phase !== 'idle' || !isStorefrontShown) return;
    // Dès l'appui : le GPU et les chargements du vidéoclub sont libérés, avant toute animation.
    onKioskIntent?.();
    // Le film d'approche. S'il ne peut pas partir (pas encore téléchargé, animations réduites), la
    // borne s'ouvre tout de suite : elle ne se fait jamais attendre.
    if (!film.start()) onOpenKiosk();
  };

  // Pendant le film, un appui n'importe où mène directement à l'arrivée.
  const skipFilm = film.phase !== 'idle' ? film.skip : undefined;

  const doorNotice = isDoorBlocked && (
    <DoorBlockedNotice
      reason="no-webgpu"
      seconds={DOOR_NOTICE_SECONDS}
      onOpenKiosk={onOpenKiosk}
      onDismiss={closeDoorNotice}
    />
  );

  // ===== MOBILE (ou repli sans WebGL) : la devanture fabriquée, la borne à côté de la porte =====
  if (isStatic) {
    // Pendant le film, la scène glisse de sa place vers celle où l'écran filmé de la dernière image
    // coïncide avec l'écran de l'interface. Sur un bureau retombé sur l'image fixe (pas de WebGL),
    // l'interface garde son gabarit PC : c'est son écran-là qu'il faut viser.
    const kioskTarget = filmPlaying && window.matchMedia('(min-width: 769px) and (pointer: fine)').matches
      ? kioskScreenBoxDesktop(viewport.w, viewport.h)
      : kioskScreenBox(viewport.w, viewport.h);
    const stageShift = filmPlaying ? approachTransform(stage, LAYOUT.approche.ecran, kioskTarget) : null;
    return (
      <div
        className={`${styles.container} ${styles.mobileContainer} ${isTransitioning ? styles.fadeOut : ''} ${filmPlaying ? styles.containerFilm : ''}`}
        onClick={skipFilm}
      >
        {/* La scène : l'image et tout ce qui s'y accroche */}
        <div
          className={`${styles.mobileStage} ${filmPlaying ? styles.mobileStageFilm : ''}`}
          style={{
            left: stage.left,
            top: stage.top,
            width: stage.width,
            height: stage.height,
            transform: stageShift ? `translate(${stageShift.x}px, ${stageShift.y}px) scale(${stageShift.scale})` : undefined,
            transitionDuration: stageShift ? `${LAYOUT.approche.duree}s` : undefined,
          }}
        >
          <picture>
            <source srcSet="/storefront-mobile.webp" type="image/webp" />
            <img
              ref={mobileImageRef}
              src="/storefront-mobile.jpeg"
              alt="Zone Club - le vidéoclub et sa borne de location"
              className={styles.mobileImage}
              draggable={false}
            />
          </picture>

          {/* Le film d'approche : en place et invisible, calé sur l'image ; il se fond dès sa
              première image affichée. Muet, servi par le site. */}
          <video
            ref={film.videoRef}
            src={film.src ?? undefined}
            className={`${styles.approachFilm} ${filmPlaying ? styles.approachFilmShown : ''}`}
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
          />

          {/* La borne entière et la porte entière répondent à l'appui. Hors de l'ordre de
              tabulation : au clavier, ce sont les deux boutons du bas qui servent. */}
          <button
            type="button"
            className={styles.mobileZone}
            style={zoneStyle(LAYOUT.borne)}
            onClick={openKiosk}
            tabIndex={-1}
            aria-label="Ouvrir la borne de location"
          />
          <button
            type="button"
            className={styles.mobileZone}
            style={zoneStyle(LAYOUT.porte)}
            onClick={handleEnterClick}
            tabIndex={-1}
            aria-label="Entrer dans le vidéoclub"
          />

          {/* L'indicateur PUSH, juste au-dessus de la plaque de la porte */}
          <div
            className={styles.mobileDoorIndicator}
            style={{ left: `${LAYOUT.push.x * 100}%`, top: `${LAYOUT.push.y * 100}%` }}
            aria-hidden="true"
          >
            <span className={styles.doorIndicatorText}>PUSH</span>
            <span className={styles.doorIndicatorArrow}>&#9660;</span>
          </div>
        </div>

        {/* Les deux choix, dans une bande sous l'image : chaque bouton est sous son objet, à sa
            largeur, et sa flèche pointe vers lui. Présente dès le montage (sa hauteur est réservée
            à la scène) ; sous le rideau, ses boutons ne font rien. */}
        <div ref={choicesRef} className={`${styles.mobileChoices} ${filmPlaying ? styles.mobileChoicesLeaving : ''}`}>
          <button
            type="button"
            className={styles.mobileChoice}
            style={{ left: choices.borne.left, width: choices.borne.width }}
            onClick={openKiosk}
          >
            <svg className={styles.mobileChoiceArrow} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 18 6 6M6 15V6h9" />
            </svg>
            <span className={styles.mobileChoiceLabel}>
              <span className={styles.mobileChoiceTitle}>BORNE 24/7</span>
              <span className={styles.mobileChoiceHint}>louer sans entrer</span>
            </span>
          </button>
          <button
            type="button"
            className={`${styles.mobileChoice} ${styles.mobileChoiceDoor}`}
            style={{ left: choices.porte.left, width: choices.porte.width }}
            onClick={handleEnterClick}
          >
            <span className={styles.mobileChoiceLabel}>
              <span className={styles.mobileChoiceTitle}>PORTE VIDÉOCLUB</span>
              <span className={styles.mobileChoiceHint}>entrer</span>
            </span>
            <svg className={styles.mobileChoiceArrow} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 18 18 6M9 6h9v9" />
            </svg>
          </button>
        </div>

        {/* Rideau noir, levé en fondu quand la devanture est affichée */}
        <div className={`${styles.curtain} ${isStorefrontShown ? styles.curtainOpen : ''}`} aria-hidden="true" />

        {doorNotice}

        {/* Transition overlay */}
        {isTransitioning && <div className={styles.transitionOverlay} />}
      </div>
    );
  }

  // ===== BUREAU : la devanture animée (WebGL), la borne et la porte cliquables en entier =====
  const push = LAYOUT_DESKTOP.push;
  const screen = LAYOUT_DESKTOP.ecran;
  // Pendant le film, sa boîte glisse de celle de la devanture vers celle où l'écran filmé de la
  // dernière image coïncide avec l'écran de l'interface.
  const filmShift = filmPlaying
    ? approachTransform(contentBox, approach.ecran, kioskScreenBoxDesktop(viewport.w, viewport.h))
    : null;
  return (
    <div
      className={`${styles.container} ${isTransitioning ? styles.fadeOut : ''} ${filmPlaying ? styles.containerFilm : ''}`}
      onClick={skipFilm}
    >
      {/* WebGL Canvas Container */}
      <div ref={containerRef} className={`${styles.canvasContainer} ${sceneHidden ? styles.canvasHidden : ''}`} />

      {/* La boîte de l'image : tout ce qui tombe sur un objet de la devanture s'y pose, en
          pourcentages de la mise en page (src/data/storefront-desktop.json). */}
      <div
        className={`${styles.contentArea} ${filmPlaying ? styles.contentAreaFilm : ''}`}
        style={{
          left: contentBox.left,
          top: contentBox.top,
          width: contentBox.width,
          height: contentBox.height,
          transform: filmShift ? `translate(${filmShift.x}px, ${filmShift.y}px) scale(${filmShift.scale})` : undefined,
          transitionDuration: filmShift ? `${approach.duree}s` : undefined,
        }}
      >
        {/* Le film d'approche : en place et invisible, calé sur l'image ; il se fond dès sa
            première image affichée. Muet, servi par le site. */}
        <video
          ref={film.videoRef}
          src={film.src ?? undefined}
          className={`${styles.approachFilm} ${filmPlaying ? styles.approachFilmShown : ''}`}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />

        {/* La borne entière et la porte entière répondent au clic */}
        <button
          type="button"
          className={`${styles.desktopZone} ${styles.desktopKioskZone}`}
          style={zoneStyle(LAYOUT_DESKTOP.borne)}
          onClick={openKiosk}
          aria-label="Ouvrir la borne de location"
        />
        <button
          type="button"
          className={styles.desktopZone}
          style={zoneStyle(LAYOUT_DESKTOP.porte)}
          onMouseEnter={() => setIsHoveringDoor(true)}
          onMouseLeave={() => setIsHoveringDoor(false)}
          onClick={handleEnterClick}
          aria-label="Entrer dans le vidéoclub"
        />

        {/* Au survol de la porte : la lueur et l'invitation, sur la plaque « PUSH » */}
        <div
          className={`${styles.doorHotspot} ${isHoveringDoor ? styles.doorHover : ''}`}
          style={{ left: `${push.x * 100}%`, top: `${push.y * 100}%` }}
          aria-hidden="true"
        >
          <span className={styles.enterText}>Click pour entrer</span>
        </div>

        {/* L'indicateur de la porte, au-dessus de la plaque */}
        <div
          className={styles.doorIndicator}
          style={{ left: `${push.x * 100}%`, top: `${(push.y - DESKTOP_PUSH_INDICATOR_RISE) * 100}%` }}
          aria-hidden="true"
        >
          <span className={styles.doorIndicatorText}>PUSH</span>
          <span className={styles.doorIndicatorArrow}>&#9660;</span>
        </div>

        {/* L'indicateur de la borne, juste au-dessus de son écran */}
        <div
          className={styles.kioskIndicator}
          style={{ left: `${((screen.x0 + screen.x1) / 2) * 100}%`, top: `${screen.y0 * 100}%` }}
          aria-hidden="true"
        >
          <span className={styles.doorIndicatorText}>BORNE LOCATION</span>
          <span className={styles.doorIndicatorArrow}>&#9660;</span>
        </div>
      </div>

      {/* Rideau noir, levé en fondu quand la devanture est affichée */}
      <div className={`${styles.curtain} ${isStorefrontShown ? styles.curtainOpen : ''}`} aria-hidden="true" />

      {doorNotice}

      {/* Transition overlay */}
      {isTransitioning && <div className={styles.transitionOverlay} />}
    </div>
  );
}
