import { tool } from 'ai';
import { z } from 'zod';
import { fetchFullMovieData, getMovieBackdrops, getBackdropUrl } from './tmdb';
import { getFilmById, getFilmByTmdbId } from './films';
import { getUserActiveRentals } from './rentals';
import { addUserFact } from './user-facts';
import { db } from './db';

export function createChatTools(userId: number) {
  return {
    get_film: tool({
      description: 'Recupere les informations completes d\'un film depuis TMDB (synopsis, casting, realisateur, etc). Utilise quand tu veux parler en detail d\'un film specifique.',
      inputSchema: z.object({
        tmdb_id: z.number().describe('L\'ID TMDB du film'),
      }),
      execute: async ({ tmdb_id }) => {
        const film = getFilmByTmdbId(tmdb_id);
        if (film) {
          return {
            id: film.id,
            tmdb_id: film.tmdb_id,
            title: film.title,
            title_original: film.title_original,
            synopsis: film.synopsis,
            release_year: film.release_year,
            genres: film.genres,
            directors: film.directors,
            actors: film.actors,
            runtime: film.runtime,
            aisle: film.aisle,
            is_available: film.is_available,
            is_nouveaute: film.is_nouveaute,
          };
        }
        const tmdbData = await fetchFullMovieData(tmdb_id);
        return tmdbData;
      },
    }),

    backdrop: tool({
      description: 'Affiche un backdrop cinematique d\'un film en arriere-plan du chat. Utilise quand tu parles d\'un film specifique pour creer l\'ambiance.',
      inputSchema: z.object({
        tmdb_id: z.number().describe('L\'ID TMDB du film dont afficher le backdrop'),
      }),
      execute: async ({ tmdb_id }) => {
        const backdrops = await getMovieBackdrops(tmdb_id);
        if (backdrops.length === 0) {
          return { success: false, url: null };
        }
        const pick = backdrops[Math.floor(Math.random() * backdrops.length)];
        const url = getBackdropUrl(pick.file_path, 'w1280');
        return { success: true, url };
      },
    }),

    rent: tool({
      description: 'Propose la location d\'un film au client. Affiche une carte interactive avec le poster, le titre et le prix. Utilise quand le client veut louer un film ou que tu recommandes un film a louer.',
      inputSchema: z.object({
        film_id: z.number().describe('L\'ID interne du film (pas tmdb_id)'),
      }),
      execute: async ({ film_id }) => {
        const film = getFilmById(film_id);
        if (!film) return { error: 'Film non trouve', action: 'rent' as const };

        const cost = film.is_nouveaute ? 2 : 1;
        return {
          action: 'rent' as const,
          film: {
            id: film.id,
            title: film.title,
            poster_url: film.poster_url,
            tmdb_id: film.tmdb_id,
            cost,
          },
        };
      },
    }),

    critic: tool({
      description: 'Propose au client d\'ecrire une critique pour un film. Affiche un formulaire pre-rempli avec une critique ecrite par toi. Utilise apres que le client a vu un film et veut donner son avis.',
      inputSchema: z.object({
        film_id: z.number().describe('L\'ID interne du film'),
        pre_written_review: z.string().describe('Une critique ecrite par toi dans le style du client, minimum 500 caracteres. Le client pourra la modifier.'),
      }),
      execute: async ({ film_id, pre_written_review }) => {
        const film = getFilmById(film_id);
        if (!film) return { error: 'Film non trouve', action: 'critic' as const };

        return {
          action: 'critic' as const,
          filmId: film_id,
          filmTitle: film.title,
          preWrittenReview: pre_written_review,
        };
      },
    }),

    watch: tool({
      description: 'Affiche un bouton pour lancer la lecture d\'un film loue. Utilise quand le client a une location active et veut regarder son film.',
      inputSchema: z.object({
        film_id: z.number().describe('L\'ID interne du film'),
      }),
      execute: async ({ film_id }) => {
        const film = getFilmById(film_id);
        if (!film) return { error: 'Film non trouve', action: 'watch' as const };

        const activeRentals = getUserActiveRentals(userId);
        const hasRental = activeRentals.some(r => r.film_id === film_id);
        if (!hasRental) return { error: 'Pas de location active', action: 'watch' as const };

        return {
          action: 'watch' as const,
          filmId: film_id,
          title: film.title,
        };
      },
    }),

    add_credits: tool({
      description: 'Ajoute des credits au compte du client. Utilise pour le minigame de credits: si le client a 0-1 credits, donne 3 gratuits. Si 2-3 credits et qu\'il raconte une anecdote cinema plausible, donne 2. Si 4+ credits et anecdote obscure verifiable, donne 1.',
      inputSchema: z.object({
        amount: z.number().min(1).max(3).describe('Nombre de credits a ajouter (1-3)'),
        reason: z.string().describe('Raison courte pour les credits'),
      }),
      execute: async ({ amount, reason }) => {
        db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, userId);
        const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
        return {
          action: 'credits' as const,
          amount,
          newBalance: user.credits,
          reason,
        };
      },
    }),

    remember_fact: tool({
      description: 'Memorise un fait important sur le client pour les prochaines conversations. Utilise quand le client revele quelque chose d\'interessant: ses genres preferes, un film qu\'il a adore ou deteste, une anecdote personnelle liee au cinema, etc.',
      inputSchema: z.object({
        fact: z.string().describe('Fait concis en francais sur le client (ex: "adore les films de Kubrick", "a peur des films d\'horreur")'),
      }),
      execute: async ({ fact }) => {
        addUserFact(userId, fact);
        return { success: true };
      },
    }),
  };
}
