import { BaseAgent } from '../agents/BaseAgent.ts';
import { AgentCard } from '../core/types.ts';
import { MemoryMesh, globalMemoryMesh } from './MemoryMesh.ts';
import { ProviderRegistry, LLMConfig } from '../llm/ProviderRegistry.ts';

/**
 * SummarizerAgent is a specialized utility agent used by the framework
 * to compress long conversational histories into dense semantic summaries.
 */
export class SummarizerAgent extends BaseAgent {
    constructor(memory: MemoryMesh = globalMemoryMesh) {
        const config: LLMConfig = {
            modelName: 'gemini-2.5-flash', // Use a fast model for background tasks
            temperature: 0.1,
            maxTokens: 1000,
            disableSummarization: true
        };

        super(
            'Context Compressor',
            'Summarization Specialist specializing in high-fidelity semantic compression.',
            'WORKER',
            memory,
            config,
            ['summarization'],
            'SYSTEM',
            10, // priority
            1   // urgency
        );
    }

    public async execute(history: any[], threadId: string = 'GLOBAL'): Promise<string> {
        const historyText = history.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n---\n');
        
        const systemPrompt = `You are a Context Compression Specialist. Your goal is to compress the following conversational history into a dense, high-fidelity semantic summary. 
        Retain all key decisions, entities mentioned, unresolved tasks, and critical state changes. 
        Discard conversational filler, greetings, and redundant confirmations.
        FORMAT: Return ONLY the summary text.`;

        const config: LLMConfig = {
            modelName: 'gemini-2.5-flash', // Use a fast model for background tasks
            temperature: 0.1,
            maxTokens: 1000,
            disableSummarization: true
        };

        const response = await ProviderRegistry.generate(config, systemPrompt, [
            { role: 'user', content: `Summarize this history:\n\n${historyText}` }
        ]);

        return response.text;
    }
}

export const globalSummarizer = new SummarizerAgent();
