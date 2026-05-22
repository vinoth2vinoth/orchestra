import { z } from 'zod';
import { globalEventStore } from '../core/EventStore.ts';
import { Sanitizer } from '../security/Sanitizer.ts';
import type { EventStore } from '../core/EventStore.ts';

/**
 * ToolGuard provides middleware-like protection for tool execution.
 * It enforces strict schema validation and allows for "Dry Run" or "Pre-Execution" hooks.
 */
export class ToolGuard {
    /**
     * Wraps a tool's execute function with logging, error handling, and optional dry-run logic.
     */
    public static wrap<T extends z.ZodTypeAny>(
        agentId: string,
        toolName: string,
        schema: T,
        execute: (args: z.infer<T>) => Promise<any>,
        eventStore: EventStore = globalEventStore,
        threadId: string = 'GLOBAL'
    ) {
        return async (args: z.infer<T>) => {
            try {
                // 1. Structural Validation (Strict Zod check)
                const parsed = schema.safeParse(args);
                if (!parsed.success) {
                    const errorMsg = `Tool [${toolName}] Argument Validation Failed: ${parsed.error.message}`;
                    console.error(errorMsg);
                    return {
                        error: errorMsg,
                        fixSuggestion: "Ensure you are passing only the fields defined in the schema."
                    };
                }

                // Global Safety Guard: Payload Size Limit (Preventing Buffer/Token Flooding)
                const payloadStr = JSON.stringify(parsed.data);
                if (payloadStr.length > 100000) { // Default 100KB safeguard
                    const errorMsg = `Tool [${toolName}] Denied: Payload too large (${payloadStr.length} chars). Possible Token Exhaustion DDoS attempt detected.`;
                    console.error(errorMsg);
                    return {
                        error: "SECURITY_BLOCK: Payload exceeds safe dimensionality limits.",
                        fixSuggestion: "Split your task into smaller chunks."
                    };
                }

                // 2. Telemetry: Pre-execution
                eventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: agentId,
                    threadId,
                    payload: { action: 'TOOL_GUARD_CHECK', toolName, args }
                });

                // 3. Execution
                const result = await execute(parsed.data);

                // 4. Post-Execution: Scrubbing (H1 remediation)
                if (typeof result === 'string') {
                    return Sanitizer.scrubSecrets(result);
                } else if (result && typeof result === 'object') {
                    // Primitive deep scrub for objects
                    return JSON.parse(JSON.stringify(result), (key, value) => {
                        if (typeof value === 'string') return Sanitizer.scrubSecrets(value);
                        return value;
                    });
                }

                return result;
            } catch (err: any) {
                const errorMsg = `Tool [${toolName}] Execution Crashed: ${err.message}`;
                console.error(errorMsg);
                return {
                    error: errorMsg,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                };
            }
        };
    }
}
