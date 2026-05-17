import { BaseAgent } from '../agents/BaseAgent.ts';
import { AgentFrameworkError } from '../core/ErrorHandler.ts';
import { globalEventStore } from '../core/EventStore.ts';
import { WBFTConsensus } from '../consensus/WBFT.ts';
import { WorkflowSuspendedError } from './WorkflowSuspendedError.ts';
import { globalStateStore } from './StateStore.ts';
import { globalEscalationManager } from '../governance/EscalationManager.ts';
import { ProviderRegistry } from '../llm/ProviderRegistry.ts';
import { globalPluginRegistry } from '../core/PluginRegistry.ts';
import { globalCircuitBreaker } from '../resilience/CircuitBreaker.ts';
import { globalCheckpointer } from './Checkpointer.ts';
import { globalQueueBroker } from './QueueBroker.ts';
import { TelemetrySystem } from '../telemetry/TelemetrySystem.ts';
import { Sanitizer } from '../security/Sanitizer.ts';

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
}

/**
 * Orchestrator handles Multi-Paradigm Execution (Dimensions 01-04).
 * Combines graph-based reliability with role-based ease of use.
 */
export class Orchestrator {
    private wbft = new WBFTConsensus();
    private reflectionQueue: string[] = [];
    private activeReflections = 0;
    private readonly MAX_CONCURRENT_REFLECTIONS = 5;
    private readonly MAX_REFLECTION_QUEUE_SIZE = 100;

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

    public async executeWorkflow(task: any, config: WorkflowConfig, threadId: string): Promise<any> {
        globalEventStore.append({
            type: 'LLM_GENERATION_STARTED', // Loosely representing workflow start
            sourceAgentId: 'ORCHESTRATOR',
            threadId,
            payload: { task, config: { paradigm: config.paradigm } }
        });

        // Initialize blackboard if missing
        if (!config.blackboard) config.blackboard = {};
        config.blackboard._useDistributedQueue = config.useDistributedQueue === true;

        const maxRetries = config.maxRetries ?? 1;
        let attempt = 0;
        let result;

        // Prioritize agents based on role, priority, and urgency
        const sortedAgents = this.sortAgentsByPriority(config.agents);

        while (attempt <= maxRetries) {
            try {
                switch (config.paradigm) {
                    case 'HIERARCHICAL':
                        result = await this.runHierarchical(task, sortedAgents, threadId, config.blackboard);
                        break;
                    case 'CONSENSUS':
                        result = await this.runConsensus(task, sortedAgents, threadId, config.blackboard);
                        break;
                    case 'GRAPH':
                        result = await this.runGraph(task, config, threadId);
                        break;
                    case 'EVENT_DRIVEN':
                        result = await this.runEventDriven(task, config, threadId);
                        break;
                    case 'SWARM':
                        result = await this.runSwarm(task, sortedAgents, threadId, config.blackboard);
                        break;
                    case 'DECENTRALIZED_SWARM':
                        result = await this.runDecentralizedSwarm(task, sortedAgents, threadId, config.blackboard, config.maxIterations);
                        break;
                    case 'DEBATE':
                        result = await this.runDebate(task, sortedAgents, threadId, config.maxIterations, config.blackboard);
                        break;
                    case 'MAP_REDUCE':
                        result = await this.runMapReduce(task, sortedAgents, threadId, config.blackboard);
                        break;
                    case 'MOA':
                        result = await this.runMOA(task, sortedAgents, threadId, config.blackboard);
                        break;
                    default:
                        throw new Error(`Paradigm ${config.paradigm} not implemented yet`);
                }
                // If it succeeds, break out of retry loop
                break;
            } catch (error: any) {
                if (error instanceof WorkflowSuspendedError || error.name === 'WorkflowSuspendedError') {
                    // Serialize state here
                    const stateToSave = {
                        threadId,
                        approvalId: error.approvalId,
                        task,
                        config: { paradigm: config.paradigm }, // Save minimum viable config
                        history: globalEventStore.getLogs().filter(e => e.threadId === threadId),
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
                    await globalStateStore.saveState(error.approvalId, stateToSave);
                    
                    await globalPluginRegistry.emitOnWorkflowSleep(threadId, stateToSave);
                    
                    globalEventStore.append({
                        type: 'WORKFLOW_COMPLETED', // Or suspended
                        sourceAgentId: 'ORCHESTRATOR',
                        threadId,
                        payload: { status: 'SUSPENDED', approvalId: error.approvalId, message: 'Process shutting down securely to wait for human intervention.' }
                    });
                    
                    return { status: 'SUSPENDED', approvalId: error.approvalId };
                }

                attempt++;
                if (attempt > maxRetries) {
                    const finalErr = error instanceof AgentFrameworkError ? error : new AgentFrameworkError(
                        `Workflow Execution Exhausted (Attempts: ${attempt}): ${error.message}`,
                        'WORKFLOW_RETRY_EXHAUSTED',
                        { threadId, task, timestamp: new Date().toISOString() },
                        error
                    );
                    
                    globalEventStore.append({
                        type: 'SYSTEM_HOOK',
                        sourceAgentId: 'ORCHESTRATOR',
                        threadId,
                        payload: { 
                            action: 'DIAGNOSTIC_ALERT', 
                            error: finalErr.toJSON() 
                        }
                    });

                    // Trigger Autonomous Self-Reflection (Dimension 07)
                    // We reflect on why the workflow exhausted its retries
                    this.queueReflection(threadId, config.agents);
                    
                    throw finalErr;
                }

                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'ORCHESTRATOR',
                    threadId,
                    payload: { action: 'RETRY_INITIATED', attempt, error: error.message }
                });
                
                const backoffDelay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
        }

        globalEventStore.append({
            type: 'WORKFLOW_COMPLETED',
            sourceAgentId: 'ORCHESTRATOR',
            threadId,
            payload: { result }
        });

        // Clear checkpoint file after full successful completion
        await globalCheckpointer.clearCheckpoint(threadId);

        // Trigger Autonomous Self-Reflection (Dimension 07)
        // This is non-blocking and queued to avoid LLM burst saturation
        this.queueReflection(threadId, config.agents);

        return result;
    }

    /**
     * Autonomous Self-Reflection: Analyzes a completed thread to distill meta-level wisdom.
     */
    private async runSelfReflection(threadId: string, agents: BaseAgent[]) {
        const events = globalEventStore.getEventsByThread(threadId);
        if (events.length < 5) return; // Not enough context to reflect deeply

        try {
            const systemPrompt = "You are the Orchestra Reflection Engine. Your goal is to analyze agent interactions and identify missed optimizations or repeated errors.";
            const reflectionTask = `
Analyze the execution logs for Thread [${threadId}]:
${JSON.stringify(events.slice(-50), null, 2)}

Identify if:
1. Any agent had to be corrected by another.
2. Any agent repeatedly failed at a specific task.
3. A specific tool call combination was highly successful.

If you find a meta-rule, return it in this format: "SYSTEM_OPTIMIZATION: [Rule]". If not, return "NO_META_LEARNING".
`;
            
            // Use the top-priority agent (usually Manager) to reflect
            const reflector = agents[0];
            const policyConfig = { ...reflector.llmConfig, tier: 'POLICY' as const };
            const response = await globalCircuitBreaker.execute(async () => {
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

                globalEventStore.append({
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
        const state = await globalStateStore.getState(approvalId);
        if (!state) {
            throw new Error(`Cannot resume: No suspended workflow found for approval ID ${approvalId}`);
        }

        // Apply human feedback to the escalation manager to unlock any pending state 
        // (If we fully shut down the process, EscalationManager also needs this to hydrate, or we pass it back inside the agent's memory)
        globalEscalationManager.resolveApproval(approvalId, resolution, feedback);
        
        await globalStateStore.deleteState(approvalId);
        
        await globalPluginRegistry.emitOnWorkflowResume(state.threadId, state);
        
        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'ORCHESTRATOR',
            threadId: state.threadId,
            payload: { action: 'WORKFLOW_RESUMED', approvalId, resolution }
        });

        // For this naive demo, we just restart the workflow with the previous context + human feedback added as new task prepended
        // A true Temporal-like engine would rehydrate the exact call stack line
        const resumedTask = `[RESUMED AFTER HUMAN INTERVENTION: ${resolution}. Feedback: ${feedback}]\nOriginal Task:\n${state.task}`;
        
        const resumedConfig: WorkflowConfig = {
            paradigm: state.config.paradigm,
            agents: agents || [], // Passed in on hydration
            maxRetries: 1
        };

        return this.executeWorkflow(resumedTask, resumedConfig, state.threadId);
    }
    
    private async runHierarchical(task: any, agents: BaseAgent[], threadId: string, blackboard: Record<string, any>) {
        // Find Manager
        const manager = agents.find(a => a.card.role === 'MANAGER');
        if (!manager) throw new Error("Hierarchical paradigm requires a MANAGER agent.");

        // Execute task via Manager (which delegates to WORKERs internally)
        return await this.executeAgentTask(manager, task, threadId, blackboard);
    }

    private async runConsensus(task: any, agents: BaseAgent[], threadId: string, blackboard: Record<string, any>) {
        // Using WBFT to achieve robust agreement over hallucination
        const validVoters = agents.filter(a => a.card.role === 'CRITIC' || a.card.role === 'WORKER');
        
        // Pass blackboard to voter context if possible (WBFT would need update to support blackboard context)
        const finalAnswer = await this.wbft.reachConsensus(task, validVoters, threadId);
        
        return { 
            consensusReached: true, 
            finalAnswer 
        };
    }

    private async runGraph(task: any, config: WorkflowConfig, threadId: string) {
        if (!config.edges) throw new Error("Edges must be defined for GRAPH paradigm.");
        const blackboard = config.blackboard || {};
        
        let currentState = task;
        const executionPlan = config.edges;
        let executed = new Set<string>();
        let currentAgentId: string | null = executionPlan.length > 0 ? executionPlan[0].from : null;
        
        // Hydrate from checkpointer if possible
        const checkpoint = await globalCheckpointer.getLatestCheckpoint(threadId);
        if (checkpoint && checkpoint.stepId && checkpoint.stepId.startsWith('graph_step_')) {
            currentState = checkpoint.state.currentState;
            checkpoint.state.executed.forEach((ex: string) => executed.add(ex));
            currentAgentId = checkpoint.state.currentAgentId;
            const cleanBlackboard = JSON.parse(JSON.stringify(checkpoint.state.blackboard || {}));
            Object.assign(blackboard, cleanBlackboard);
            console.log(`[Checkpointer] Resuming GRAPH at agent: ${currentAgentId}`);
        }
        
        const agentMap = new Map(config.agents.map(a => [a.card.id, a]));
        
        while (currentAgentId) {
            const agent = agentMap.get(currentAgentId);
            if (agent && !executed.has(currentAgentId)) {
                currentState = await this.executeAgentTask(agent, currentState, threadId, blackboard);
                executed.add(currentAgentId);
                
                const nextEdge = executionPlan.find(e => e.from === currentAgentId);
                const nextAgentId = nextEdge ? nextEdge.to : null;

                // Checkpoint loop step
                await globalCheckpointer.saveCheckpoint(threadId, `graph_step_${currentAgentId}`, {
                    currentState,
                    executed: Array.from(executed),
                    currentAgentId: nextAgentId,
                    blackboard
                });
                
                currentAgentId = nextAgentId;
            } else {
                // Find next node
                const nextEdge = executionPlan.find(e => e.from === currentAgentId);
                currentAgentId = nextEdge ? nextEdge.to : null;
            }
            
            if (currentAgentId && executed.has(currentAgentId)) {
                break; // avoid basic loops in this naive implementation
            }
        }
        
        return { graphCompleted: true, finalState: currentState };
    }

    private async runEventDriven(task: any, config: WorkflowConfig, threadId: string) {
        if (!config.events) throw new Error("Events configuration required for EVENT_DRIVEN.");
        const blackboard = config.blackboard || {};
        const agentMap = new Map(config.agents.map(a => [a.card.id, a]));
        
        let resultState = task;
        
        // Simulating an event loop for maxIterations
        const startEvent = 'START_EVENT';
        let eventQueue: string[] = [startEvent];
        const iterations = config.maxIterations || 5;
        let currentIteration = 0;

        // Hydrate from checkpointer if possible
        const checkpoint = await globalCheckpointer.getLatestCheckpoint(threadId);
        if (checkpoint && checkpoint.stepId && checkpoint.stepId.startsWith('event_step_')) {
            resultState = checkpoint.state.resultState;
            eventQueue = checkpoint.state.eventQueue;
            currentIteration = checkpoint.state.currentIteration;
            const cleanBlackboard = JSON.parse(JSON.stringify(checkpoint.state.blackboard || {}));
            Object.assign(blackboard, cleanBlackboard);
            console.log(`[Checkpointer] Resuming EVENT_DRIVEN at iteration: ${currentIteration}`);
        }
        
        for (let i = currentIteration; i < iterations && eventQueue.length > 0; i++) {
            const currentEvent = eventQueue.shift()!;
            const listeners = config.events[currentEvent] || [];
            
            // Enforce priority ordering for event listeners
            const prioritizedListeners = config.agents
                .filter(a => listeners.includes(a.card.id))
                .map(a => a.card.id);
            
            for (const agentId of prioritizedListeners) {
                const agent = agentMap.get(agentId);
                if (agent) {
                    const response = await this.executeAgentTask(agent, `Handle event ${currentEvent} given state: ${resultState}`, threadId, blackboard);
                    resultState = `${resultState}\n[${agentId} response]: ${response}`;
                    
                    // Naively extract any emitted events from the response
                    if (response.includes('EMIT_FINISH')) {
                        return { status: 'success', finalState: resultState };
                    } else if (response.includes('EMIT_NEXT')) {
                        eventQueue.push('NEXT_EVENT');
                    }
                }
            }

            // Checkpoint state
            await globalCheckpointer.saveCheckpoint(threadId, `event_step_${i}`, {
                resultState,
                eventQueue,
                currentIteration: i + 1,
                blackboard
            });
        }
        
        return { status: 'completed_or_max_iterations', finalState: resultState };
    }

    private async runSwarm(task: any, agents: BaseAgent[], threadId: string, blackboard: Record<string, any>) {
        // Run all WORKER agents concurrently on the same task
        const workers = agents.filter(a => a.card.role === 'WORKER');
        if (workers.length === 0) throw new Error("SWARM requires at least one WORKER agent");

        const promises = workers.map(worker => this.executeAgentTask(worker, task, threadId, blackboard).then(res => ({
            agentId: worker.card.id,
            result: res
        })).catch(err => ({
            agentId: worker.card.id,
            error: err.message
        })));

        const results = await Promise.all(promises);
        
        // Find a MANAGER if present, to synthesize the swarm results
        const manager = agents.find(a => a.card.role === 'MANAGER');
        if (manager) {
            const summaryTask = `Swarm agents produced the following results:\n${JSON.stringify(results, null, 2)}\n\nPlease synthesize them into a final answer for: ${task}`;
            const finalResult = await this.executeAgentTask(manager, summaryTask, threadId, blackboard);
            return { rawSwarmResults: results, synthesized: finalResult };
        }

        return { rawSwarmResults: results };
    }

    /**
     * Decentralized SWARM: Agents autonomously collaborate via the blackboard.
     * No central manager; the collective intelligence reaches stabilization.
     */
    private async runDecentralizedSwarm(task: any, agents: BaseAgent[], threadId: string, blackboard: Record<string, any>, maxIterations = 5) {
        let currentStatus = 'Active';
        let iterations = 0;
        
        // Hydrate from checkpointer if possible
        const checkpoint = await globalCheckpointer.getLatestCheckpoint(threadId);
        if (checkpoint && checkpoint.stepId && checkpoint.stepId.startsWith('swarm_step_')) {
            currentStatus = checkpoint.state.currentStatus;
            iterations = checkpoint.state.iterations;
            const cleanBlackboard = JSON.parse(JSON.stringify(checkpoint.state.blackboard || {}));
            Object.assign(blackboard, cleanBlackboard);
            console.log(`[Checkpointer] Resuming DECENTRALIZED_SWARM at iteration: ${iterations}`);
        } else {
            // Initialize blackboard with task if empty
            if (!blackboard.objective) blackboard.objective = task;
            if (!blackboard.contributions) blackboard.contributions = [];
        }

        while (currentStatus === 'Active' && iterations < maxIterations) {
            iterations++;
            
            // In a decentralized swarm, agents are often triggered by state changes or specialized for sub-tasks.
            // For this implementation, we allow all agents to check the blackboard and contribute if they see value.
            for (const agent of agents) {
                const swarmPrompt = `
[DECENTRALIZED_SWARM_MODE]
Objective: ${blackboard.objective}
Current Collective State: ${JSON.stringify(blackboard.contributions.slice(-3))}

Agent ${agent.card.name}, evaluate the current state.
1. If you can improve the solution or add a new dimension, provide your contribution.
2. If the solution is complete and optimal, return EXACTLY "SIGNAL_STABILIZATION".
3. If you have nothing more to add but others might, return "NO_CHANGE".
`;
                const response = await this.executeAgentTask(agent, swarmPrompt, threadId, blackboard);
                
                if (response === 'SIGNAL_STABILIZATION') {
                    currentStatus = 'Stabilized';
                    break;
                }
                
                if (response !== 'NO_CHANGE') {
                    blackboard.contributions.push({
                        agentId: agent.card.id,
                        agentName: agent.card.name,
                        contribution: response,
                        timestamp: Date.now()
                    });
                }
            }
            
            await globalCheckpointer.saveCheckpoint(threadId, `swarm_step_${iterations}`, {
                currentStatus,
                iterations,
                blackboard: JSON.parse(JSON.stringify(blackboard)) // Deep copy snapshot
            });
            
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'ORCHESTRATOR',
                threadId,
                payload: { 
                    action: 'SWARM_ITERATION_COMPLETE', 
                    iteration: iterations, 
                    status: currentStatus,
                    blackboard: JSON.parse(JSON.stringify(blackboard)) // Deep copy snapshot
                }
            });
        }

        return {
            status: currentStatus,
            iterations,
            finalSolution: blackboard.contributions
        };
    }

    private async runDebate(task: any, agents: BaseAgent[], threadId: string, maxIterations?: number, blackboard?: Record<string, any>) {
        if (agents.length < 2) throw new Error("DEBATE requires at least two agents.");
        const debateRounds = maxIterations || 2;
        let context = `Topic for Debate: ${task}\n\n`;
        
        for (let i = 0; i < debateRounds; i++) {
            context += `--- Round ${i + 1} ---\n`;
            for (const agent of agents) {
                // Ensure the agent is an active participant
                if (agent.card.role === 'MANAGER' || agent.card.role === 'JUDGE') continue;
                
                const debatePrompt = `${context}\n\nAgent ${agent.card.name}, based on the discussion above, present your argument or critique previous statements. Format your response clearly.`;
                let response = await this.executeAgentTask(agent, debatePrompt, threadId, blackboard);
                if (typeof response === 'object' && response.text) response = response.text;
                
                context += `[${agent.card.name}]: ${response}\n\n`;
            }
        }
        
        // Find a MANAGER or JUDGE to synthesize the debate
        const judge = agents.find(a => a.card.role === 'MANAGER' || a.card.role === 'JUDGE');
        if (judge) {
            const summaryTask = `The following debate occurred:\n${context}\n\nPlease analyze the arguments and provide a final concluded verdict.`;
            let finalVerdict = await this.executeAgentTask(judge, summaryTask, threadId, blackboard);
            return {
                debateTranscript: context,
                finalVerdict
            };
        }
        
        return {
            debateTranscript: context,
            finalVerdict: "No judge assigned to provide final verdict."
        };
    }

    private async runMapReduce(task: any, agents: BaseAgent[], threadId: string, blackboard: Record<string, any>) {
        const planner = agents.find(a => a.card.role === 'PLANNER');
        if (!planner) throw new Error("MAP_REDUCE requires a PLANNER agent");

        const workers = agents.filter(a => a.card.role === 'WORKER');
        if (workers.length === 0) throw new Error("MAP_REDUCE requires at least one WORKER agent");

        // 1. Plan Phase
        const dag = await this.executeAgentTask(planner, task, threadId, blackboard);
        
        if (!dag || !dag.subtasks || !Array.isArray(dag.subtasks)) {
            throw new Error(`Invalid DAG structure returned by PLANNER`);
        }

        // 2. Map Phase (Fan-out)
        const subtasks = dag.subtasks;
        const taskResults = new Map<string, any>();
        
        // Very basic DAG runner (naively loops until all tasks are done or deadlocks)
        let pending = [...subtasks];
        
        while (pending.length > 0) {
            // Find tasks whose dependencies are met
            const readyTasks = pending.filter(st => 
                !st.dependencies || st.dependencies.every((dep: string) => taskResults.has(dep))
            );

            if (readyTasks.length === 0) {
                throw new Error("Deadlock detected in Planner DAG dependencies.");
            }

            // Execute ready tasks in parallel
            const promises = readyTasks.map(async (st) => {
                // Select a worker
                const worker = workers[Math.floor(Math.random() * workers.length)];
                
                // Embed context from dependencies
                let context = '';
                if (st.dependencies && st.dependencies.length > 0) {
                    context = '\nContext from dependencies:\n' + st.dependencies.map((dep: string) => `[${dep}]: ${JSON.stringify(taskResults.get(dep))}`).join('\n');
                }
                
                const execTask = `${st.description}${context}`;
                const result = await this.executeAgentTask(worker, execTask, threadId, blackboard);
                return { id: st.id, result };
            });

            const completed = await Promise.all(promises);
            for (const { id, result } of completed) {
                taskResults.set(id, result);
            }

            // Remove completed tasks from pending
            pending = pending.filter(st => !completed.find(c => c.id === st.id));
        }

        // 3. Reduce Phase
        const manager = agents.find(a => a.card.role === 'MANAGER') || planner;
        
        const reduceTask = `Objective: ${task}\n\nMap Results:\n${Array.from(taskResults.entries()).map(([id, res]) => `[Task ${id}]: ${JSON.stringify(res)}`).join('\n')}\n\nPlease synthesize the final answer.`;
        
        const finalAnswer = await this.executeAgentTask(manager, reduceTask, threadId, blackboard);
        
        return {
            plan: dag,
            mapResults: Object.fromEntries(taskResults),
            finalAnswer
        };
    }

    private async runMOA(task: any, agents: BaseAgent[], threadId: string, blackboard?: Record<string, any>): Promise<any> {
        console.log(`[ORCHESTRATOR] Initializing MOA (Mixture of Agents) for thread: ${threadId}`);
        
        // 1. Layer 1: Parallel Generation
        const layer1Agents = agents.filter(a => a.card.role !== 'MANAGER');
        if (layer1Agents.length === 0) throw new Error("MOA requires at least one non-MANAGER agent for Layer 1");

        const layer1Promises = layer1Agents.map(async (a) => {
            try {
                const result = await this.executeAgentTask(a, task, threadId, blackboard);
                return { name: a.card.name, status: 'SUCCESS', result };
            } catch (err: any) {
                console.warn(`[MOA] Expert ${a.card.name} failed: ${err.message}`);
                return { name: a.card.name, status: 'FAILED', error: err.message };
            }
        });

        const layer1Results = await Promise.all(layer1Promises);

        // 2. Layer 2: Synthesis (Manager)
        const manager = agents.find(a => a.card.role === 'MANAGER') || agents[0];
        const synthesisPrompt = `
Objective: ${task}
Combined Agent Intelligence (Layer 1):
${layer1Results.map((res) => `[Agent ${res.name}]: ${res.status === 'SUCCESS' ? JSON.stringify(res.result) : `CRITICAL_FAILURE: ${res.error}`}`).join('\n\n')}

Task: Synthesize, distill, and improve upon the Layer 1 outputs to produce the single most optimal response. 
IMPORTANT: If an agent failed (CRITICAL_FAILURE), do not ignore it. Acknowledge the gap in intelligence and provide a safe, conservative recommendation for that specific area.
`;
        return this.executeAgentTask(manager, synthesisPrompt, threadId, blackboard);
    }

    private async executeAgentTask(agent: BaseAgent, task: any, threadId: string, blackboard?: Record<string, any>): Promise<any> {
        // --- RELIABILITY: CYCLE DETECTION ---
        const chain = this.activeDependencyChains.get(threadId) || [];
        
        const chainCount = chain.filter(c => c === agent.card.id).length;
        if (chainCount > 100) {
            const deadlockError = `Conversational Deadlock Detected: Agent ${agent.card.id} is deeply nested or overloaded.`;
            globalEventStore.append({ type: 'ERROR_THROWN', sourceAgentId: 'ORCHESTRATOR', threadId, payload: { error: deadlockError } });
            throw new Error(deadlockError);
        }
        
        if (chain.length >= this.MAX_CONVERSATIONAL_DEPTH) {
            throw new Error(`Maximum conversational depth reached (${this.MAX_CONVERSATIONAL_DEPTH}). Terminating branch for reliability.`);
        }

        this.activeDependencyChains.set(threadId, [...chain, agent.card.id]);
        
        const useDistributedQueue = blackboard?._useDistributedQueue === true;
        
        try {
            if (useDistributedQueue) {
                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'ORCHESTRATOR',
                    threadId,
                    payload: { from: 'Local', to: 'QueueBroker', message: `Dispatching to Distributed Queue for ${agent.card.name}` }
                });

                const publishPromise = globalQueueBroker.publish({
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
                    globalEventStore.append({
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
                    currentTask.blackboard = blackboard; // Internal objects are trusted
                }
            }

            try {
                try {
                    currentTask = await globalPluginRegistry.emitBeforeAgentExecute(agent.card.id, currentTask, threadId);
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
                    tenantId: blackboard?._tenantId || 'GLOBAL', 
                    agentId: agent.card.id,
                    threadId,
                    capabilities: agent.card.capabilities
                };
                
                const { runWithContext } = await import('../core/ExecutionContext.ts');

                // --- RELIABILITY: TIMEOUT WRAPPER ---
                let result = await globalCircuitBreaker.execute(async () => {
                    return await runWithContext(contextConfig, async () => {
                        return await agent.execute(currentTask, threadId);
                    });
                }, undefined, this.MAX_SILENCE_TIMEOUT_MS);
                
                result = await globalPluginRegistry.emitAfterAgentExecute(agent.card.id, currentTask, result, threadId);
                
                const duration = Date.now() - startTime;
                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: agent.card.id,
                    threadId,
                    payload: { action: 'AGENT_EXECUTION_COMPLETED', duration, status: 'SUCCESS' }
                });

                await this.consolidateAgentLearning(agent, currentTask, result, null, threadId);
                return result;
            } catch (error: any) {
                const duration = Date.now() - startTime;
                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: agent.card.id,
                    threadId,
                    payload: { action: 'AGENT_EXECUTION_COMPLETED', duration, status: 'FAILED', error: error.message }
                });

                const recovery = await globalPluginRegistry.emitOnAgentFault(agent.card.id, error, currentTask, threadId);
                if (recovery && recovery.recovered) {
                    return recovery.result;
                }
                await this.consolidateAgentLearning(agent, currentTask, null, error, threadId);
                throw error;
            }
        } finally {
            // Pop from dependency chain when execution (successful or failed) finishes
            const currentChain = this.activeDependencyChains.get(threadId) || [];
            this.activeDependencyChains.set(threadId, currentChain.filter(id => id !== agent.card.id));
        }
    }

    private async consolidateAgentLearning(agent: BaseAgent, task: any, result: any, error: any, threadId: string) {
        try {
            const systemPrompt = "You are a cognitive consolidator. Extract actionable procedural rules from task outcomes.";
            const messages = [{ 
                role: 'user', 
                content: `Task: ${JSON.stringify(task).substring(0, 500)}\nOutcome: ${error ? 'FAILED with error: ' + error.message : 'SUCCEEDED with result: ' + JSON.stringify(result).substring(0, 500)}\n\nIf there is a meaningful lesson (e.g., fixing an error, successful strategy), extract it as a procedural rule. Format: "When attempting to [action], if [condition], you should [strategy]." If this is a routine success or there is no actionable learning, you MUST return exactly "NO_LEARNING".`
            }];
            
            const policyConfig = { ...agent.llmConfig, tier: 'POLICY' as const };
            const response = await globalCircuitBreaker.execute(async () => {
                return await ProviderRegistry.generate(policyConfig, systemPrompt, messages);
            }, async () => ({ text: 'NO_LEARNING', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }));
            
            if (response.text && !response.text.includes('NO_LEARNING')) {
                await agent.memory.addProceduralMemory(response.text, 'AGENT_LEARNING');
                
                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'ORCHESTRATOR',
                    threadId,
                    payload: { action: 'CONSOLIDATED_LEARNING', rule: response.text }
                });
            }
        } catch (err) {
            console.warn("Learning consolidation failed", err);
        }
    }
}
