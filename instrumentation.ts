import { LangfuseSpanProcessor, type ShouldExportSpan } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const shouldExportSpan: ShouldExportSpan = (span) => {
    // Only export AI SDK spans, skip Next.js internals
    return span.otelSpan.instrumentationScope.name !== 'next.js';
};

export const langfuseSpanProcessor = new LangfuseSpanProcessor({
    shouldExportSpan,
});

export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const tracerProvider = new NodeTracerProvider({
            spanProcessors: [langfuseSpanProcessor],
        });
        tracerProvider.register();

        const { startCleanupScheduler } = await import('./lib/cleanup');
        startCleanupScheduler();
        const { startRadarrPoller, recoverMediaPipeline } = await import('./lib/radarr-poller');
        startRadarrPoller();
        recoverMediaPipeline();
        const { startCastSessionChecker } = await import('./lib/cast-session-checker');
        startCastSessionChecker();
    }
}
