import { useState } from 'react';
import { useStore, useCredits } from '../../store';
import { RENTAL_COSTS, type Film } from '../../types';
import { getRentalTier } from '../../utils/rental-tier';
import { NO_PLAYABLE_VERSION } from '../../utils/version-choice';
import type { KioskNoticeSpec } from './KioskNotice';
import { actionLabel, confirmRentText, creditsLabel, offersRelogin, rentAction, rentFlow } from './kiosk-logic';
import styles from './KioskBrowse.module.css';

// Le bouton d'action de la fiche. Il ne se grise jamais : quand il ne peut pas louer, il le dit
// (un bouton éteint avale l'appui sans rien expliquer, surtout sur mobile). Et il ne loue jamais
// en un seul appui : la location se confirme (décision de Rusmir du 17/11/2026).

/** Ce que la fiche sait du film au-delà du catalogue : versions jouables, copies restantes, générique. */
export type KioskFilmDetail = {
  vf: boolean;
  vo: boolean;
  copiesLeft: number;
  /** Nombre de copies du club. */
  stock: number;
  earliestReturn: string | null;
  directors: string[];
  cast: string[];
  /** Interprètes et leurs rôles, dans l'ordre du générique (fiche détaillée). */
  roles: { name: string; character: string }[];
  titleOriginal: string | null;
};

interface KioskActionProps {
  film: Film;
  /** `null` tant que le détail n'est pas arrivé (ou s'il a échoué) : stock inconnu. */
  detail: KioskFilmDetail | null;
  onNotice: (notice: KioskNoticeSpec | null) => void;
  /** Ouvre la connexion de la borne, puis appelle `then` une fois le visiteur connecté. */
  onRequestAuth: (then: () => void) => void;
  /** « Veuillez patienter » : le film dont la location part au serveur, puis `null` à sa réponse. */
  onRenting: (filmId: number | null) => void;
  /** La location est enregistrée : la borne distribue la K7 (panneau « Votre K7 est prête »). */
  onRented: (filmId: number) => void;
  /** La confirmation de location s'ouvre : la borne en profite pour télécharger la vidéo de distribution et la tranche de ce film. */
  onConfirmOpen?: (filmId: number) => void;
  /**
   * « REGARDER » sur un film déjà loué : la borne décide — le lecteur si la TV a déjà ce film, sinon son panneau
   * « Où voulez-vous regarder ? » (refonte du Cast, § 5.4). Ce bouton n'ouvre jamais le lecteur lui-même.
   */
  onWatch: (filmId: number) => void;
}

// Un verrou par film, partagé par tous les affichages du bouton : revenir sur une fiche pendant
// que sa location est en route ne doit pas permettre de la lancer une seconde fois.
const rentLocks = new Map<number, { busy: boolean }>();
function lockFor(filmId: number): { busy: boolean } {
  let lock = rentLocks.get(filmId);
  if (!lock) {
    lock = { busy: false };
    rentLocks.set(filmId, lock);
  }
  return lock;
}

export function KioskAction({ film, detail, onNotice, onRequestAuth, onRenting, onRented, onConfirmOpen, onWatch }: KioskActionProps) {
  const isAuthenticated = useStore((state) => state.isAuthenticated);
  const isRented = useStore((state) => state.rentals.some((r) => r.filmId === film.id));
  const credits = useCredits();
  // Le film dont la location est en route (le bouton sert à tous les films, l'un après l'autre).
  const [rentingId, setRentingId] = useState<number | null>(null);
  const renting = rentingId === film.id;

  const cost = RENTAL_COSTS[getRentalTier(film)];
  const copiesLeft = detail ? detail.copiesLeft : null;
  const isAvailable = film.is_available !== false;
  // Sans détail (pas encore arrivé, ou en échec), le film est supposé lisible : le serveur tranchera à la location.
  const playable = detail ? detail.vf || detail.vo : true;
  const action = rentAction({ isAuthenticated, isRented, isAvailable, playable, copiesLeft, credits, cost });

  const shown = actionLabel(action, cost, renting);

  const close = () => onNotice(null);
  const say = (title: string, body: string) => onNotice({ title, body, primary: { label: 'Fermer', onPress: close } });

  // La location elle-même, une fois confirmée. L'état est relu au moment de la confirmation.
  const rentNow = async () => {
    const state = useStore.getState();
    // Un second appui est ignoré tant que le premier n'a pas répondu.
    const lock = lockFor(film.id);
    if (lock.busy) return;
    setRentingId(film.id);
    onRenting(film.id);
    const result = await rentFlow(
      {
        rent: () => state.rentFilm(film.id),
        // Même état serveur que le parcours du vidéoclub : la location est « sur place ».
        setMode: () => state.setViewingMode(film.id, 'sur_place'),
        // Réponse perdue : le compte relu dit si la location a été enregistrée quand même.
        landed: async () => {
          await useStore.getState().fetchMe();
          return useStore.getState().rentals.some((r) => r.filmId === film.id);
        },
      },
      lock,
    );
    if (result.status === 'busy') return;
    setRentingId((current) => (current === film.id ? null : current));
    // L'attente se retire avant tout : un refus montre son message, une réussite le panneau.
    onRenting(null);

    if (result.status === 'error') {
      // Le refus du serveur est montré tel quel. « Se reconnecter » n'est proposé que pour une
      // session expirée (401 : le magasin croit le visiteur connecté, le serveur non) — pas pour
      // un refus de stock ou de crédits, que se reconnecter ne changerait pas.
      const relogin = {
        label: 'Se reconnecter',
        onPress: () => {
          close();
          onRequestAuth(() => {
            void press();
          });
        },
      };
      onNotice({
        title: 'Location impossible',
        body: result.message,
        primary: { label: 'Fermer', onPress: close },
        ...(offersRelogin(result) ? { secondary: relogin } : {}),
      });
      return;
    }

    onRented(film.id);
  };

  // L'état est relu dans le magasin au moment de l'appui : après une connexion, cette fonction
  // est rappelée telle quelle, et ce qu'elle a vu au rendu (visiteur non connecté) ne vaut plus.
  const press = async () => {
    const state = useStore.getState();
    const nowCredits = state.isAuthenticated && state.authUser ? state.authUser.credits : state.localUser.credits;
    const now = rentAction({
      isAuthenticated: state.isAuthenticated,
      isRented: state.rentals.some((r) => r.filmId === film.id),
      isAvailable,
      playable,
      copiesLeft,
      credits: nowCredits,
      cost,
    });

    if (now === 'watch') {
      onWatch(film.id);
      return;
    }
    if (now === 'login') {
      onRequestAuth(() => {
        void press();
      });
      return;
    }
    if (now === 'insufficient') {
      say('Crédits insuffisants', `Ce film coûte ${creditsLabel(cost)}. Vous en avez ${nowCredits}.`);
      return;
    }
    if (now === 'unavailable') {
      say('Film indisponible', "Ce film n'est pas encore en rayon.");
      return;
    }
    if (now === 'unplayable') {
      say('Film indisponible', NO_PLAYABLE_VERSION);
      return;
    }
    if (now === 'out-of-stock') {
      say('Toutes les copies sont louées', 'Revenez un peu plus tard.');
      return;
    }

    // Louer dépense des crédits : la location attend une confirmation. Y compris juste après une
    // connexion demandée par « LOUER » — elle ne repart pas toute seule.
    if (lockFor(film.id).busy) return;
    const confirm = confirmRentText({ title: film.title, cost, credits: nowCredits });
    onConfirmOpen?.(film.id);
    onNotice({
      title: confirm.title,
      body: confirm.body,
      primary: {
        label: 'Louer',
        onPress: () => {
          close();
          void rentNow();
        },
      },
      secondary: { label: 'Annuler', onPress: close },
    });
  };

  return (
    <button
      type="button"
      className={`${styles.kBtn} ${styles.kLouer}`}
      aria-busy={renting}
      onClick={() => {
        void press();
      }}
    >
      <span className={styles.kBtnLabel}>{shown.text}</span>
      {shown.price && (
        <>
          {/* L'espace ne se voit pas (bouton en flex) mais sépare les mots pour un lecteur d'écran. */}
          {' '}
          <span className={styles.kPrice}>{shown.price}</span>
        </>
      )}
    </button>
  );
}
