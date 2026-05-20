import { BaseAgent } from '../agents/BaseAgent.ts';
import { AgentFrameworkError, ConfigurationError } from '../core/ErrorHandler.ts';
import { WorkflowSuspendedError } from './WorkflowSuspendedError.ts';
import { ProviderRegistry } from '../llm/ProviderRegistry.ts';
import { TelemetrySystem } from '../telemetry/TelemetrySystem.ts';
import { Sanitizer } from '../security/Sanitizer.ts';
import { RuntimeContextOptions, RuntimeServices, createRuntimeContext } from '../core/RuntimeContext.ts';
import { ParadigmStrategy } from './paradigms/ParadigmStrategy.ts';
import { HierarchicalStrategy } from './paradigms/HierarchicalStrategy.ts';
import { ConsensusStrategy } from './paradigms/ConsensusStrategy.ts';
import { SwarmStrategy } from './paradigms/SwarmStrategy.ts';
import { MapReduceStrategy } from './paradigms/MapReduceStrategy.ts';
import { MOAStrategy } from './paradigms/MOAStrategy.ts';
import { GraphStrategy } from './paradigms/GraphStrategy.ts';
import { EventDrivenStrategy } from './paradigms/EventDrivenStrategy.ts';
import { DecentralizedSwarmStrategy } from './paradigms/DecentralizedSwarmStrategy.ts';
import { DebateStrategy } from './paradigms/DebateStrategy.ts';

export type Paradigm = 'GRAPH' | 'HIERARCHICAL' | 'CONSENSUS' | 'EVENT_DRIVEN' | 'SWARM' | 'DECENTRALIZED_SWARM' | 'MAP_REDUCE' | 'DEBATE' | 'MOA';

export interface WorkflowConfig {
    paradigm: Paradigm;
    maxIterations?: number;
    maxRetries?: number;
    agents: BaseAgent[];
    edges?: { from: string; to: string }[]; // Used for GRAPH
    events?: { [eventName: string]: string[] }; // Used for EVENT_DRIVEN (event -> agentIds)
    blackboard?: Record<string, any>; // Persistent shared state
    useDistributedQueue?: boolean; // Enable horizontal scalability
    enableLearning?: boolean; // Opt-in procedural learning to avoid surprise LLM cost
    enableReflection?: boolean; // Opt-in workflow self-reflection to avoid surprise LLM cost
    runtime?: RuntimeContextOptions; // Optional scoped runtime services for tests/tenants
}

/**
 * Orchestrator handles Multi-Paradigm Execution (Dimensions 01-04).
 * Combines graph-based reliability with role-based ease of use.
 */
export class Orchestrator {
    private reflectionQueue: string[] = [];
    private activeReflections = 0;
    private readonly MAX_CONCURRENT_REFLECTIONS = 5;
    private readonly MAX_REFLECTION_QUEUE_SIZE = 100;
    private paradigmRegistry: Map<Paradigm, ParadigmStrategy> = new Map();
    private runtime: RuntimeServices;

    constructor(runtime: RuntimeContextOptions = {}) {
        this.runtime = createRuntimeContext(runtime);
        this.paradigmRegistry.set('HIERARCHICAL', new HierarchicalStrategy());
        this.paradigmRegistry.set('CONSENSUS', new ConsensusStrategy());
        this.paradigmRegistry.set('SWARM', new SwarmStrategy());
        this.paradigmRegistry.set('MAP_REDUCE', new MapReduceStrategy());
        this.paradigmRegistry.set('MOA', new MOAStrategy());
        this.paradigmRegistry.set('GRAPH', new GraphStrategy());
        this.paradigmRegistry.set('EVENT_DRIVEN', new EventDrivenStrategy());
        this.paradigmRegistry.set('DECENTRALIZED_SWARM', new DecentralizedSwarmStrategy());
        this.paradigmRegistry.set('DEBATE', new DebateStrategy());
    }

    private async queueReflection(threadId: string, agents: BaseAgent[]) {
        if (this.reflectionQueue.length >= this.MAX_REFLECTION_QUEUE_SIZE) {
            console.warn(`[Orchestrator] Reflection queue full. Dropping reflection for thread ${threadId}.`);
            return;
        }

        this.reflectionQueue.push(threadId);
        this.processReflectionQueue(agents);
    }

    private async processReflectionQueue(agents: BaseAgent[]) {
        if (this.activeReflections >= this.MAX_CONCURRENT_REFLECTIONS || this.reflectionQueue.length === 0) {
            return;
        }

        const threadId = this.reflectionQueue.shift()!;
        this.activeReflections++;

        try {
            await this.runSelfReflection(threadId, agents);
        } catch (err) {
            console.error(`[Orchestrator] Self-reflection failed for thread ${threadId}:`, err);
        } finally {
            this.activeReflections--;
            this.processReflectionQueue(agents);
        }
    }
    private activeDependencyChains: Map<string, string[]> = new Map();
    private readonly MAX_CONVERSATIONAL_DEPTH = 10;
    private readonly MAX_SILENCE_TIMEOUT_MS = 60000; // 1 minute limit for any single agent response

    private getRoleWeight(role: string): number {
        switch(role) {
            case 'MANAGER': return 100;
            case 'JUDGE': return 90;
            case 'PLANNER': return 80;
            case 'CRITIC': return 70;
            case 'WORKER': return 50;
            default: return 10;
        }
    }

    private sortAgentsByPriority(agents: BaseAgent[]): BaseAgent[] {
        return [...agents].sort((a, b) => {
            // 1. Urgency (higher is first)
            const urgencyA = a.card.urgency ?? 0;
            const urgencyB = b.card.urgency ?? 0;
            if (urgencyA !== urgencyB) return urgencyB - urgencyA;

            // 2. Priority (higher is first)
            const priorityA = a.card.priority ?? 0;
            const priorityB = b.card.priority ?? 0;
            if (priorityA !== priorityB) return priorityB - priorityA;

            // 3. Role-based weighting
            const roleA = this.getRoleWeight(a.card.role);
            const roleB = this.getRoleWeight(b.card.role);
            return roleB - roleA;
        });
    }

    private assignRuntimeToAgents(agents: BaseAgent[], runtime: RuntimeServices) {
        const visited = new Set<string>();
        const assign = (agent: BaseAgent) => {
            if (visited.has(agent.card.id)) return;
            visited.add(agent.card.id);
            agent.setRuntimeContext(runtime);
            runtime.agentRegistry.register(agent);

            const subordinates = (agent as any).subordinates;
            if (Array.isArray(subordinates)) {
                subordinates.forEach((sub: BaseAgent) => assign(sub));
            }
        };

        agents.forEach(assign);
    }

    public async executeWorkflow(task: any, config: WorkflowConfig, threadId: string): Promise<any> {
        const configRuntimeNeedsScopedRegistry = Boolean(
            config.runtime?.tenantId ||
            config.runtime?.stateAdapter ||
            config.runtime?.pluginRegistry ||
            config.runtime?.circuitBreakers ||
            config.runtime?.queueBroker ||
            config.runtime?.workerPool ||
            config.runtime?.policyEngine ||
            config.runtime?.auditLog ||
            config.runtime?.eventStore ||
            config.runtime?.checkpointer ||
            config.runtime?.stateStore ||
            config.runtime?.toolRegistry ||
            config.runtime?.escalationManager ||
            config.runtime?.genealogy
        );
        const workflowRuntime = config.runtime ? createRuntimeContext({
            tenantId: config.runtime.tenantId || this.runtime.tenantId,
            stateAdapter: config.runtime.stateAdapter || this.runtime.stateAdapter,
            pluginRegistry: config.runtime.pluginRegistry || this.runtime.pluginRegistry,
            circuitBreakers: config.runtime.circuitBreakers || this.runtime.circuitBreakers,
            queueBroker: config.runtime.queueBroker || this.runtime.queueBroker,
            workerPool: config.runtime.workerPool || this.runtime.workerPool,
            policyEngine: config.runtime.policyEngine || this.runtime.policyEngine,
            auditLog: config.runtime.auditLog || this.runtime.auditLog,
            agentRegistry: config.runtime.agentRegistry || (configRuntimeNeedsScopedRegistry ? undefined : this.runtime.agentRegistry),
            eventStore: config.runtime.eventStore || this.runtime.eventStore,
            checkpointer: config.runtime.checkpointer || this.runtime.checkpointer,
            stateStore: config.runtime.stateStore || this.runtime.stateStore,
            escalationManager: config.runtime.escalationManager || ((config.runtime.eventStore || config.runtime.auditLog) ? undefined : this.runtime.escalationManager),
            genealogy: config.runtime.genealogy || (config.runtime.eventStore ? undefined : this.runtime.genealogy),
            toolRegistry: config.runtime.toolRegistry || this.runtime.toolRegistry
        }) : this.runtime;
        this.assignRuntimeToAgents(config.agents, workflowRuntime);
        workflowRuntime.eventStore.append({
            type: 'LLM_GENERATION_STARTED', // Loosely representing workflow start
            sourceAgentId: 'ORCHESTRATOR',
            threadId,
            payload: { task, config: { paradigm: config.paradigm } }
        });

        // Initialize blackboard if missing
        if (!config.blackboard) config.blackboard = {};
        config.blackboard._useDistributedQueue = config.useDistributedQueue === true;

        const workflowSpanId = `workflow_${threadId}_${Date.now()}`;
        TelemetrySystem.startSpan(workflowSpanId);
        const workflowSpan = TelemetrySystem.getActiveSpan(workflowSpanId);

        const maxRetries = config.maxRetries ?? 1;
        const enableReflection = config.enableReflection === true;
        let attempt = 0;
        let result;

        // Prioritize agents based on role, priority, and urgency
        const sortedAgents = this.sortAgentsByPriority(config.agents);

        while (attempt <= maxRetries) {
            try {
                const strategy = this.paradigmRegistry.get(config.paradigm);
                if (strategy) {
                    result = await strategy.run(task, sortedAgents, {
                        threadId,
                        blackboard: config.blackboard,
                        executeAgentTask: (agent, task, tid, bb, ps) => this.executeAgentTask(agent, task, tid, config.paradigm, bb, ps || workflowSpan, config.enableLearning === true, workflowRuntime),
                        checkpointer: workflowRuntime.checkpointer,
                        eventStore: workflowRuntime.eventStore,
                        parentSpan: workflowSpan
                    }, config);
                } else {
                    throw new Error(`Paradigm ${config.paradigm} not implemented or registered`);
                }
                // If it succeeds, break out of retry loop
                break;
            } catch (error: any) {
                if (error instanceof WorkflowSuspendedError || error.name === 'WorkflowSuspendedError') {
                    TelemetrySystem.endSpan(workflowSpanId); // Suspend ends the current span
                    // Serialize state here
                    const stateToSave = {
                        threadId,
                        approvalId: error.approvalId,
                        task,
                        config: { paradigm: config.paradigm }, 
                        blackboard: config.blackboard,
                        history: workflowRuntime.eventStore.getLogs().filter(e => e.threadId === threadId),
                        agentDefinitions: config.agents.map(a => ({
                            name: a.card.name,
                            role: a.card.role,
                            systemInstruction: a.card.description,
                            llmConfig: a.llmConfig,
                            capabilities: a.card.capabilities,
                            priority: a.card.priority,
                            urgency: a.card.urgency
                        }))
                    };
                    await workflowRuntime.stateStore.saveState(error.approvalId, stateToSave);
                    
                    await workflowRuntime.pluginRegistry.emitOnWorkflowSleep(threadId, stateToSave);
                    
                    workflowRuntime.eventStore.append({
                        type: 'WORKFLOW_COMPLETED', // Or suspended
                        sourceAgentId: 'ORCHESTRATOR',
                        threadId,
                        payload: { status: 'SUSPENDED', approvalId: error.approvalId, message: 'Process shutting down securely to wait for human intervention.' }
                    });
                    
                    return { status: 'SUSPENDED', approvalId: error.approvalId };
                }

                if (error instanceof ConfigurationError || error.name === 'ConfigurationError') {
                    TelemetrySystem.endSpan(workflowSpanId, error);
                    throw error;
                }

                attempt++;
                if (attempt > maxRetries) {
                    const finalErr = error instanceof AgentFrameworkError ? error : new AgentFrameworkError(
                        `Workflow Execution Exhausted (Attempts: ${attempt}): ${error.message}`,
                        'WORKFLOW_RETRY_EXHAUSTED',
                        { threadId, task, timestamp: new Date().toISOString() },
                        error
                    );
                    
                    workflowRuntime.eventStore.append({
                        type: 'SYSTEM_HOOK',
                        sourceAgentId: 'ORCHESTRATOR',
                        threadId,
                        payload: { 
                            action: 'DIAGNOSTIC_ALERT', 
                            error: finalErr.toJSON() 
                        }
                    });

                    TelemetrySystem.endSpan(workflowSpanId, finalErr);
                    
                    // Trigger Autonomous Self-Reflection (Dimension 07)
                    // We reflect on why the workflow exhausted its retries
                    if (enableReflection) {
                        this.queueReflection(threadId, config.agents);
                    }
                    
                    throw finalErr;
                }

                workflowRuntime.eventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'ORCHESTRATOR',
                    threadId,
                    payload: { action: 'RETRY_INITIATED', attempt, error: error.message }
                });
                
                const backoffDelay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
        }

        TelemetrySystem.endSpan(workflowSpanId);

        workflowRuntime.eventStore.append({
            type: 'WORKFLOW_COMPLETED',
            sourceAgentId: 'ORCHESTRATOR',
            threadId,
            payload: { result }
        });

        // Clear checkpoint file after full successful completion
        await workflowRuntime.checkpointer.clearCheckpoint(threadId);

        // Trigger Autonomous Self-Reflection (Dimension 07)
        // This is non-blocking and queued to avoid LLM burst saturation
        if (enableReflection) {
            this.queueReflection(threadId, config.agents);
        }

        return result;
    }

    /**
     * Autonomous Self-Reflection: Analyzes a completed thread to distill meta-level wisdom.
     */
    private async runSelfReflection(threadId: string, agents: BaseAgent[]) {
        const events = this.runtime.eventStore.getEventsByThread(threadId);
        if (events.length < 5) return; // Not enough context to reflect deeply

        try {
            const systemPrompt = `You are the Orchestra Strategic Reflection Engine. 
Your goal is to perform deep behavioral analysis on agent interactions.
Look for:
- Logic loops or repeated misalignments.
- Tool usage inefficiencies (e.g., redundant calls).
- Missed opportunities for parallelization in the current paradigm.
- Tone or style inconsistencies that suggest agent confusion.

Distill your findings into high-level 'Wisdom Mutations' that can be applied to future cycles.`;

            const reflectionTask = `
=== THREAD EXECUTION LOGS [${threadId}] ===
${JSON.stringify(events.slice(-100), null, 2)}
=== END LOGS ===

Analyze the execution above.
If you can identify a concrete rule to improve future performance, output exactly:
SYSTEM_OPTIMIZATION: [Clear, actionable rule]

If you see a behavioral flaw that needs correcting, output exactly:
BEHAVIORAL_MUTATION: [Specific correction for agent prompts]

Otherwise, output "NO_LEARNING_DETECTED".`;
            
            // Use the top-priority agent (usually Manager) to reflect
            const reflector = agents[0];
            const policyConfig = { ...reflector.llmConfig, tier: 'POLICY' as const };
            const response = await this.runtime.circuitBreakers.execute(`reflection:${reflector.card.id}`, async () => {
                return await ProviderRegistry.generate(policyConfig, systemPrompt, [{ role: 'user', content: reflectionTask }]);
            }, async () => ({ text: 'NO_META_LEARNING', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }));

            if (response.text && response.text.includes('SYSTEM_OPTIMIZATION')) {
                const rule = response.text.replace('SYSTEM_OPTIMIZATION:', '').trim();
                await reflector.memory.addProceduralMemory(rule, 'CROSS_AGENT_WISDOM');
                
                // Apply Instructional Mutation (Dimension 07 Self-Evolution)
                // This physically rewrites the system instruction for all agents in the swarm
                for (const agent of agents) {
                    agent.mutate(rule);
                }

                this.runtime.eventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'REFLECTION_ENGINE',
                    threadId,
                    payload: { action: 'WISDOM_DISTILLED', rule }
                });
            }
        } catch (err) {
            console.warn("Self-reflection failed", err);
        }
    }

    /**
     * Resumes a suspended workflow when a webhook or approval provides the resolution.
     */
    public async resumeWorkflow(approvalId: string, resolution: 'APPROVED' | 'REJECTED' | 'MODIFIED', feedback?: string, agents?: BaseAgent[]): Promise<any> {
        const state = await this.runtime.stateStore.getState(approvalId);
        if (!state) {
            throw new Error(`Cannot resume: No suspended workflow found for approval ID ${approvalId}`);
        }

        if (resolution === 'REJECTED') {
            await this.runtime.stateStore.deleteState(approvalId);
            return { status: 'TERMINATED', reason: 'Rejected by human' };
        }

        await this.runtime.escalationManager.resolveApproval(approvalId, resolution, feedback);
        await this.runtime.stateStore.deleteState(approvalId);
        await this.runtime.pluginRegistry.emitOnWorkflowResume(state.threadId, state);
        
        this.runtime.eventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'ORCHESTRATOR',
            threadId: state.threadId,
            payload: { action: 'WORKFLOW_RESUMED', approvalId, resolution }
        });

        // Reconstruct the task based on feedback
        let resumedTask = state.task;
        if (feedback) {
            resumedTask = `[HUMAN FEEDBACK INJECTED]\nResolution: ${resolution}\nFeedback: ${feedback}\n\nOriginal Task Context:\n${state.task}`;
        }
        
        const resumedConfig: WorkflowConfig = {
            paradigm: state.config.paradigm,
            agents: agents || [], 
            maxRetries: 1,
            blackboard: state.blackboard
        };

        return this.executeWorkflow(resumedTask, resumedConfig, state.threadId);
    }
    
    private async executeAgentTask(agent: BaseAgent, task: any, threadId: string, paradigm: string, blackboard?: Record<string, any>, parentSpan?: any, enableLearning: boolean = false, runtime: RuntimeServices = this.runtime): Promise<any> {
        const spanId = `agent_exec_${agent.card.id}_${Date.now()}`;
        // --- RELIABILITY: CYCLE DETECTION ---
        const chain = this.activeDependencyChains.get(threadId) || [];
        
        const chainCount = chain.filter(c => c === agent.card.id).length;
        if (chainCount > 100) {
            const deadlockError = `Conversational Deadlock Detected: Agent ${agent.card.id} is deeply nested or overloaded.`;
            runtime.eventStore.append({ type: 'ERROR_THROWN', sourceAgentId: 'ORCHESTRATOR', threadId, payload: { error: deadlockError } });
            throw new Error(deadlockError);
        }
        
        if (chain.length >= this.MAX_CONVERSATIONAL_DEPTH) {
            throw new Error(`Maximum conversational depth reached (${this.MAX_CONVERSATIONAL_DEPTH}). Terminating branch for reliability.`);
        }

        this.activeDependencyChains.set(threadId, [...chain, agent.card.id]);
        
        const useDistributedQueue = blackboard?._useDistributedQueue === true;
        
        try {
            if (useDistributedQueue) {
                runtime.eventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'ORCHESTRATOR',
                    threadId,
                    payload: { from: 'Local', to: 'QueueBroker', message: `Dispatching to Distributed Queue for ${agent.card.name}` }
                });

                const publishPromise = runtime.queueBroker.publish({
                    taskId: `task_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`,
                    threadId,
                    agentId: agent.card.id,
                    agentConfig: agent.card,
                    payload: task,
                    blackboard
                });

                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`Distributed task timed out for agent ${agent.card.name}`)), 300000)
                );

                const result: any = await Promise.race([publishPromise, timeoutPromise]);

                if (result.status === 'error') {
                    runtime.eventStore.append({
                        type: 'ERROR_THROWN',
                        sourceAgentId: 'ORCHESTRATOR',
                        threadId,
                        payload: { error: `Distributed worker failed for agent ${agent.card.name}: ${result.error}` }
                    });
                    throw new Error(`Distributed worker failed for agent ${agent.card.name}: ${result.error}`);
                }

                return result.result;
            }

            let currentTask = task;
            const startTime = Date.now();
            
            // Inject blackboard context if available and relevant (Dimension 01-04 Secure Communication)
            if (blackboard && Object.keys(blackboard).length > 0) {
                const serializedBB = JSON.stringify(blackboard);
                
                // Security Guard: Prevent Token Exhaustion DDoS via blackboard flooding
                if (serializedBB.length > 50000) {
                     console.warn(`[ORCHESTRATOR] Blackboard size of ${serializedBB.length} exceeds safety limit. Truncating for agent ${agent.card.name}.`);
                }

                const blackboardContext = Sanitizer.wrapSterile(
                    serializedBB.substring(0, 50000), 
                    'GLOBAL_BLACKBOARD_UNTRUSTED_CONTENT'
                );

                if (typeof currentTask === 'string') {
                    currentTask += `\n\n${blackboardContext}`;
                } else if (typeof currentTask === 'object') {
                    // Copy before attaching blackboard so concurrent workflows do not mutate caller-owned task objects.
                    currentTask = Array.isArray(currentTask)
                        ? Object.assign([...currentTask], { blackboard })
                        : { ...currentTask, blackboard };
                }
            }

            try {
                TelemetrySystem.startSpan(spanId, parentSpan);

                // --- GOVERNANCE: Policy Check (Dimension 05) ---
                const policyResult = runtime.policyEngine.evaluate(currentTask, agent.card.id, threadId);
                if (policyResult.status === 'RED') {
                    throw new Error(`Execution Blocked by Policy Engine: ${policyResult.violations.join(', ')}`);
                }
                
                await runtime.auditLog.log(threadId, agent.card.id, 'AGENT_EXECUTION_START', `Agent ${agent.card.name} started task execution under paradigm ${paradigm}`);

                try {
                    currentTask = await runtime.pluginRegistry.emitBeforeAgentExecute(agent.card.id, currentTask, threadId);
                } catch (e: any) {
                    if (e.name === 'CacheHitException') {
                        // Cache Hit! Short-circuit LLM.
                        TelemetrySystem.emit('SEMANTIC_CACHE', threadId, {
                            action: 'TASK_CACHE_HIT',
                            category: 'PERFORMANCE'
                        });
                        return e.cachedResponse;
                    }
                    throw e;
                }
                
                // Execute within execution context for RBAC & Secret bindings
                let contextConfig = {
                    tenantId: blackboard?._tenantId || runtime.tenantId, 
                    agentId: agent.card.id,
                    threadId,
                    capabilities: agent.card.capabilities,
                    runtime
                };
                
                const { runWithContext } = await import('../core/ExecutionContext.ts');

                // --- RELIABILITY: TIMEOUT WRAPPER ---
                const breakerKey = `${contextConfig.tenantId}:${agent.card.id}:${agent.llmConfig.modelName || 'default'}`;
                let result = await runtime.circuitBreakers.execute(breakerKey, async () => {
                    return await runWithContext(contextConfig, async () => {
                        // --- PERFORMANCE: WorkerPool Concurrency Lock (Dimension 06) ---
                        return await runtime.workerPool.run(async () => {
                            return await agent.execute(currentTask, threadId);
                        }, agent.card.id, threadId);
                    });
                }, undefined, this.MAX_SILENCE_TIMEOUT_MS);
                
                result = await runtime.pluginRegistry.emitAfterAgentExecute(agent.card.id, currentTask, result, threadId);
                
                const duration = TelemetrySystem.endSpan(spanId);
                runtime.eventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: agent.card.id,
                    threadId,
                    payload: { action: 'AGENT_EXECUTION_COMPLETED', duration, status: 'SUCCESS' }
                });

                if (enableLearning) {
                    await this.consolidateAgentLearning(agent, currentTask, result, null, threadId, runtime);
                }
                return result;
            } catch (error: any) {
                const duration = TelemetrySystem.endSpan(spanId, error);
                runtime.eventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: agent.card.id,
                    threadId,
                    payload: { action: 'AGENT_EXECUTION_COMPLETED', duration, status: 'FAILED', error: error.message }
                });

                const recovery = await runtime.pluginRegistry.emitOnAgentFault(agent.card.id, error, currentTask, threadId);
                if (recovery && recovery.recovered) {
                    return recovery.result;
                }
                if (enableLearning) {
                    await this.consolidateAgentLearning(agent, currentTask, null, error, threadId, runtime);
                }
                throw error;
            }
        } finally {
            // Pop from dependency chain when execution (successful or failed) finishes
            const currentChain = this.activeDependencyChains.get(threadId) || [];
            const nextChain = [...currentChain];
            const idx = nextChain.lastIndexOf(agent.card.id);
            if (idx !== -1) nextChain.splice(idx, 1);
            this.activeDependencyChains.set(threadId, nextChain);
        }
    }

    private async consolidateAgentLearning(agent: BaseAgent, task: any, result: any, error: any, threadId: string, runtime: RuntimeServices = this.runtime) {
        try {
            const systemPrompt = "You are a cognitive consolidator. Extract actionable procedural rules from task outcomes.";
            const messages = [{ 
                role: 'user', 
                content: `Task: ${JSON.stringify(task).substring(0, 500)}\nOutcome: ${error ? 'FAILED with error: ' + error.message : 'SUCCEEDED with result: ' + JSON.stringify(result).substring(0, 500)}\n\nIf there is a meaningful lesson (e.g., fixing an error, successful strategy), extract it as a procedural rule. Format: "When attempting to [action], if [condition], you should [strategy]." If this is a routine success or there is no actionable learning, you MUST return exactly "NO_LEARNING".`
            }];
            
            const policyConfig = { ...agent.llmConfig, tier: 'POLICY' as const };
            const response = await runtime.circuitBreakers.execute(`learning:${agent.card.id}:${agent.llmConfig.modelName || 'default'}`, async () => {
                return await ProviderRegistry.generate(policyConfig, systemPrompt, messages);
            }, async () => ({ text: 'NO_LEARNING', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }));
            
            if (response.text && !response.text.includes('NO_LEARNING')) {
                await agent.memory.addProceduralMemory(response.text, 'AGENT_LEARNING');
                
                runtime.eventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'ORCHESTRATOR',
                    threadId,
                    payload: { action: 'CONSOLIDATED_LEARNING', rule: response.text }
                });
            }
        } catch (err: any) {
            // Silently skip learning if provider fails (e.g. missing keys during tests)
            if (err.message?.includes('API key') || err.name === 'LoadAPIKeyError') {
                return; 
            }
            console.warn("[ORCHESTRATOR] Learning consolidation skipped:", err.message);
        }
    }
}
