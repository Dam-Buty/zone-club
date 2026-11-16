import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useBackGuard } from '../../hooks/useBackGuard';

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

// Borne de location — coque minimale : de quoi traverser l'application (ouvrir, quitter,
// geste retour). L'écran de la borne vient ensuite.
export function KioskView() {
  const setScene = useStore((state) => state.setScene);
  const quit = useCallback(() => setScene('exterior'), [setScene]);
  const guardArmed = useArmedAfterMount();
  useBackGuard(guardArmed, quit);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0d0c16', color: '#e9e6f2' }}>
      <button type="button" onClick={quit} style={{ margin: 16, padding: '10px 16px' }}>
        quitter
      </button>
    </div>
  );
}
