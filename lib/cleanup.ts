import { cleanupExpiredRentals } from './rentals';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let started = false;

async function runCleanup() {
    try {
        const count = await cleanupExpiredRentals();
        if (count > 0) {
            console.log(`[cleanup] Nettoyé ${count} location(s) expirée(s)`);
        }
    } catch (error) {
        console.error('[cleanup] Erreur:', error);
    }
}

export function startCleanupScheduler(): void {
    if (started) return;
    started = true;
    console.log('[cleanup] Scheduler démarré (intervalle: 5min)');
    runCleanup();
    setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}
