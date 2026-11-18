import { useEffect, useRef, useState, useCallback } from 'react';
import { ExteriorScene } from './scene/ExteriorScene';
import { DoorBlockedNotice } from './DoorBlockedNotice';
import { useIsMobile } from '../../hooks/useIsMobile';
import { releaseInteriorPreload } from '../../utils/interior-preload-gate';
import { stageBox, type Rect, type StorefrontLayout } from './storefront-layout';
import storefrontLayout from '../../data/storefront-mobile.json';
import styles from './ExteriorView.module.css';

// Où sont la borne, son écran et la porte dans l'image de la devanture mobile. Écrit par la
// fabrique des images (tools/devanture-borne/fabrique.sh) : jamais retouché à la main.
const LAYOUT: StorefrontLayout = storefrontLayout;

/** Une zone de la mise en page, en pourcentages de la scène. */
const zoneStyle = (r: Rect) => ({
  left: `${r.x0 * 100}%`,
  top: `${r.y0 * 100}%`,
  width: `${(r.x1 - r.x0) * 100}%`,
  height: `${(r.y1 - r.y0) * 100}%`,
});

const readViewport = () => (
  typeof window === 'undefined' ? { w: 390, h: 844 } : { w: window.innerWidth, h: window.innerHeight }
);

// Au-delà, on lève le rideau même sans devanture : une image qui n'arrive jamais ne doit pas
// interdire l'entrée dans la boutique.
const CURTAIN_MAX_WAIT_MS = 10000;
const TARGET_ASPECT_RATIO = 5632 / 3072; // ~1.833
// Décompte du message de la porte avant la bascule vers la borne.
const DOOR_NOTICE_SECONDS = 15;

interface ExteriorViewProps {
  onEnter: () => void;
  /** Ouvre la borne de location (bouton provisoire, en attendant la borne modélisée du lot 3). */
  onOpenKiosk: () => void;
  /** Faux quand le vidéoclub 3D ne peut pas s'ouvrir sur cet appareil (pas de WebGPU). */
  canEnter: boolean;
  /** La devanture est à l'écran (appelé à chaque affichage, avec ou sans WebGPU). */
  onShown?: () => void;
}

export function ExteriorView({ onEnter, onOpenKiosk, canEnter, onShown }: ExteriorViewProps) {
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
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    if (!isStatic) return;
    const onResize = () => setViewport(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isStatic]);
  const stage = stageBox(LAYOUT, viewport.w, viewport.h);

  // Content area dimensions (for hotspot positioning) — desktop only
  const [contentArea, setContentArea] = useState({ width: '100%', height: '100%', top: '0', left: '0' });

  // Calculate content area based on aspect ratio and window size (desktop only)
  const updateContentArea = useCallback(() => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const windowAspect = windowWidth / windowHeight;

    let width: number, height: number, top: number, left: number;

    if (windowAspect > TARGET_ASPECT_RATIO) {
      // Pillarbox (black bars on sides)
      height = windowHeight;
      width = windowHeight * TARGET_ASPECT_RATIO;
      top = 0;
      left = (windowWidth - width) / 2;
    } else {
      // Letterbox (black bars top/bottom)
      width = windowWidth;
      height = windowWidth / TARGET_ASPECT_RATIO;
      top = (windowHeight - height) / 2;
      left = 0;
    }

    setContentArea({
      width: `${width}px`,
      height: `${height}px`,
      top: `${top}px`,
      left: `${left}px`,
    });
  }, []);

  // Initialize WebGL scene and content area (desktop only)
  useEffect(() => {
    if (isStatic) return;
    if (!containerRef.current) return;

    // Create the exterior scene. Sans contexte WebGL (navigateur ancien, GPU sur liste noire),
    // le constructeur lève : la devanture retombe alors sur son image fixe.
    try {
      sceneRef.current = new ExteriorScene(containerRef.current, () => setStorefrontShownFor('desktop'));
    } catch {
      sceneRef.current = null;
      // Bascule unique vers l'image fixe : c'est bien un second rendu qu'on veut ici, et l'échec
      // ne se constate qu'en créant le contexte, donc dans l'effet.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWebglFailed(true);
      return;
    }

    // Calculate initial content area
    updateContentArea();

    // Update on resize
    window.addEventListener('resize', updateContentArea);

    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
      window.removeEventListener('resize', updateContentArea);
    };
  }, [isStatic, updateContentArea]);

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
    if (!isStorefrontShown) return;
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
    // Sous le rideau, la zone de la borne existe déjà : pas d'ouverture à l'aveugle non plus.
    if (isTransitioning || !isStorefrontShown) return;
    onOpenKiosk();
  };

  // Bouton provisoire de la borne (bureau, en attendant sa devanture élargie) : il n'apparaît
  // qu'une fois la devanture à l'écran.
  const kioskButton = (className: string) => isStorefrontShown && (
    <button
      type="button"
      className={className}
      onClick={openKiosk}
      aria-label="Ouvrir la borne de location"
    >
      <span className={styles.kioskButtonTitle}>BORNE 24/7</span>
      <span className={styles.kioskButtonHint}>louer sans entrer &#9660;</span>
    </button>
  );

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
    return (
      <div className={`${styles.container} ${styles.mobileContainer} ${isTransitioning ? styles.fadeOut : ''}`}>
        {/* La scène : l'image et tout ce qui s'y accroche */}
        <div
          className={styles.mobileStage}
          style={{ left: stage.left, top: stage.top, width: stage.width, height: stage.height }}
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

        {/* Les deux choix, en bas de la fenêtre : chaque flèche pointe vers son objet */}
        {isStorefrontShown && (
          <div className={styles.mobileChoices}>
            <button type="button" className={styles.mobileChoice} onClick={openKiosk}>
              <svg className={styles.mobileChoiceArrow} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 18 6 6M6 15V6h9" />
              </svg>
              <span className={styles.mobileChoiceLabel}>
                <span className={styles.mobileChoiceTitle}>BORNE 24/7</span>
                <span className={styles.mobileChoiceHint}>louer sans entrer</span>
              </span>
            </button>
            <button type="button" className={`${styles.mobileChoice} ${styles.mobileChoiceDoor}`} onClick={handleEnterClick}>
              <span className={styles.mobileChoiceLabel}>
                <span className={styles.mobileChoiceTitle}>PORTE VIDÉOCLUB</span>
                <span className={styles.mobileChoiceHint}>entrer</span>
              </span>
              <svg className={styles.mobileChoiceArrow} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 18 18 6M9 6h9v9" />
              </svg>
            </button>
          </div>
        )}

        {/* Rideau noir, levé en fondu quand la devanture est affichée */}
        <div className={`${styles.curtain} ${isStorefrontShown ? styles.curtainOpen : ''}`} aria-hidden="true" />

        {doorNotice}

        {/* Transition overlay */}
        {isTransitioning && <div className={styles.transitionOverlay} />}
      </div>
    );
  }

  // ===== DESKTOP: WebGL scene + hover hotspot =====
  return (
    <div className={`${styles.container} ${isTransitioning ? styles.fadeOut : ''}`}>
      {/* WebGL Canvas Container */}
      <div ref={containerRef} className={styles.canvasContainer} />

      {/* Content area wrapper for hotspot positioning */}
      <div
        className={styles.contentArea}
        style={{
          width: contentArea.width,
          height: contentArea.height,
          top: contentArea.top,
          left: contentArea.left,
        }}
      >
        {/* Floating indicator above door */}
        <div className={styles.doorIndicator}>
          <span className={styles.doorIndicatorText}>PUSH</span>
          <span className={styles.doorIndicatorArrow}>&#9660;</span>
        </div>

        {/* Door hotspot */}
        <button
          className={`${styles.doorHotspot} ${isHoveringDoor ? styles.doorHover : ''}`}
          onMouseEnter={() => setIsHoveringDoor(true)}
          onMouseLeave={() => setIsHoveringDoor(false)}
          onClick={handleEnterClick}
          aria-label="Entrer dans le vidéoclub"
        >
          <span className={styles.enterText}>Click pour entrer</span>
        </button>

        {/* Borne : sur le mur, à gauche de la porte */}
        {kioskButton(styles.kioskButton)}
      </div>

      {/* Rideau noir, levé en fondu quand la devanture est affichée */}
      <div className={`${styles.curtain} ${isStorefrontShown ? styles.curtainOpen : ''}`} aria-hidden="true" />

      {doorNotice}

      {/* Transition overlay */}
      {isTransitioning && <div className={styles.transitionOverlay} />}
    </div>
  );
}
