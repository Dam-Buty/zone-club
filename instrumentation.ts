export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { startCleanupScheduler } = await import('./lib/cleanup');
        startCleanupScheduler();
        const { startRadarrPoller } = await import('./lib/radarr-poller');
        startRadarrPoller();
        const { recoverPendingTranscodes } = await import('./lib/transcoder');
        recoverPendingTranscodes();
    }
}
