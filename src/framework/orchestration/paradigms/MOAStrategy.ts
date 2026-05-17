import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';
import { globalCheckpointer } from '../Checkpointer.ts';

/**
 * MOA Paradigm: Parallel experts generate outputs, manager synthesizes.
 */
export class MOAStrategy extends ParadigmStrategy {
    async run(task: any, agents: BaseAgent[], context: ParadigmContext) {
        const layer1Agents = agents.filter(a => a.card.role !== 'MANAGER');
        if (layer1Agents.length === 0) throw new Error("MOA requires at least one non-MANAGER agent for Layer 1");

        const checkpoint = await globalCheckpointer.getLatestCheckpoint(context.threadId);
        let layer1Results: any[] = [];
        if (checkpoint && checkpoint.stepId === 'moa_layer1_complete') {
            layer1Results = checkpoint.state.layer1Results;
            console.log(`[Checkpointer] Resuming MOA after Layer 1.`);
        } else {
            const layer1Promises = layer1Agents.map(async (a) => {
                try {
                    const result = await context.executeAgentTask(a, task, context.threadId, context.blackboard);
                    return { name: a.card.name, status: 'SUCCESS', result };
                } catch (err: any) {
                    console.warn(`[MOA] Expert ${a.card.name} failed: ${err.message}`);
                    return { name: a.card.name, status: 'FAILED', error: err.message };
                }
            });

            layer1Results = await Promise.all(layer1Promises);
            await globalCheckpointer.saveCheckpoint(context.threadId, 'moa_layer1_complete', { layer1Results, blackboard: context.blackboard });
        }

        const manager = agents.find(a => a.card.role === 'MANAGER') || agents[0];
        const synthesisPrompt = `
Objective: ${task}
Combined Agent Intelligence (Layer 1):
${layer1Results.map((res) => `[Agent ${res.name}]: ${res.status === 'SUCCESS' ? JSON.stringify(res.result) : `CRITICAL_FAILURE: ${res.error}`}`).join('\n\n')}

Task: Synthesize, distill, and improve upon the Layer 1 outputs to produce the single most optimal response. 
`;
        return context.executeAgentTask(manager, synthesisPrompt, context.threadId, context.blackboard);
    }
}
