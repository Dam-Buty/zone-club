<script lang="ts">
    import { goto } from '$app/navigation';

    let { data } = $props();
    let content = $state('');
    let ratingDirection = $state(3);
    let ratingScreenplay = $state(3);
    let ratingActing = $state(3);
    let error = $state('');
    let submitting = $state(false);

    async function handleSubmit() {
        if (content.length < 500) {
            error = `Votre critique doit faire au moins 500 caractères (actuellement ${content.length})`;
            return;
        }
        submitting = true;
        error = '';
        try {
            const res = await fetch(`/api/reviews/${data.film.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    rating_direction: ratingDirection,
                    rating_screenplay: ratingScreenplay,
                    rating_acting: ratingActing
                })
            });
            const result = await res.json();
            if (!res.ok) {
                error = result.error;
                return;
            }
            goto(`/film/${data.film.tmdb_id}`);
        } catch {
            error = 'Erreur lors de l\'envoi';
        } finally {
            submitting = false;
        }
    }
</script>

<svelte:head>
    <title>Critiquer {data.film.title} - Zone Club</title>
</svelte:head>

<div class="container">
    <nav class="breadcrumb">
        <a href="/film/{data.film.tmdb_id}">{data.film.title}</a> / Critique
    </nav>

    <h1>Écrire une critique</h1>
    <p class="subtitle">Partagez votre avis sur <strong>{data.film.title}</strong> et gagnez 1 crédit !</p>

    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <div class="ratings-section">
            <h3>Notes</h3>
            <div class="rating-row">
                <label>Réalisation</label>
                <div class="stars">
                    {#each [1,2,3,4,5] as n}
                        <button type="button" class="star" class:active={ratingDirection >= n} onclick={() => ratingDirection = n}>★</button>
                    {/each}
                </div>
            </div>
            <div class="rating-row">
                <label>Scénario</label>
                <div class="stars">
                    {#each [1,2,3,4,5] as n}
                        <button type="button" class="star" class:active={ratingScreenplay >= n} onclick={() => ratingScreenplay = n}>★</button>
                    {/each}
                </div>
            </div>
            <div class="rating-row">
                <label>Jeu d'acteur</label>
                <div class="stars">
                    {#each [1,2,3,4,5] as n}
                        <button type="button" class="star" class:active={ratingActing >= n} onclick={() => ratingActing = n}>★</button>
                    {/each}
                </div>
            </div>
        </div>

        <div class="content-section">
            <label for="content">Votre critique (min. 500 caractères)</label>
            <textarea id="content" bind:value={content} rows="10" placeholder="Partagez votre avis détaillé sur ce film..."></textarea>
            <p class="char-count" class:warning={content.length < 500}>{content.length}/500 caractères minimum</p>
        </div>

        {#if error}
            <p class="error-message">{error}</p>
        {/if}

        <button type="submit" class="btn btn-primary" disabled={submitting || content.length < 500}>
            {submitting ? 'Envoi...' : 'Publier ma critique (+1 crédit)'}
        </button>
    </form>
</div>

<style>
    .breadcrumb { margin-bottom: 1rem; color: var(--text-muted); }
    .breadcrumb a { color: var(--accent); }
    h1 { margin-bottom: 0.5rem; }
    .subtitle { color: var(--text-secondary); margin-bottom: 2rem; }
    .ratings-section { background: var(--bg-card); padding: 1.5rem; border-radius: var(--border-radius); margin-bottom: 1.5rem; }
    .ratings-section h3 { margin-bottom: 1rem; }
    .rating-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .stars { display: flex; gap: 0.25rem; }
    .star { background: none; border: none; font-size: 1.5rem; color: var(--text-muted); cursor: pointer; padding: 0; }
    .star.active { color: var(--warning); }
    .star:hover { color: var(--warning); }
    .content-section { margin-bottom: 1.5rem; }
    .content-section label { display: block; margin-bottom: 0.5rem; color: var(--text-secondary); }
    textarea { width: 100%; padding: 1rem; background: var(--bg-secondary); border: 1px solid var(--text-muted); border-radius: var(--border-radius); color: var(--text-primary); font-size: 1rem; resize: vertical; }
    textarea:focus { outline: none; border-color: var(--accent); }
    .char-count { margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-muted); }
    .char-count.warning { color: var(--warning); }
</style>
