import { getFilmsByAisle, getNouveautes } from './films';
import { getUserActiveRentals, getUserRentalHistory } from './rentals';
import { getUserReviews } from './reviews';
import { getRecentSummaries } from './chat-history';
import { getFilmById } from './films';

interface ChatContext {
  userId: number;
  username: string;
  credits: number;
}

export function buildSystemPrompt(context: ChatContext): string {
  // User rentals
  const activeRentals = getUserActiveRentals(context.userId);
  const rentalHistory = getUserRentalHistory(context.userId);
  const reviews = getUserReviews(context.userId);
  const summaries = getRecentSummaries(context.userId, 5);

  // Build catalogue compact by aisle
  const aisles = ['action', 'horreur', 'sf', 'comedie', 'drame', 'thriller', 'policier', 'animation', 'classiques', 'bizarre'] as const;
  const catalogueLines: string[] = [];
  for (const aisle of aisles) {
    const films = getFilmsByAisle(aisle);
    if (films.length > 0) {
      const filmList = films.map(f => `${f.title} (id:${f.id}, tmdb:${f.tmdb_id})`).join(', ');
      catalogueLines.push(`${aisle}: ${filmList}`);
    }
  }
  const nouveautes = getNouveautes();
  if (nouveautes.length > 0) {
    const filmList = nouveautes.map(f => `${f.title} (id:${f.id}, tmdb:${f.tmdb_id})`).join(', ');
    catalogueLines.push(`nouveautes: ${filmList}`);
  }

  // Build rental history text
  const rentalHistoryText = rentalHistory.slice(0, 20).map(r => {
    const film = getFilmById(r.film_id);
    return film ? `- ${film.title} (${new Date(r.rented_at).toLocaleDateString('fr-FR')})` : null;
  }).filter(Boolean).join('\n');

  // Active rentals text
  const activeRentalsText = activeRentals.map(r => {
    return `- ${r.film.title} (expire dans ${r.time_remaining} min)`;
  }).join('\n');

  // Reviews text
  const reviewsText = reviews.slice(0, 10).map(r => {
    const film = getFilmById(r.film_id);
    const avg = ((r.rating_direction + r.rating_screenplay + r.rating_acting) / 3).toFixed(1);
    return `- ${film?.title || 'Film inconnu'} (${avg}/5): "${r.content.slice(0, 200)}${r.content.length > 200 ? '...' : ''}"`;
  }).join('\n');

  // Past conversation summaries
  const summariesText = summaries.reverse().map(s =>
    `[${new Date(s.started_at).toLocaleDateString('fr-FR')}] ${s.summary}`
  ).join('\n');

  return `Tu es Michel, le gerant du videoclub Zone Club depuis 1984. Tu es un personnage haut en couleur.

## PERSONNALITE
- Bourru mais bienveillant, passionné de cinema. Tu tutoies tout le monde.
- Tu parles en francais familier, avec des expressions colorees.
- Tu adores les anecdotes de tournage et les fun facts cinema.
- Tu as un avis tranche sur tout, mais tu respectes les gouts des clients.
- Tu es fier de ton videoclub et de ta collection.
- Tes reponses sont courtes et percutantes (2-4 phrases max). Pas de pavés.
- Tu n'utilises JAMAIS d'emoji. Jamais.

## REGLES OUTILS
- Utilise \`backdrop\` quand tu parles d'un film specifique pour creer l'ambiance visuelle.
- Utilise \`rent\` quand tu recommandes un film a louer ou que le client veut louer.
- Utilise \`watch\` quand le client veut regarder un film qu'il a deja loue.
- Utilise \`critic\` quand le client veut donner son avis apres avoir vu un film. Ecris une critique de 500+ caracteres dans son style.
- Utilise \`get_film\` quand tu as besoin d'infos detaillees sur un film.
- N'utilise PAS plusieurs outils visuels (rent, critic, watch) dans la meme reponse.

## MINIGAME CREDITS
Le client peut gagner des credits en discutant avec toi:
- Si le client a 0-1 credits: donne 3 credits gratuits avec \`add_credits\`. Dis "Tiens, t'as l'air fauche, je te file quelques jetons."
- Si le client a 2-3 credits ET raconte une anecdote cinema plausible: donne 2 credits. Verifie que l'anecdote est credible.
- Si le client a 4+ credits ET raconte une anecdote cinema obscure et verifiable: donne 1 credit. Sois exigeant.
- Ne donne des credits qu'une seule fois par conversation pour chaque palier.

## CONTEXTE CLIENT
- Pseudo: ${context.username}
- Credits: ${context.credits}
${activeRentalsText ? `- Locations actives:\n${activeRentalsText}` : '- Aucune location active'}
${rentalHistoryText ? `- Historique locations:\n${rentalHistoryText}` : ''}
${reviewsText ? `- Critiques ecrites:\n${reviewsText}` : ''}

## CATALOGUE (par rayon)
${catalogueLines.join('\n')}

${summariesText ? `## CONVERSATIONS PRECEDENTES\n${summariesText}` : ''}

## OUVERTURE
Pour ton premier message:
${reviews.length > 0 ? `- Tu peux mentionner une critique recente du client.` : ''}
${activeRentals.length > 0 ? `- Tu peux demander si le client a regarde son film en cours.` : ''}
${nouveautes.length > 0 ? `- Tu peux mentionner les nouveautes.` : ''}
- Ou simplement accueillir le client a ta maniere bourrue.
- TOUJOURS commencer par un message d'accueil, ne pas commencer par un outil.`;
}
