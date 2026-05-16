export interface ModelSpec {
    id: string;
    provider: 'openai' | 'anthropic' | 'gemini' | 'deepseek';
    contextWindow: number;
    maxOutputTokens: number;
    costPer1mInput: number; // in USD
    costPer1mOutput: number; // in USD
    capabilities: ('tools' | 'vision' | 'search' | 'reasoning')[];
    description: string;
}

export const ModelKnowledgeBase: Record<string, ModelSpec> = {
    // Anthropic
    'claude-3-7-sonnet-latest': {
        id: 'claude-3-7-sonnet-latest',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 8192, // extended beta available
        costPer1mInput: 3.00,
        costPer1mOutput: 15.00,
        capabilities: ['tools', 'vision'],
        description: 'Latest Sonnet, superior coding and logic'
    },
    'claude-3-5-sonnet-latest': {
        id: 'claude-3-5-sonnet-latest',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        costPer1mInput: 3.00,
        costPer1mOutput: 15.00,
        capabilities: ['tools', 'vision'],
        description: 'Excellent balance of intelligence and speed'
    },
    'claude-3-5-haiku-latest': {
        id: 'claude-3-5-haiku-latest',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        costPer1mInput: 1.00,
        costPer1mOutput: 5.00,
        capabilities: ['tools'],
        description: 'Fastest and most cost-effective'
    },
    'claude-3-opus-latest': {
        id: 'claude-3-opus-latest',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        costPer1mInput: 15.00,
        costPer1mOutput: 75.00,
        capabilities: ['tools', 'vision'],
        description: 'Highly complex reasoning (expensive)'
    },

    // OpenAI
    'gpt-4o': {
        id: 'gpt-4o',
        provider: 'openai',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        costPer1mInput: 2.50,
        costPer1mOutput: 10.00,
        capabilities: ['tools', 'vision', 'reasoning'],
        description: 'Multimodal flagship model'
    },
    'gpt-4o-mini': {
        id: 'gpt-4o-mini',
        provider: 'openai',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        costPer1mInput: 0.15,
        costPer1mOutput: 0.60,
        capabilities: ['tools', 'vision'],
        description: 'Cheap, fast, reliable for small tasks'
    },
    'o1': {
        id: 'o1',
        provider: 'openai',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        costPer1mInput: 15.00,
        costPer1mOutput: 60.00,
        capabilities: ['tools', 'reasoning'],
        description: 'Complex reasoning step-by-step logic'
    },
    'o3-mini': {
        id: 'o3-mini',
        provider: 'openai',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        costPer1mInput: 1.10,
        costPer1mOutput: 4.40,
        capabilities: ['tools', 'reasoning'],
        description: 'Fast reasoning model'
    },

    // Gemini
    'gemini-2.5-flash': {
        id: 'gemini-2.5-flash',
        provider: 'gemini',
        contextWindow: 1000000,
        maxOutputTokens: 8192, // Varies based on type
        costPer1mInput: 0.075,
        costPer1mOutput: 0.30,
        capabilities: ['tools', 'vision', 'search'],
        description: 'Fast multi-modal with massive context'
    },
    'gemini-2.5-pro': {
        id: 'gemini-2.5-pro',
        provider: 'gemini',
        contextWindow: 2000000,
        maxOutputTokens: 8192,
        costPer1mInput: 1.25,
        costPer1mOutput: 5.00,
        capabilities: ['tools', 'vision', 'search'],
        description: 'Advanced reasoning with 2M context'
    },

    // DeepSeek
    'deepseek-chat': {
        id: 'deepseek-chat',
        provider: 'deepseek',
        contextWindow: 64000,
        maxOutputTokens: 4096,
        costPer1mInput: 0.14,
        costPer1mOutput: 0.28,
        capabilities: [],
        description: 'V3 deepseek'
    },
    'deepseek-reasoner': {
        id: 'deepseek-reasoner',
        provider: 'deepseek',
        contextWindow: 64000,
        maxOutputTokens: 4096,
        costPer1mInput: 0.55,
        costPer1mOutput: 2.19,
        capabilities: ['reasoning'],
        description: 'R1 deepseek reasoning'
    }
};

export class ModelTracker {
    public static estimateCost(modelId: string, inputTokens: number, outputTokens: number, toolsUsed: boolean = false): number {
        // Find best match if exact ID isn't found (e.g. varying suffixes like -0225)
        let spec: ModelSpec | undefined = ModelKnowledgeBase[modelId];
        if (!spec) {
            const key = Object.keys(ModelKnowledgeBase).find(k => modelId.includes(k));
            if (key) {
                spec = ModelKnowledgeBase[key];
            }
        }

        if (!spec) {
            // Default generic fallback estimation for untracked models
            return (inputTokens / 1000000) * 1.0 + (outputTokens / 1000000) * 5.0;
        }

        let cost = (inputTokens / 1000000) * spec.costPer1mInput + (outputTokens / 1000000) * spec.costPer1mOutput;
        
        // Some providers charge extra per tool call invocation / web search (e.g. Gemini grounding, Perplexity)
        // Adjust cost based on capabilities used if we want to model tool premiums
        if (toolsUsed && spec.capabilities.includes('tools')) {
            // Pseudo-premium for usage
            cost += 0.0001; 
        }

        return cost;
    }

    public static doesModelSupportRequest(modelId: string, estimatedTokens: number, requiresTools: boolean): { supported: boolean, reason?: string } {
        let spec: ModelSpec | undefined = ModelKnowledgeBase[modelId];
        if (!spec) {
             const key = Object.keys(ModelKnowledgeBase).find(k => modelId.includes(k));
             if (key) spec = ModelKnowledgeBase[key];
        }

        if (spec) {
            if (estimatedTokens > spec.contextWindow) {
                return { supported: false, reason: `Context size ${estimatedTokens} exceeds model limit of ${spec.contextWindow}` };
            }
            if (requiresTools && !spec.capabilities.includes('tools')) {
                return { supported: false, reason: `Model ${modelId} does not support tool calling` };
            }
        }

        return { supported: true };
    }
}
