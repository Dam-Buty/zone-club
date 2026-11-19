import { useStore } from '../../store';
import { castChipLabel, castChipLook } from '../../cast/cast-labels';
import { TvIcon } from './KioskDistribution';
import { castBarLabel, kioskLabelCase } from './kiosk-logic';
import styles from './KioskCastBar.module.css';

// La barre du Cast de la borne (refonte du Cast, docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.5
// point 6). Lecteur fermé, la TV a un film à signaler — elle le joue, ne répond plus, ou vient de le finir — : la puce
// flottante du vidéoclub (néon, posée par-dessus la page) recouvrait la bande de jaquettes de la borne. Ici c'est un
// bouton de la borne, dans son écran : l'aplat et le filet de « Recherche », sa police, sa casse, à la place que
// phoneLayout lui réserve entre LOUER et la bande. L'appui rouvre le lecteur sur ce film, depuis la borne (le retour de
// la télécommande y ramène) et sans invite : la TV a déjà son film.
//
// KioskView décide quand elle est montrée (sa place dans l'écran en dépend) ; la barre dit l'état. Visuel PROVISOIRE
// tant que Rusmir ne l'a pas vu.

interface KioskCastBarProps {
  /** Le film que la TV signale (`castOwnsFilm`). */
  filmId: number;
  /** Son titre dans le catalogue de la borne, « Film en cours » s'il n'y est pas. */
  title: string;
}

export function KioskCastBar({ filmId, title }: KioskCastBarProps) {
  const phase = useStore((state) => state.cast.phase);
  const openPlayer = useStore((state) => state.openPlayer);
  const label = castChipLabel(phase);
  if (label === null) return null;
  // Le point de l'état : vert quand la TV joue, orange quand elle ne répond plus, aucun pour un film terminé. Fixe :
  // rien de comparable ne clignote dans la borne.
  const { dot } = castChipLook(phase);

  return (
    // Un lecteur d'écran entend ce que fait l'appui (« Ouvrir la télécommande de … »), pas « titre, état ».
    <button
      type="button"
      className={styles.kCastBar}
      aria-label={castBarLabel(phase, title) ?? undefined}
      onClick={() => openPlayer(filmId, { from: 'kiosk', ask: false })}
    >
      <TvIcon className={styles.kCastIcon} />
      <span className={styles.kCastTitle}>{title}</span>
      <span className={styles.kCastState}>
        {dot !== null && <i className={`${styles.kCastDot} ${dot === 'live' ? styles.kCastDotLive : styles.kCastDotWarn}`} aria-hidden="true" />}
        {kioskLabelCase(label)}
      </span>
    </button>
  );
}
