<script lang="ts">
    let { data } = $props();
</script>

<svelte:head>
    <title>Les rayons - Zone Club</title>
</svelte:head>

<div class="container">
    <h1>Les rayons</h1>

    {#if data.genres.length === 0}
        <p class="empty">Aucun rayon disponible pour le moment.</p>
    {:else}
        <div class="genres-grid">
            {#each data.genres as genre}
                <a href="/rayons/{genre.slug}" class="genre-card">
                    <span class="genre-name">{genre.name}</span>
                    <span class="genre-count">{genre.film_count} film{genre.film_count > 1 ? 's' : ''}</span>
                </a>
            {/each}
        </div>
    {/if}
</div>

<style>
    h1 { margin-bottom: 2rem; }
    .empty { color: var(--text-muted); text-align: center; padding: 3rem; }
    .genres-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1.5rem; }
    .genre-card { background: var(--bg-card); padding: 2rem; border-radius: var(--border-radius); text-align: center; transition: transform 0.2s, box-shadow 0.2s; }
    .genre-card:hover { transform: translateY(-4px); box-shadow: 0 8px 30px rgba(0,0,0,0.3); }
    .genre-name { display: block; font-size: 1.25rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem; }
    .genre-count { font-size: 0.9rem; color: var(--text-muted); }
</style>
