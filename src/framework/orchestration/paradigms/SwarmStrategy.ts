import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';
import { globalCheckpointer } from '../Checkpointer.ts';

/**
 * Swarm Paradigm: Multiple workers collaborate on a task, synthesized by a manager.
 */
export class SwarmStrategy extends ParadigmStrategy {
    async run(task: any, agents: BaseAgent[], context: ParadigmContext) {
        const workers = agents.filter(a => a.card.role === 'WORKER');
        if (workers.length === 0) throw new Error("SWARM requires at least one WORKER agent");

        const checkpoint = await globalCheckpointer.getLatestCheckpoint(context.threadId);
        let results: any[] = [];
        if (checkpoint && checkpoint.stepId === 'swarm_fanout_complete') {
            results = checkpoint.state.results;
            console.log(`[Checkpointer] Resuming SWARM from fan-out results.`);
        } else {
            const promises = workers.map(worker => context.executeAgentTask(worker, task, context.threadId, context.blackboard).then(res => ({
                agentId: worker.card.id,
                result: res
            })).catch(err => ({
                agentId: worker.card.id,
                error: err.message
            })));

            results = await Promise.all(promises);
            await globalCheckpointer.saveCheckpoint(context.threadId, 'swarm_fanout_complete', { results, blackboard: context.blackboard });
        }
        
        const manager = agents.find(a => a.card.role === 'MANAGER');
        if (manager) {
            const summaryTask = `Swarm agents produced the following results:\n${JSON.stringify(results, null, 2)}\n\nPlease synthesize them into a final answer for: ${task}`;
            const finalResult = await context.executeAgentTask(manager, summaryTask, context.threadId, context.blackboard);
            return { rawSwarmResults: results, synthesized: finalResult };
        }

        return { rawSwarmResults: results };
    }
}
