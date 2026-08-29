export interface GenUIRentData {
  name: 'rent';
  film: {
    id: number;
    title: string;
    poster_url: string | null;
    tmdb_id: number;
    cost: number;
  };
}

export interface GenUICriticData {
  name: 'critic';
  filmId: number;
  filmTitle: string;
  preWrittenReview: string;
}

export interface GenUIWatchData {
  name: 'watch';
  filmId: number;
  title: string;
}

export interface BackdropData {
  name: 'backdrop';
  url: string;
}

export interface CreditsData {
  name: 'credits';
  amount: number;
  newBalance: number;
  reason: string;
}

export interface GenUISignupData {
  name: 'signup';
}

export interface GenUISigninData {
  name: 'signin';
}

export interface SessionData {
  name: 'session';
  sessionId: number;
}

export type ChatAnnotation =
  | GenUIRentData
  | GenUICriticData
  | GenUIWatchData
  | BackdropData
  | CreditsData
  | GenUISignupData
  | GenUISigninData
  | SessionData;

/**
 * Sortie brute d'un outil du gérant, telle que le SDK la remonte dans `part.output`.
 * Chaque outil ne renseigne que ses propres champs ; `action` sert de discriminant côté rendu.
 * Voir `lib/chat-tools.ts` pour les schémas Zod côté serveur.
 */
export interface ChatToolOutput {
  action?: 'rent' | 'critic' | 'watch' | 'signup' | 'signin' | 'credits';
  film?: GenUIRentData['film'];
  filmId?: number;
  filmTitle?: string;
  preWrittenReview?: string;
  title?: string;
  /** backdrop */
  success?: boolean;
  url?: string;
}
