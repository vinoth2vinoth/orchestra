export interface OptimizationConfig {
    maxContextTokens?: number;
    toolOutputLimit?: number;
    summarizeAfterCount?: number;
    disableSummarization?: boolean;
}

export class ContextOptimizer {
    
    /**
     * Estimates tokens using a simple heuristic (4 chars ~ 1 token).
     */
    public static estimateTokens(text: string): number {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    /**
     * Truncates a tool output if it exceeds the maximum token bound.
     */
    public static truncateToolOutput(output: any, limitTokens: number = 2000): any {
        if (!output) return output;
        
        let textRep = typeof output === 'string' ? output : JSON.stringify(output);
        const estimated = this.estimateTokens(textRep);
        
        if (estimated > limitTokens) {
            // Cut down to the character limit (1 token ~ 4 chars)
            const cutoffChars = limitTokens * 4;
            return textRep.substring(0, cutoffChars) + `\n\n...[TRUNCATED: Output exceeded bound of ${limitTokens} tokens. Compress output.]`;
        }
        
        return output;
    }

    /**
     * Optimizes the message array to ensure it fits within thresholds.
     * Implements Long-Term Summary strategy and Tool Output Compression.
     */
    public static async optimizeMessages(
        messages: any[], 
        config: OptimizationConfig = {}, 
        summarizer?: (history: any[]) => Promise<string>
    ): Promise<any[]> {
        const {
            maxContextTokens = 100000,
            toolOutputLimit = 2000,
            summarizeAfterCount = 20,
            disableSummarization = false
        } = config;

        let totalTokens = 0;
        let optimized: any[] = [];

        // Reverse iterate to keep newest messages
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            
            // Handle Tool Output Truncation
            if (msg.role === 'tool' || msg.tool_results !== undefined) {
                if (Array.isArray(msg.content)) {
                    msg.content = msg.content.map((part: any) => {
                        if (part.type === 'tool-result') {
                            return {
                                ...part,
                                result: this.truncateToolOutput(part.result, toolOutputLimit)
                            };
                        }
                        return part;
                    });
                } else if (typeof msg.content === 'string') {
                     // Generic truncation for simple strings if it's considered a tool role
                     msg.content = this.truncateToolOutput(msg.content, toolOutputLimit);
                }
            }

            const msgTokens = this.estimateTokens(JSON.stringify(msg));
            if (totalTokens + msgTokens > maxContextTokens || (messages.length - i > summarizeAfterCount && i !== 0)) {
                // If we have a summarizer, use it on the omitted portion
                let summary = "Earlier interactions were compressed to maintain stability.";
                
                if (summarizer && !disableSummarization) {
                    try {
                        const omittedHistory = messages.slice(0, i + 1);
                        summary = await summarizer(omittedHistory);
                    } catch (e) {
                        console.error("Context Summarization Failed:", e);
                    }
                }

                optimized.unshift({
                    role: 'system',
                    content: `[LONG_TERM_MEMORY_SUMMARY]: ${summary}`
                });
                break;
            }

            optimized.unshift(msg);
            totalTokens += msgTokens;
        }

        // Add explicit anthropic cache controls for the static zone (first system message) if using experimental metadata
        if (optimized.length > 0 && optimized[0].role === 'system') {
           optimized[0] = {
               ...optimized[0],
               experimental_providerMetadata: {
                  anthropic: { cacheControl: { type: "ephemeral" } }
               }
           };
        }

        return optimized;
    }

    /**
     * Final safety valve: Synchronously truncates messages to a hard token limit.
     * Use this just before the final LLM call if necessary.
     */
    public static hardTruncate(messages: any[], maxTokens: number): any[] {
        let currentTokens = 0;
        const result: any[] = [];
        
        // Always keep newest messages
        for (let i = messages.length - 1; i >= 0; i--) {
            const msgTokens = this.estimateTokens(JSON.stringify(messages[i]));
            if (currentTokens + msgTokens > maxTokens) break;
            result.unshift(messages[i]);
            currentTokens += msgTokens;
        }
        
        return result;
    }
}
