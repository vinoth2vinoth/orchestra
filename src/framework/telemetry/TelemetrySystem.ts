import { globalEventStore } from '../core/EventStore.ts';
import { TelemetryPayload } from '../core/types.ts';

/**
 * TelemetrySystem provides a strictly typed interface for emitting system metrics and logs.
 */
export class TelemetrySystem {
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
}
