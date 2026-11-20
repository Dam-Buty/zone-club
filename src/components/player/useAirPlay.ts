import { useCallback, useEffect, useState, type RefObject } from 'react';

// AirPlay du lecteur (Safari) : l'élément vidéo est autorisé à partir sur une TV, on suit la disponibilité d'un
// appareil et la connexion, et on ouvre le sélecteur d'Apple. Sorti de VHSPlayer.tsx tel quel.

export type AirPlayVideoElement = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

/**
 * `videoKey` change à chaque nouvel élément <video> (autre source, « Réessayer ») : les écouteurs suivent l'élément.
 * `openAirPlayPicker` ouvre le sélecteur, ou rend la raison pour laquelle il ne s'ouvre pas (null quand il s'ouvre).
 */
export function useAirPlay(videoRef: RefObject<HTMLVideoElement | null>, isPlayerOpen: boolean, videoKey: string) {
  const [isAirPlaySupported, setIsAirPlaySupported] = useState(false);
  const [isAirPlayAvailable, setIsAirPlayAvailable] = useState(false);
  const [isAirPlayConnected, setIsAirPlayConnected] = useState(false);

  // Lecteur fermé : rien à suivre (il n'est monté qu'ouvert, et ne dessine rien fermé).
  useEffect(() => {
    if (!isPlayerOpen) return;

    const video = videoRef.current as AirPlayVideoElement | null;
    if (!video) return;

    video.setAttribute('x-webkit-airplay', 'allow');
    video.setAttribute('airplay', 'allow');
    (video as HTMLVideoElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = false;

    const supportsAirPlay = typeof video.webkitShowPlaybackTargetPicker === 'function';
    setIsAirPlaySupported(supportsAirPlay);
    setIsAirPlayAvailable(supportsAirPlay);
    setIsAirPlayConnected(Boolean(video.webkitCurrentPlaybackTargetIsWireless));

    const handleAvailability = (event: Event) => {
      const availability = (event as Event & { availability?: string }).availability;
      setIsAirPlayAvailable(availability === 'available');
    };

    const handleWirelessChange = () => {
      setIsAirPlayConnected(Boolean(video.webkitCurrentPlaybackTargetIsWireless));
    };

    video.addEventListener('webkitplaybacktargetavailabilitychanged', handleAvailability as EventListener);
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleWirelessChange as EventListener);

    return () => {
      video.removeEventListener('webkitplaybacktargetavailabilitychanged', handleAvailability as EventListener);
      video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleWirelessChange as EventListener);
    };
  }, [videoRef, isPlayerOpen, videoKey]);

  const openAirPlayPicker = useCallback((): string | null => {
    const video = videoRef.current as AirPlayVideoElement | null;
    if (!video || typeof video.webkitShowPlaybackTargetPicker !== 'function') {
      return 'AirPlay indisponible sur ce navigateur.';
    }
    if (!isAirPlayAvailable && !isAirPlayConnected) {
      return 'Aucun appareil AirPlay détecté sur le même réseau.';
    }
    video.webkitShowPlaybackTargetPicker();
    return null;
  }, [videoRef, isAirPlayAvailable, isAirPlayConnected]);

  return { isAirPlaySupported, isAirPlayAvailable, isAirPlayConnected, openAirPlayPicker };
}
