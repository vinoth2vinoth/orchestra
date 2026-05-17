import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';

/**
 * Hierarchical Paradigm: A MANAGER agent coordinates and delegates to sub-agents.
 */
export class HierarchicalStrategy extends ParadigmStrategy {
    async run(task: any, agents: BaseAgent[], context: ParadigmContext) {
        const manager = agents.find(a => a.card.role === 'MANAGER');
        if (!manager) throw new Error("Hierarchical paradigm requires a MANAGER agent.");

        return await context.executeAgentTask(manager, task, context.threadId, context.blackboard);
    }
}
