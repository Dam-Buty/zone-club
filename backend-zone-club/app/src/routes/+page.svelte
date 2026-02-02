<script lang="ts">
    let { data } = $props();
</script>

<svelte:head>
    <title>Zone Club - Vidéoclub en ligne</title>
</svelte:head>

<div class="container">
    <section class="hero">
        <h1>Bienvenue au Zone Club</h1>
        <p>Votre vidéoclub en ligne. Parcourez les rayons, louez des films, partagez vos critiques.</p>

        {#if !data.user}
            <div class="hero-actions">
                <a href="/register" class="btn btn-primary">S'inscrire</a>
                <a href="/login" class="btn btn-secondary">Se connecter</a>
            </div>
        {:else}
            <a href="/rayons" class="btn btn-primary">Parcourir les rayons</a>
        {/if}
    </section>

    {#if data.genres.length > 0}
        <section class="genres-section">
            <h2>Les rayons</h2>
            <div class="genres-grid">
                {#each data.genres as genre}
                    <a href="/rayons/{genre.slug}" class="genre-card">
                        <span class="genre-name">{genre.name}</span>
                        <span class="genre-count">{genre.film_count} film{genre.film_count > 1 ? 's' : ''}</span>
                    </a>
                {/each}
            </div>
            <a href="/rayons" class="see-all">Voir tous les rayons</a>
        </section>
    {/if}

    {#if data.films.length > 0}
        <section class="films-section">
            <h2>Derniers ajouts</h2>
            <div class="films-grid">
                {#each data.films as film}
                    <a href="/film/{film.tmdb_id}" class="film-card">
                        {#if film.poster_url}
                            <img src={film.poster_url} alt={film.title} />
                        {:else}
                            <div class="no-poster">{film.title}</div>
                        {/if}
                        <div class="film-info">
                            <h3>{film.title}</h3>
                            <span class="year">{film.release_year || 'N/A'}</span>
                        </div>
                    </a>
                {/each}
            </div>
        </section>
    {/if}
</div>

<style>
    .hero {
        text-align: center;
        padding: 4rem 0;
    }

    .hero h1 {
        font-size: 3rem;
        margin-bottom: 1rem;
        color: var(--accent);
    }

    .hero p {
        font-size: 1.25rem;
        color: var(--text-secondary);
        margin-bottom: 2rem;
    }

    .hero-actions {
        display: flex;
        gap: 1rem;
        justify-content: center;
    }

    section {
        margin-bottom: 3rem;
    }

    h2 {
        font-size: 1.75rem;
        margin-bottom: 1.5rem;
    }

    .genres-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 1rem;
    }

    .genre-card {
        background: var(--bg-card);
        padding: 1.5rem;
        border-radius: var(--border-radius);
        text-align: center;
        transition: transform 0.2s;
    }

    .genre-card:hover {
        transform: translateY(-4px);
    }

    .genre-name {
        display: block;
        font-size: 1.1rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .genre-count {
        font-size: 0.9rem;
        color: var(--text-muted);
    }

    .see-all {
        display: inline-block;
        margin-top: 1rem;
    }

    .films-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 1.5rem;
    }

    .film-card {
        display: block;
    }

    .film-card img {
        width: 100%;
        aspect-ratio: 2/3;
        object-fit: cover;
        border-radius: var(--border-radius);
        transition: transform 0.2s;
    }

    .film-card:hover img {
        transform: scale(1.05);
    }

    .no-poster {
        width: 100%;
        aspect-ratio: 2/3;
        background: var(--bg-card);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 1rem;
        border-radius: var(--border-radius);
        color: var(--text-muted);
    }

    .film-info {
        padding: 0.75rem 0;
    }

    .film-info h3 {
        font-size: 0.95rem;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 0.25rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .year {
        font-size: 0.85rem;
        color: var(--text-muted);
    }
</style>
