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
  | SessionData;
