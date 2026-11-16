import { useCallback, useEffect, useId, useRef, useState } from 'react';
import styles from './ExteriorView.module.css';

// Message de la porte quand le vidéoclub 3D ne peut pas (ou ne devrait pas) s'ouvrir sur cet
// appareil. Il oriente vers la borne par un bouton et un décompte ; il n'enferme jamais le
// visiteur : « Rester devant la devanture » le referme, et « Entrer quand même » n'existe que
// si l'entrée est réellement possible (onForceEnter fourni — lot 2, appareil sous le seuil).

interface DoorBlockedNoticeProps {
  reason: 'no-webgpu' | 'low-power';
  /** Durée du décompte avant la bascule vers la borne. */
  seconds: number;
  onOpenKiosk: () => void;
  onDismiss: () => void;
  onForceEnter?: () => void;
}

const COPY: Record<DoorBlockedNoticeProps['reason'], { title: string; body: string }> = {
  'no-webgpu': {
    title: "Le vidéoclub ne peut pas s'ouvrir sur cet appareil",
    body: "Votre navigateur n'a pas WebGPU, nécessaire à la visite en 3D. Essayez avec un ordinateur ou un téléphone plus récent. En attendant, la borne vous permet de louer et de regarder tous les films.",
  },
  'low-power': {
    title: "Cet appareil n'est pas assez puissant pour le vidéoclub",
    body: 'La visite en 3D demande un appareil plus puissant. Essayez avec un ordinateur ou un téléphone plus récent. En attendant, la borne vous permet de louer et de regarder tous les films.',
  },
};

function detectBrowser(): 'firefox' | 'safari' | 'chrome' | 'other' {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  if (ua.includes('Chrome')) return 'chrome';
  return 'other';
}

function WebGPUHelp() {
  const browser = detectBrowser();
  return (
    <details className={styles.doorNoticeHelp}>
      <summary>Comment activer WebGPU ?</summary>
      {browser === 'chrome' && (
        <>
          <p><strong>Chrome / Edge</strong></p>
          <p>WebGPU est actif par défaut depuis Chrome 113. Vérifiez que l'accélération matérielle est activée :</p>
          <p className={styles.doorNoticeHint}>Paramètres &gt; Système &gt; Utiliser l'accélération matérielle</p>
        </>
      )}
      {browser === 'firefox' && (
        <>
          <p><strong>Firefox</strong></p>
          <p>WebGPU n'est pas actif par défaut sur Firefox. Pour l'activer :</p>
          <ol>
            <li>Tapez <code>about:config</code> dans la barre d'adresse</li>
            <li>Cherchez <code>dom.webgpu.enabled</code></li>
            <li>Passez la valeur à <strong>true</strong></li>
            <li>Redémarrez Firefox</li>
          </ol>
        </>
      )}
      {browser === 'safari' && (
        <>
          <p><strong>Safari</strong></p>
          <p>WebGPU est disponible depuis Safari 17. Vérifiez :</p>
          <ol>
            <li>Menu Développeur &gt; Fonctionnalités expérimentales</li>
            <li>Activez <strong>WebGPU</strong></li>
            <li>Rechargez la page</li>
          </ol>
          <p className={styles.doorNoticeHint}>
            (Si le menu Développeur n'apparaît pas : Préférences &gt; Avancé &gt; Afficher le menu Développeur)
          </p>
        </>
      )}
      {browser === 'other' && (
        <p>Utilisez Chrome 113+, Edge 113+ ou Safari 17+ pour accéder au vidéoclub.</p>
      )}
    </details>
  );
}

export function DoorBlockedNotice({ reason, seconds, onOpenKiosk, onDismiss, onForceEnter }: DoorBlockedNoticeProps) {
  const titleId = useId();
  const [remaining, setRemaining] = useState(seconds);
  // La bascule vers la borne ne part qu'une fois, qu'elle vienne du bouton ou du décompte.
  const firedRef = useRef(false);

  const goToKiosk = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onOpenKiosk();
  }, [onOpenKiosk]);

  // Décompte : une seconde à la fois, en pause tant que l'onglet est caché, arrêté au démontage.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (remaining === 0) goToKiosk();
  }, [remaining, goToKiosk]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const copy = COPY[reason];

  return (
    <div className={styles.doorNoticeBackdrop}>
      <div className={styles.doorNotice} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.doorNoticeTitle}>{copy.title}</h2>
        <p className={styles.doorNoticeBody}>{copy.body}</p>

        <div className={styles.doorNoticeActions}>
          <button type="button" className={styles.doorNoticePrimary} onClick={goToKiosk} autoFocus>
            Aller à la borne ({remaining})
          </button>
          <button type="button" className={styles.doorNoticeSecondary} onClick={onDismiss}>
            Rester devant la devanture
          </button>
          {onForceEnter && (
            <button type="button" className={styles.doorNoticeSecondary} onClick={onForceEnter}>
              Entrer quand même
            </button>
          )}
        </div>

        {reason === 'no-webgpu' && <WebGPUHelp />}
      </div>
    </div>
  );
}
