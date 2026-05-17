import { globalEventStore } from '../core/EventStore.ts';
import { TelemetryPayload } from '../core/types.ts';
import { globalOTelExporter } from './OTelExporter.ts';
import { Span, SpanStatusCode } from '@opentelemetry/api';

/**
 * TelemetrySystem provides a strictly typed interface for emitting system metrics and logs.
 */
export class TelemetrySystem {
    private static activeSpans: Map<string, { start: number; otelSpan?: Span }> = new Map();
    private static tracer = globalOTelExporter.getTracer();

    /**
     * Starts a uniquely identified span. Returns the start timestamp.
     */
    public static startSpan(spanId: string, parentSpan?: Span): number {
        const start = Date.now();
        
        let otelSpan: Span | undefined;
        try {
            otelSpan = this.tracer.startSpan(spanId, undefined, parentSpan ? (parentSpan as any).context() : undefined);
        } catch (err) {
            // Silently fail if OTel is not ready
        }

        this.activeSpans.set(spanId, { start, otelSpan });
        return start;
    }

    /**
     * Ends a span and returns the duration in ms.
     */
    public static endSpan(spanId: string, error?: Error): number {
        const record = this.activeSpans.get(spanId);
        if (record === undefined) return 0;
        
        const duration = Date.now() - record.start;
        
        if (record.otelSpan) {
            if (error) {
                record.otelSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                record.otelSpan.recordException(error);
            } else {
                record.otelSpan.setStatus({ code: SpanStatusCode.OK });
            }
            record.otelSpan.end();
        }

        this.activeSpans.delete(spanId);
        return duration;
    }

    /**
     * Emits a telemetry event to the global event store.
     */
    public static emit(
        sourceAgentId: string,
        threadId: string,
        payload: TelemetryPayload
    ) {
        globalEventStore.append({
            type: 'TELEMETRY_EMIT',
            sourceAgentId,
            threadId,
            payload
        });
    }

    /**
     * Specialized helper for LLM usage telemetry.
     */
    public static emitLLMUsage(
        sourceAgentId: string,
        threadId: string,
        modelId: string,
        usage: { promptTokens: number; completionTokens: number; totalTokens: number },
        cost: number
    ) {
        this.emit(sourceAgentId, threadId, {
            action: 'LLM_USAGE_RECORDED',
            category: 'LLM_USAGE',
            metrics: {
                prompt_tokens: usage.promptTokens,
                completion_tokens: usage.completionTokens,
                total_tokens: usage.totalTokens,
                cost_estimate: cost
            },
            metadata: { modelId }
        });
    }

    /**
     * Specialized helper for non-LLM service usage telemetry (Maps, external APIs).
     */
    public static emitServiceCost(
        sourceAgentId: string,
        threadId: string,
        serviceName: string,
        cost: number
    ) {
        this.emit(sourceAgentId, threadId, {
            action: 'SERVICE_COST_RECORDED',
            category: 'EXTERNAL_COST',
            metrics: {
                cost_estimate: cost
            },
            metadata: { serviceName }
        });
    }

    /**
     * Returns the OTel Span object for a given spanId.
     */
    public static getActiveSpan(spanId: string): Span | undefined {
        return this.activeSpans.get(spanId)?.otelSpan;
    }

    /**
     * Resets the active spans map. Used for clean tests.
     */
    public static reset(): void {
        this.activeSpans.clear();
    }

    /**
     * Returns the number of currently active spans.
     */
    public static getActiveSpanCount(): number {
        return this.activeSpans.size;
    }
}
