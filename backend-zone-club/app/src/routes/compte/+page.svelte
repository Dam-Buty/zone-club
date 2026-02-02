<script lang="ts">
    let { data } = $props();
</script>

<svelte:head>
    <title>Mon compte - Zone Club</title>
</svelte:head>

<div class="container">
    <h1>Mon compte</h1>

    <div class="stats">
        <div class="stat-card">
            <span class="stat-value">{data.user?.credits || 0}</span>
            <span class="stat-label">Crédits</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">{data.rentalHistory.length}</span>
            <span class="stat-label">Films loués</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">{data.reviews.length}</span>
            <span class="stat-label">Critiques</span>
        </div>
    </div>

    {#if data.activeRentals.length > 0}
        <section>
            <h2>Locations en cours</h2>
            <div class="rentals-grid">
                {#each data.activeRentals as rental}
                    <div class="rental-card">
                        {#if rental.film.poster_url}
                            <img src={rental.film.poster_url} alt={rental.film.title} />
                        {/if}
                        <div class="rental-info">
                            <h3>{rental.film.title}</h3>
                            <p class="time-remaining">{Math.floor(rental.time_remaining / 60)}h {rental.time_remaining % 60}min restantes</p>
                            <a href="/film/{rental.film.tmdb_id}/watch" class="btn btn-primary">Regarder</a>
                        </div>
                    </div>
                {/each}
            </div>
        </section>
    {/if}

    {#if data.reviews.length > 0}
        <section>
            <h2>Mes critiques</h2>
            <div class="reviews-list">
                {#each data.reviews as review}
                    <div class="review-item">
                        <span class="review-film">Film #{review.film_id}</span>
                        <span class="review-rating">{review.average_rating.toFixed(1)}/5</span>
                        <span class="review-date">{new Date(review.created_at).toLocaleDateString('fr-FR')}</span>
                    </div>
                {/each}
            </div>
        </section>
    {/if}
</div>

<style>
    h1 { margin-bottom: 2rem; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 3rem; }
    .stat-card { background: var(--bg-card); padding: 1.5rem; border-radius: var(--border-radius); text-align: center; }
    .stat-value { display: block; font-size: 2.5rem; font-weight: bold; color: var(--accent); }
    .stat-label { color: var(--text-muted); }
    section { margin-bottom: 3rem; }
    h2 { margin-bottom: 1.5rem; }
    .rentals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
    .rental-card { background: var(--bg-card); border-radius: var(--border-radius); overflow: hidden; display: flex; }
    .rental-card img { width: 100px; height: 150px; object-fit: cover; }
    .rental-info { padding: 1rem; display: flex; flex-direction: column; justify-content: center; }
    .rental-info h3 { margin-bottom: 0.5rem; }
    .time-remaining { color: var(--success); font-size: 0.9rem; margin-bottom: 1rem; }
    .reviews-list { background: var(--bg-card); border-radius: var(--border-radius); overflow: hidden; }
    .review-item { display: flex; justify-content: space-between; padding: 1rem; border-bottom: 1px solid var(--bg-secondary); }
    .review-item:last-child { border-bottom: none; }
    .review-film { font-weight: 500; }
    .review-rating { color: var(--warning); }
    .review-date { color: var(--text-muted); }
</style>
