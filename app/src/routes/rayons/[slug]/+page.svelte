<script lang="ts">
    let { data } = $props();
</script>

<svelte:head>
    <title>{data.genre.name} - Zone Club</title>
</svelte:head>

<div class="container">
    <nav class="breadcrumb">
        <a href="/rayons">Rayons</a> / <span>{data.genre.name}</span>
    </nav>

    <h1>{data.genre.name}</h1>

    {#if data.films.length === 0}
        <p class="empty">Aucun film dans ce rayon.</p>
    {:else}
        <div class="films-grid">
            {#each data.films as film}
                <a href="/film/{film.tmdb_id}" class="film-card" class:unavailable={film.rental_status.is_rented && !film.rental_status.rented_by_current_user}>
                    {#if film.poster_url}
                        <img src={film.poster_url} alt={film.title} />
                    {:else}
                        <div class="no-poster">{film.title}</div>
                    {/if}
                    {#if film.rental_status.is_rented && !film.rental_status.rented_by_current_user}
                        <div class="status-badge unavailable">Indisponible</div>
                    {:else if film.rental_status.rented_by_current_user}
                        <div class="status-badge rented">En cours</div>
                    {/if}
                    <div class="film-info">
                        <h3>{film.title}</h3>
                        <span class="year">{film.release_year || 'N/A'}</span>
                    </div>
                </a>
            {/each}
        </div>
    {/if}
</div>

<style>
    .breadcrumb { margin-bottom: 1rem; color: var(--text-muted); }
    .breadcrumb a { color: var(--accent); }
    h1 { margin-bottom: 2rem; }
    .empty { color: var(--text-muted); text-align: center; padding: 3rem; }
    .films-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1.5rem; }
    .film-card { display: block; position: relative; }
    .film-card.unavailable { opacity: 0.6; }
    .film-card img { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: var(--border-radius); transition: transform 0.2s; }
    .film-card:hover img { transform: scale(1.05); }
    .no-poster { width: 100%; aspect-ratio: 2/3; background: var(--bg-card); display: flex; align-items: center; justify-content: center; text-align: center; padding: 1rem; border-radius: var(--border-radius); color: var(--text-muted); }
    .status-badge { position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .status-badge.unavailable { background: var(--error); color: white; }
    .status-badge.rented { background: var(--success); color: white; }
    .film-info { padding: 0.75rem 0; }
    .film-info h3 { font-size: 0.95rem; font-weight: 500; color: var(--text-primary); margin-bottom: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .year { font-size: 0.85rem; color: var(--text-muted); }
</style>
