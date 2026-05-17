import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';
import { globalCheckpointer } from '../Checkpointer.ts';
import { WorkflowConfig } from '../Orchestrator.ts';

/**
 * Graph Paradigm: Defined execution edges between agents.
 */
export class GraphStrategy extends ParadigmStrategy {
    async run(task: any, agents: BaseAgent[], context: ParadigmContext, config: WorkflowConfig) {
        if (!config.edges) throw new Error("Edges must be defined for GRAPH paradigm.");
        const blackboard = context.blackboard;
        
        let currentState = task;
        const executionPlan = config.edges;
        let executed = new Set<string>();
        let currentAgentId: string | null = executionPlan.length > 0 ? executionPlan[0].from : null;
        
        const checkpoint = await globalCheckpointer.getLatestCheckpoint(context.threadId);
        if (checkpoint && checkpoint.stepId && checkpoint.stepId.startsWith('graph_step_')) {
            currentState = checkpoint.state.currentState;
            checkpoint.state.executed.forEach((ex: string) => executed.add(ex));
            currentAgentId = checkpoint.state.currentAgentId;
            Object.assign(blackboard, checkpoint.state.blackboard || {});
            console.log(`[Checkpointer] Resuming GRAPH at agent: ${currentAgentId}`);
        }
        
        const agentMap = new Map(agents.map(a => [a.card.id, a]));
        
        while (currentAgentId) {
            const agent = agentMap.get(currentAgentId);
            if (agent && !executed.has(currentAgentId)) {
                currentState = await context.executeAgentTask(agent, currentState, context.threadId, blackboard);
                executed.add(currentAgentId);
                
                const nextEdge = executionPlan.find(e => e.from === currentAgentId);
                const nextAgentId = nextEdge ? nextEdge.to : null;

                await globalCheckpointer.saveCheckpoint(context.threadId, `graph_step_${currentAgentId}`, {
                    currentState,
                    executed: Array.from(executed),
                    currentAgentId: nextAgentId,
                    blackboard
                });
                
                currentAgentId = nextAgentId;
            } else {
                const nextEdge = executionPlan.find(e => e.from === currentAgentId);
                currentAgentId = nextEdge ? nextEdge.to : null;
            }
            
            if (currentAgentId && executed.has(currentAgentId)) break;
        }
        
        return { graphCompleted: true, finalState: currentState };
    }
}
