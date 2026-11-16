import { useEffect, useRef, useState, useCallback } from 'react';
import { ExteriorScene } from './scene/ExteriorScene';
import { DoorBlockedNotice } from './DoorBlockedNotice';
import { useIsMobile } from '../../hooks/useIsMobile';
import { releaseInteriorPreload } from '../../utils/interior-preload-gate';
import styles from './ExteriorView.module.css';

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
}

export function ExteriorView({ onEnter, onOpenKiosk, canEnter }: ExteriorViewProps) {
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

  // La devanture est à l'écran : les préchargements de l'intérieur peuvent partir.
  useEffect(() => {
    if (isStorefrontShown) releaseInteriorPreload();
  }, [isStorefrontShown]);

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

  // Bouton provisoire de la borne : il n'apparaît qu'une fois la devanture à l'écran.
  const kioskButton = (className: string) => isStorefrontShown && (
    <button
      type="button"
      className={className}
      onClick={onOpenKiosk}
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

  // ===== MOBILE (ou repli sans WebGL) : Static storefront image + touch-friendly enter =====
  if (isStatic) {
    return (
      <div className={`${styles.container} ${isTransitioning ? styles.fadeOut : ''}`}>
        {/* Static storefront image — portrait, full-screen */}
        <div className={styles.mobileImageContainer}>
          <picture>
            <source srcSet="/storefront-mobile.webp" type="image/webp" />
            <img
              ref={mobileImageRef}
              src="/storefront-mobile.jpeg"
              alt="Zone Club - Vidéoclub"
              className={styles.mobileImage}
              draggable={false}
            />
          </picture>
        </div>

        {/* PUSH indicator + door hotspot — positioned at door handle level */}
        <div className={styles.mobileDoorIndicator}>
          <span className={styles.doorIndicatorText}>PUSH</span>
          <span className={styles.doorIndicatorArrow}>&#9660;</span>
        </div>

        <button
          className={styles.mobileDoorHotspot}
          onClick={handleEnterClick}
          aria-label="Entrer dans le vidéoclub"
        >
          <span className={styles.mobileEnterText}>Appuyez pour entrer</span>
        </button>

        {kioskButton(`${styles.kioskButton} ${styles.kioskButtonMobile}`)}

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
