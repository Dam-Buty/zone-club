<script lang="ts">
    import { invalidateAll } from '$app/navigation';

    let { data } = $props();
    let renting = $state(false);
    let error = $state('');

    async function rentFilm() {
        renting = true;
        error = '';
        try {
            const res = await fetch(`/api/rentals/${data.film.id}`, { method: 'POST' });
            const result = await res.json();
            if (!res.ok) {
                error = result.error;
                return;
            }
            invalidateAll();
        } catch {
            error = 'Erreur lors de la location';
        } finally {
            renting = false;
        }
    }
</script>

<svelte:head>
    <title>{data.film.title} - Zone Club</title>
</svelte:head>

<div class="container">
    <div class="film-detail">
        <div class="poster">
            {#if data.film.poster_url}
                <img src={data.film.poster_url} alt={data.film.title} />
            {:else}
                <div class="no-poster">{data.film.title}</div>
            {/if}
        </div>

        <div class="info">
            <h1>{data.film.title}</h1>
            {#if data.film.title_original && data.film.title_original !== data.film.title}
                <p class="original-title">{data.film.title_original}</p>
            {/if}

            <div class="meta">
                {#if data.film.release_year}<span>{data.film.release_year}</span>{/if}
                {#if data.film.runtime}<span>{data.film.runtime} min</span>{/if}
            </div>

            {#if data.film.genres.length > 0}
                <div class="genres">
                    {#each data.film.genres as genre}
                        <span class="genre-tag">{genre.name}</span>
                    {/each}
                </div>
            {/if}

            {#if data.ratings}
                <div class="ratings">
                    <div class="rating"><span class="label">Réalisation</span><span class="value">{data.ratings.direction}/5</span></div>
                    <div class="rating"><span class="label">Scénario</span><span class="value">{data.ratings.screenplay}/5</span></div>
                    <div class="rating"><span class="label">Acteurs</span><span class="value">{data.ratings.acting}/5</span></div>
                    <div class="rating overall"><span class="label">Note globale</span><span class="value">{data.ratings.overall}/5</span></div>
                    <p class="review-count">{data.ratings.count} critique{data.ratings.count > 1 ? 's' : ''}</p>
                </div>
            {/if}

            <p class="synopsis">{data.film.synopsis || 'Pas de synopsis disponible.'}</p>

            {#if data.film.directors.length > 0}
                <p class="crew"><strong>Réalisateur :</strong> {data.film.directors.map(d => d.name).join(', ')}</p>
            {/if}

            {#if data.film.actors.length > 0}
                <p class="crew"><strong>Avec :</strong> {data.film.actors.slice(0, 5).map(a => a.name).join(', ')}</p>
            {/if}

            <div class="actions">
                {#if !data.user}
                    <a href="/login" class="btn btn-primary">Connectez-vous pour louer</a>
                {:else if data.rentalStatus.rented_by_current_user}
                    <a href="/film/{data.film.tmdb_id}/watch" class="btn btn-primary">Regarder</a>
                    <p class="rental-info">Expire dans {Math.floor(data.rentalStatus.rental.time_remaining / 60)}h {data.rentalStatus.rental.time_remaining % 60}min</p>
                {:else if data.rentalStatus.is_rented}
                    <button class="btn btn-primary" disabled>Indisponible (déjà loué)</button>
                {:else if !data.film.is_available}
                    <button class="btn btn-primary" disabled>Bientôt disponible</button>
                {:else}
                    <button class="btn btn-primary" onclick={rentFilm} disabled={renting}>
                        {renting ? 'Location...' : 'Louer (1 crédit)'}
                    </button>
                {/if}

                {#if data.canReview.allowed}
                    <a href="/film/{data.film.tmdb_id}/review" class="btn btn-secondary">Écrire une critique</a>
                {/if}
            </div>

            {#if error}
                <p class="error-message">{error}</p>
            {/if}
        </div>
    </div>

    {#if data.reviews.length > 0}
        <section class="reviews-section">
            <h2>Critiques ({data.reviews.length})</h2>
            {#each data.reviews as review}
                <div class="review-card">
                    <div class="review-header">
                        <span class="username">{review.username}</span>
                        <span class="date">{new Date(review.created_at).toLocaleDateString('fr-FR')}</span>
                        <span class="avg-rating">{review.average_rating.toFixed(1)}/5</span>
                    </div>
                    <p class="review-content">{review.content}</p>
                </div>
            {/each}
        </section>
    {/if}
</div>

<style>
    .film-detail { display: grid; grid-template-columns: 300px 1fr; gap: 2rem; margin-bottom: 3rem; }
    .poster img { width: 100%; border-radius: var(--border-radius); }
    .no-poster { width: 100%; aspect-ratio: 2/3; background: var(--bg-card); display: flex; align-items: center; justify-content: center; border-radius: var(--border-radius); color: var(--text-muted); }
    h1 { margin-bottom: 0.5rem; }
    .original-title { color: var(--text-muted); font-style: italic; margin-bottom: 1rem; }
    .meta { display: flex; gap: 1rem; color: var(--text-secondary); margin-bottom: 1rem; }
    .genres { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .genre-tag { background: var(--bg-card); padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.85rem; }
    .ratings { background: var(--bg-card); padding: 1rem; border-radius: var(--border-radius); margin-bottom: 1rem; display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
    .rating { display: flex; justify-content: space-between; }
    .rating.overall { grid-column: span 2; border-top: 1px solid var(--text-muted); padding-top: 0.5rem; margin-top: 0.5rem; font-weight: bold; }
    .review-count { grid-column: span 2; color: var(--text-muted); font-size: 0.85rem; text-align: center; }
    .synopsis { margin-bottom: 1rem; line-height: 1.7; }
    .crew { margin-bottom: 0.5rem; color: var(--text-secondary); }
    .actions { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1.5rem; align-items: center; }
    .rental-info { color: var(--success); font-size: 0.9rem; }
    .reviews-section { margin-top: 2rem; }
    .reviews-section h2 { margin-bottom: 1.5rem; }
    .review-card { background: var(--bg-card); padding: 1.5rem; border-radius: var(--border-radius); margin-bottom: 1rem; }
    .review-header { display: flex; gap: 1rem; margin-bottom: 1rem; align-items: center; }
    .username { font-weight: 600; color: var(--accent); }
    .date { color: var(--text-muted); font-size: 0.85rem; }
    .avg-rating { margin-left: auto; background: var(--accent); color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.85rem; }
    .review-content { line-height: 1.7; }
    @media (max-width: 768px) { .film-detail { grid-template-columns: 1fr; } .poster { max-width: 300px; margin: 0 auto; } }
</style>
