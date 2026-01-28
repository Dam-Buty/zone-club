<script lang="ts">
    let { data } = $props();
    let audioTrack = $state<'vf' | 'vo'>('vf');
    let showSubtitles = $state(true);

    function getVideoUrl() {
        return audioTrack === 'vf'
            ? data.rental.streaming_urls.vf
            : data.rental.streaming_urls.vo;
    }
</script>

<svelte:head>
    <title>{data.film.title} - Lecture - Zone Club</title>
</svelte:head>

<div class="player-page">
    <nav class="player-nav">
        <a href="/film/{data.film.tmdb_id}" class="back-link">← Retour à la fiche</a>
        <span class="title">{data.film.title}</span>
        <span class="time-remaining">{Math.floor(data.rental.time_remaining / 60)}h {data.rental.time_remaining % 60}min restantes</span>
    </nav>

    <div class="video-container">
        {#key audioTrack}
            <video controls autoplay class="video-player">
                {#if getVideoUrl()}
                    <source src={getVideoUrl()} type="video/mp4" />
                {/if}
                {#if showSubtitles && data.rental.streaming_urls.subtitles}
                    <track kind="subtitles" src={data.rental.streaming_urls.subtitles} srclang="fr" label="Français" default />
                {/if}
                Votre navigateur ne supporte pas la lecture vidéo.
            </video>
        {/key}
    </div>

    <div class="controls">
        <div class="control-group">
            <label>Audio :</label>
            <button class="btn" class:btn-primary={audioTrack === 'vf'} class:btn-secondary={audioTrack !== 'vf'} onclick={() => audioTrack = 'vf'} disabled={!data.rental.streaming_urls.vf}>VF</button>
            <button class="btn" class:btn-primary={audioTrack === 'vo'} class:btn-secondary={audioTrack !== 'vo'} onclick={() => audioTrack = 'vo'} disabled={!data.rental.streaming_urls.vo}>VO</button>
        </div>

        {#if data.rental.streaming_urls.subtitles}
            <div class="control-group">
                <label>Sous-titres :</label>
                <button class="btn" class:btn-primary={showSubtitles} class:btn-secondary={!showSubtitles} onclick={() => showSubtitles = !showSubtitles}>
                    {showSubtitles ? 'Activés' : 'Désactivés'}
                </button>
            </div>
        {/if}
    </div>
</div>

<style>
    .player-page { min-height: 100vh; background: #000; }
    .player-nav { display: flex; justify-content: space-between; align-items: center; padding: 1rem 2rem; background: var(--bg-secondary); }
    .back-link { color: var(--accent); }
    .title { font-weight: 600; }
    .time-remaining { color: var(--success); font-size: 0.9rem; }
    .video-container { width: 100%; max-width: 1200px; margin: 0 auto; }
    .video-player { width: 100%; aspect-ratio: 16/9; background: #000; }
    .controls { display: flex; justify-content: center; gap: 2rem; padding: 1rem; background: var(--bg-secondary); }
    .control-group { display: flex; align-items: center; gap: 0.5rem; }
    .control-group label { color: var(--text-secondary); }
    .btn { padding: 0.5rem 1rem; }
</style>
