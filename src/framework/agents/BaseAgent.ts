import { AgentCard } from '../core/types.ts';
import { AgentFrameworkError } from '../core/ErrorHandler.ts';
import { globalEventStore } from '../core/EventStore.ts';
import { globalPluginRegistry } from '../core/PluginRegistry.ts';
import { MemoryMesh } from '../memory/MemoryMesh.ts';
import { LLMConfig, ProviderRegistry } from '../llm/ProviderRegistry.ts';
import { CircuitBreaker, globalCircuitBreaker } from '../resilience/CircuitBreaker.ts';
import { globalToolRegistry } from '../tools/ToolRegistry.ts';
import { globalEscalationManager } from '../governance/EscalationManager.ts';
import { WorkflowSuspendedError } from '../orchestration/WorkflowSuspendedError.ts';
import { globalRegistry } from './AgentRegistry.ts';
import { tool } from 'ai';
import { z } from 'zod';

export abstract class BaseAgent {
    public card: AgentCard;
    public memory: MemoryMesh;
    public llmConfig: LLMConfig;
    private circuitBreaker: CircuitBreaker;
    public instructionPatches: string[] = [];
    public localTools: Record<string, any> = {};
    public localBlackboard: Record<string, any> = {};

    constructor(
        name: string, 
        description: string, 
        role: AgentCard['role'], 
        memory: MemoryMesh,
        llmConfig: LLMConfig,
        capabilities?: string[],
        parentId?: string,
        priority?: number,
        urgency?: number
    ) {
        this.card = {
            id: crypto.randomUUID(),
            name,
            description,
            role,
            priority,
            urgency,
            capabilities: capabilities || [],
            lineage: {
                parentId,
                spawnedAt: Date.now()
            }
        };
        this.memory = memory;
        this.llmConfig = llmConfig;
        this.circuitBreaker = globalCircuitBreaker;

        globalEventStore.append({
            type: 'AGENT_SPAWNED',
            sourceAgentId: parentId || 'SYSTEM',
            targetAgentId: this.card.id,
            threadId: 'GLOBAL', 
            payload: this.card
        });
    }

    /**
     * Proactively consults the Procedural Memory (Wisdom) to find relevant learned rules from past experiences.
     */
    protected async consultWisdom(task: string): Promise<string> {
        try {
            const relevantRules = await this.memory.searchSimilarMemories(task, 3);
            const proceduralRules = relevantRules.filter(m => m.tier === 'PROCEDURAL');
            
            const wisdomBase = proceduralRules.length > 0 
                ? `\n[LEARNED_EXPERIENCE_ORCHESTRATION]:\n${proceduralRules.map((m, i) => `${i + 1}. ${m.content}`).join('\n')}\n`
                : '';

            const patchesBase = this.instructionPatches.length > 0
                ? `\n[INSTRUCTIONAL_MUTATION_ACTIVE]:\nYou have evolved based on previous workflow failures. Apply these behavioral adjustments:\n${this.instructionPatches.map((p, i) => `PATCH_${i + 1}: ${p}`).join('\n')}\n`
                : '';

            return wisdomBase + patchesBase;
        } catch (err) {
            console.warn(`[${this.card.name}] Wisdom retrieval failed, proceeding with base intelligence.`, err);
            return '';
        }
    }

    public mutate(patch: string) {
        this.instructionPatches.push(patch);
        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'ORCHESTRATOR',
            targetAgentId: this.card.id,
            threadId: 'GLOBAL',
            payload: { action: 'INSTRUCTION_MUTATED', patch }
        });
    }

    /**
     * Registers a tool locally to this agent (Decentralized Discovery).
     */
    public hostTool(name: string, tool: any) {
        this.localTools[name] = tool;
        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: this.card.id,
            threadId: 'GLOBAL',
            payload: { action: 'TOOL_HOSTED_LOCALLY', toolName: name }
        });
    }

    /**
     * Optional helper to run LLM directly using this agent's config.
     */
    protected async generateResponse(systemInstruction: string, messages: any[], threadId: string = 'GLOBAL') {
        const coreMem = this.memory.getCoreMemory(this.card.id);
        const coreMemBlock = `\n[MEMGPT_CORE_MEMORY]\nPersona:\n${coreMem.persona}\n\nHuman:\n${coreMem.human}\n[/MEMGPT_CORE_MEMORY]\n`;

        const wisdom = await this.consultWisdom(messages[messages.length - 1]?.content || '');
        const enhancedSystemInstruction = `${systemInstruction}${coreMemBlock}\n${wisdom}`;

        const baseTools = globalRegistry.getToolsForAgent(this.card.id);
        const tools = {
            ...baseTools,
            ...this.localTools,
            core_memory_append: tool({
                description: 'Append information to a Core Memory block (persona or human). Use to permanently remember facts.',
                parameters: z.object({
                    block: z.enum(['persona', 'human']),
                    content: z.string()
                }),
                execute: async ({ block, content }: any) => {
                    this.memory.updateCoreMemory(this.card.id, block, content, true);
                    return `Successfully appended to ${block} core memory.`;
                }
            }),
            core_memory_replace: tool({
                description: 'Completely replace the contents of a Core Memory block (persona or human). Use with caution.',
                parameters: z.object({
                    block: z.enum(['persona', 'human']),
                    content: z.string()
                }),
                execute: async ({ block, content }: any) => {
                    this.memory.updateCoreMemory(this.card.id, block, content, false);
                    return `Successfully replaced ${block} core memory.`;
                }
            }),
            archival_memory_search: tool({
                description: 'Search the agent\'s archival semantic and procedural memory (vector search) for facts, past experiences, or rules.',
                parameters: z.object({
                    query: z.string(),
                    topK: z.number().optional()
                }),
                execute: async ({ query, topK = 3 }: any) => {
                    const results = await this.memory.searchSimilarMemories(query, topK);
                    if (results.length === 0) return "No matches found in archival memory.";
                    return `Found ${results.length} memories:\n` + results.map((r, i) => `${i+1}. [${r.tier}] ${r.content}`).join('\n');
                }
            }),
            archival_memory_insert: tool({
                description: 'Write a new fact, entity, or piece of knowledge into the archival semantic memory. Use this for info that doesn\'t need to be in core memory but should be remembered.',
                parameters: z.object({
                    content: z.string(),
                    entities: z.array(z.string()).optional()
                }),
                execute: async ({ content, entities = [] }: any) => {
                    await this.memory.addSemanticMemory(content, entities);
                    return `Successfully saved to archival semantic memory.`;
                }
            }),
            write_to_local_blackboard: tool({
                description: 'Write temporary state or data to your local blackboard before sharing it globally with the swarm.',
                parameters: z.object({
                    key: z.string(),
                    value: z.string()
                }),
                execute: async (args: any) => {
                    this.localBlackboard[args.key] = args.value;
                    return `Successfully wrote to local blackboard under key: ${args.key}`;
                }
            }),
            requestHumanAssistance: tool({
                description: 'Use this tool when you encounter significant uncertainty, a moral dilemma, or a high-risk operation that requires human verification before proceeding.',
                parameters: z.object({
                    reason: z.string(),
                    context: z.string()
                }),
                execute: async (args: any) => {
                    const { reason, context } = args;
                    const res = await globalEscalationManager.requestApproval(
                        threadId,
                        this.card.id,
                        `AGENT_UNCERTAINTY: ${reason}`,
                        { reason, detailedContext: context }
                    );
                    return `Human provided resolution: ${res.resolution}. Feedback: ${res.feedback || 'None'}`;
                }
            } as any),
            requestMissingTool: tool({
                description: 'Use this tool to pause your execution and ask the human or admin to provide a tool you need but is not available.',
                parameters: z.object({
                    requestedToolName: z.string(),
                    justification: z.string()
                }),
                execute: async (args: any) => {
                    const { requestedToolName, justification } = args;

                    // 1. Try Hierarchical Approval first
                    const parentId = this.card.lineage.parentId;
                    if (parentId && parentId !== 'SYSTEM' && parentId !== 'ORCHESTRATOR') {
                        const parent = globalRegistry.get(parentId);
                        // Check if parent is a Manager and can review (avoiding explicit import of ManagerAgent)
                        if (parent && typeof (parent as any).reviewResourceRequest === 'function') {
                            const res = await (parent as any).reviewResourceRequest(
                                this.card.id, 
                                requestedToolName, 
                                justification, 
                                threadId
                            );
                            if (res.authorized) {
                                return `Request was APPROVED by Manager. You now have access to '${requestedToolName}'. Please proceed with execution.`;
                            } else {
                                return `Request was DENIED by Manager. Reason: ${res.feedback}. Do NOT retry this request unless you have significant new justification.`;
                            }
                        }
                    }

                    // 2. Fallback to Human Intervention (this throws WorkflowSuspendedError)
                    const res = await globalEscalationManager.requestApproval(
                        threadId,
                        this.card.id,
                        `Agent requests missing tool: ${requestedToolName}. Reason: ${justification}`,
                        { requestedToolName, justification }
                    );
                    return `Human provided resolution: ${res.resolution}. Feedback: ${res.feedback || 'None'}`;
                }
            } as any)
        };

        const modifier = await globalPluginRegistry.emitBeforeLLMCall(this.card.id, this.llmConfig, messages, threadId);
        await globalPluginRegistry.emitOnLLMCall(this.card.id, modifier.messages, threadId);

        const resultPromise = this.circuitBreaker.execute(async () => {
            try {
                const stream = await ProviderRegistry.generateStream(modifier.llmConfig, enhancedSystemInstruction, modifier.messages, tools);
                
                let fullText = '';
                for await (const chunk of stream.textStream) {
                    fullText += chunk;
                    // Emit streaming thought event
                    globalEventStore.append({
                        type: 'SYSTEM_HOOK', 
                        sourceAgentId: this.card.id,
                        threadId,
                        payload: { action: 'AGENT_THOUGHT_CHUNK', chunk }
                    });
                }

                const [text, toolCalls, toolResults, usage, finishReason] = await Promise.all([
                    stream.text,
                    stream.toolCalls,
                    stream.toolResults,
                    stream.usage,
                    stream.finishReason
                ]);

                // Emit tool invocation telemetry
                if (toolCalls && toolCalls.length > 0) {
                    toolCalls.forEach(tc => {
                        globalEventStore.append({
                            type: 'SYSTEM_HOOK',
                            sourceAgentId: this.card.id,
                            threadId,
                            payload: { 
                                action: 'TOOL_INVOKED', 
                                toolName: tc.toolName,
                                toolArgs: tc.args
                            }
                        });
                    });
                }

                return {
                    text,
                    toolCalls,
                    toolResults,
                    usage,
                    finishReason
                };
            } catch (err: any) {
                const frameworkErr = new AgentFrameworkError(
                    `LLM Generation Failed: ${err.message}`,
                    'LLM_PROVIDER_ERROR',
                    { 
                        agentId: this.card.id, 
                        threadId, 
                        timestamp: new Date().toISOString() 
                    },
                    err
                );
                
                // Log diagnostic alert immediately
                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: this.card.id,
                    threadId,
                    payload: { 
                        action: 'DIAGNOSTIC_ALERT', 
                        error: frameworkErr.toJSON() 
                    }
                });
                
                throw frameworkErr;
            }
        });

        const result = await resultPromise;

        await globalPluginRegistry.emitOnLLMResponse(this.card.id, result, result.usage, threadId);

        // Vercel SDK might capture the thrown WorkflowSuspendedError inside toolResults
        if (result.toolResults) {
            for (const tr of result.toolResults) {
                if (tr.isError && tr.result instanceof WorkflowSuspendedError) {
                    throw tr.result; // Re-throw so orchestrator catches it for durability
                }
            }
        }

        if (result.usage) {
            globalEventStore.append({
                type: 'SYSTEM_HOOK', // Abusing SYSTEM_HOOK for token emissions as generic telemetry
                sourceAgentId: this.card.id,
                threadId,
                payload: { action: 'TELEMETRY_LOG', tokenUsage: result.usage, cost: result.cost }
            });
        }

        return result;
    }

    protected async generateStructuredResponse(systemInstruction: string, messages: any[], schema: any, threadId: string = 'GLOBAL') {
        const coreMem = this.memory.getCoreMemory(this.card.id);
        const coreMemBlock = `\n[MEMGPT_CORE_MEMORY]\nPersona:\n${coreMem.persona}\n\nHuman:\n${coreMem.human}\n[/MEMGPT_CORE_MEMORY]\n`;

        const wisdom = await this.consultWisdom(messages[messages.length - 1]?.content || '');
        const enhancedSystemInstruction = `${systemInstruction}${coreMemBlock}\n${wisdom}`;

        const modifier = await globalPluginRegistry.emitBeforeLLMCall(this.card.id, this.llmConfig, messages, threadId);
        await globalPluginRegistry.emitOnLLMCall(this.card.id, modifier.messages, threadId);
        
        const result = await this.circuitBreaker.execute(async () => {
            try {
                return await ProviderRegistry.generateObj(modifier.llmConfig, enhancedSystemInstruction, modifier.messages, schema);
            } catch (err: any) {
                const frameworkErr = new AgentFrameworkError(
                    `Structured LLM Generation Failed: ${err.message}`,
                    'LLM_STRUCTURED_ERROR',
                    { 
                        agentId: this.card.id, 
                        threadId, 
                        timestamp: new Date().toISOString() 
                    },
                    err
                );
                
                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: this.card.id,
                    threadId,
                    payload: { 
                        action: 'DIAGNOSTIC_ALERT', 
                        error: frameworkErr.toJSON() 
                    }
                });
                
                throw frameworkErr;
            }
        });

        await globalPluginRegistry.emitOnLLMResponse(this.card.id, result, result.usage, threadId);

        if (result.usage) {
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: this.card.id,
                threadId,
                payload: { action: 'TELEMETRY_LOG', tokenUsage: result.usage, cost: result.cost }
            });
        }

        return result;
    }

    /**
     * Abstract method that concrete classes must implement to handle structural logic.
     */
    abstract execute(task: any, threadId: string): Promise<any>;
}

