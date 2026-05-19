import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';
import { globalCheckpointer } from '../Checkpointer.ts';
import { WorkflowConfig } from '../Orchestrator.ts';

/**
 * Graph Paradigm: Defined execution edges between agents.
 */
export class GraphStrategy extends ParadigmStrategy {
    async run(task: any, agents: BaseAgent[], context: ParadigmContext, config: WorkflowConfig) {
        if (!config.edges || config.edges.length === 0) {
            throw new Error("GRAPH paradigm requires at least one execution edge.");
        }
        const blackboard = context.blackboard;
        const agentIds = new Set(agents.map(a => a.card.id));
        for (const edge of config.edges) {
            if (!agentIds.has(edge.from) || !agentIds.has(edge.to)) {
                throw new Error(`GRAPH edge references unknown agent: ${edge.from} -> ${edge.to}`);
            }
        }
        
        let currentState = task;
        const executionPlan = config.edges;
        let executed = new Set<string>();
        let results = new Map<string, any>();
        
        const checkpoint = await globalCheckpointer.getLatestCheckpoint(context.threadId);
        if (checkpoint && checkpoint.stepId && checkpoint.stepId.startsWith('graph_step_')) {
            currentState = checkpoint.state.currentState;
            checkpoint.state.executed.forEach((ex: string) => executed.add(ex));
            Object.entries(checkpoint.state.results || {}).forEach(([id, result]) => results.set(id, result));
            Object.assign(blackboard, checkpoint.state.blackboard || {});
            console.log(`[Checkpointer] Resuming GRAPH with ${executed.size} completed agents.`);
        }
        
        const agentMap = new Map(agents.map(a => [a.card.id, a]));
        const graphAgentIds = new Set<string>();
        const incoming = new Map<string, string[]>();
        for (const edge of executionPlan) {
            graphAgentIds.add(edge.from);
            graphAgentIds.add(edge.to);
            incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge.from]);
            if (!incoming.has(edge.from)) incoming.set(edge.from, incoming.get(edge.from) || []);
        }
        
        const pending = new Set([...graphAgentIds].filter(id => !executed.has(id)));
        while (pending.size > 0) {
            const readyAgents = [...pending].filter(agentId =>
                (incoming.get(agentId) || []).every(dependencyId => executed.has(dependencyId))
            );

            if (readyAgents.length === 0) {
                throw new Error("GRAPH execution deadlock detected. Check for cycles or unsatisfied dependencies.");
            }

            for (const agentId of readyAgents) {
                const agent = agentMap.get(agentId);
                if (!agent) throw new Error(`GRAPH agent not found: ${agentId}`);

                const dependencies = incoming.get(agentId) || [];
                const agentTask = dependencies.length > 0
                    ? `Original task: ${JSON.stringify(task)}\n\nUpstream Results:\n${dependencies.map(dep => `[${dep}]: ${JSON.stringify(results.get(dep))}`).join('\n')}`
                    : currentState;

                currentState = await context.executeAgentTask(agent, agentTask, context.threadId, blackboard);
                results.set(agentId, currentState);
                executed.add(agentId);
                pending.delete(agentId);
            
                await globalCheckpointer.saveCheckpoint(context.threadId, `graph_step_${agentId}`, {
                    currentState,
                    executed: Array.from(executed),
                    results: Object.fromEntries(results),
                    blackboard
                });
            }
        }

        if (executed.size === 0) {
            throw new Error("GRAPH execution completed without running any agents.");
        }
        
        return { graphCompleted: true, finalState: currentState, results: Object.fromEntries(results) };
    }
}
