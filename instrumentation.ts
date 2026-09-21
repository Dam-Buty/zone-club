import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
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
        // AI SDK 7 a sorti la collecte OpenTelemetry du paquet `ai` : sans cet
        // enregistrement, plus aucun span n'est émis et Langfuse ne reçoit rien,
        // silencieusement. À l'inverse la télémétrie devient opt-OUT une fois
        // l'intégration enregistrée — d'où le retrait du `isEnabled: true` de
        // l'appel streamText, désormais redondant.
        registerTelemetry(new OpenTelemetry());

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
