import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';
import { globalCheckpointer } from '../Checkpointer.ts';
import { globalEventStore } from '../../core/EventStore.ts';

/**
 * Decentralized Swarm Paradigm: Agents autonomously collaborate via the blackboard.
 */
export class DecentralizedSwarmStrategy extends ParadigmStrategy {
    async run(task: any, agents: BaseAgent[], context: ParadigmContext) {
        const blackboard = context.blackboard;
        let currentStatus = 'Active';
        let iterations = 0;
        const maxIterations = 5; // Default from Orchestrator
        
        const checkpoint = await globalCheckpointer.getLatestCheckpoint(context.threadId);
        if (checkpoint && checkpoint.stepId && checkpoint.stepId.startsWith('swarm_step_')) {
            currentStatus = checkpoint.state.currentStatus;
            iterations = checkpoint.state.iterations;
            Object.assign(blackboard, checkpoint.state.blackboard || {});
            console.log(`[Checkpointer] Resuming DECENTRALIZED_SWARM at iteration: ${iterations}`);
        } else {
            if (!blackboard.objective) blackboard.objective = task;
            if (!blackboard.contributions) blackboard.contributions = [];
        }

        while (currentStatus === 'Active' && iterations < maxIterations) {
            iterations++;
            
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
                const response = await context.executeAgentTask(agent, swarmPrompt, context.threadId, blackboard);
                
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
            
            await globalCheckpointer.saveCheckpoint(context.threadId, `swarm_step_${iterations}`, {
                currentStatus,
                iterations,
                blackboard: JSON.parse(JSON.stringify(blackboard))
            });
            
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'ORCHESTRATOR',
                threadId: context.threadId,
                payload: { 
                    action: 'SWARM_ITERATION_COMPLETE', 
                    iteration: iterations, 
                    status: currentStatus,
                    blackboard: JSON.parse(JSON.stringify(blackboard))
                }
            });
        }

        return {
            status: currentStatus,
            iterations,
            finalSolution: blackboard.contributions
        };
    }
}
