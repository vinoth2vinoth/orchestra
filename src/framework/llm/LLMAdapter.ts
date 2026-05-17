import { LanguageModelUsage } from 'ai';

/**
 * Unified interface for LLM responses within the framework.
 * This avoids 'as any' when accessing usage, cost, or metadata.
 */
export interface LLMResponse<T = string> {
    text: string;
    object: T | null;
    toolCalls?: any[];
    toolResults?: any[];
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    cost: number;
    finishReason: string;
    modelId: string;
}

/**
 * Adapter to safely extract data from Vercel AI SDK responses.
 */
export class LLMAdapter {
    /**
     * Normalizes usage metrics across different provider SDK versions.
     */
    public static normalizeUsage(usage: any): { promptTokens: number; completionTokens: number; totalTokens: number } {
        return {
            promptTokens: usage?.promptTokens ?? usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completionTokens ?? usage?.completion_tokens ?? 0,
            totalTokens: usage?.totalTokens ?? usage?.total_tokens ?? 0
        };
    }

    /**
     * Safely extracts the model ID from a LanguageModel instance.
     */
    public static getModelId(model: any, fallbackName?: string): string {
        return model?.modelId ?? model?.modelName ?? fallbackName ?? 'unknown-model';
    }

    /**
     * Creates a consistent response object.
     */
    public static createResponse<T = any>(data: Partial<LLMResponse<T>>): LLMResponse<T> {
        return {
            text: data.text ?? '',
            object: data.object ?? null,
            toolCalls: data.toolCalls ?? [],
            toolResults: data.toolResults ?? [],
            usage: this.normalizeUsage(data.usage),
            cost: data.cost ?? 0,
            finishReason: data.finishReason ?? 'stop',
            modelId: data.modelId ?? 'unknown'
        };
    }
}
