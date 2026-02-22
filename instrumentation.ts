import { registerOTel } from '@vercel/otel';
import { LangfuseExporter } from 'langfuse-vercel';

export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        registerOTel({
            serviceName: 'zone-club',
            traceExporter: new LangfuseExporter(),
        });

        const { startCleanupScheduler } = await import('./lib/cleanup');
        startCleanupScheduler();
        const { startRadarrPoller } = await import('./lib/radarr-poller');
        startRadarrPoller();
        const { recoverPendingTranscodes } = await import('./lib/transcoder');
        recoverPendingTranscodes();
    }
}
