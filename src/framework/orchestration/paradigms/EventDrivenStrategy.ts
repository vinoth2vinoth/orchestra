import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';
import { globalCheckpointer } from '../Checkpointer.ts';
import { WorkflowConfig } from '../Orchestrator.ts';

/**
 * Event-Driven Paradigm: Agents respond to emitted events.
 */
export class EventDrivenStrategy extends ParadigmStrategy {
    async run(task: any, agents: BaseAgent[], context: ParadigmContext, config: WorkflowConfig) {
        if (!config.events) throw new Error("Events configuration required for EVENT_DRIVEN.");
        const blackboard = context.blackboard;
        const agentMap = new Map(agents.map(a => [a.card.id, a]));
        
        let resultState = task;
        const startEvent = 'START_EVENT';
        let eventQueue: string[] = [startEvent];
        const iterations = config.maxIterations || 5;
        let currentIteration = 0;

        const checkpoint = await globalCheckpointer.getLatestCheckpoint(context.threadId);
        if (checkpoint && checkpoint.stepId && checkpoint.stepId.startsWith('event_step_')) {
            resultState = checkpoint.state.resultState;
            eventQueue = checkpoint.state.eventQueue;
            currentIteration = checkpoint.state.currentIteration;
            Object.assign(blackboard, checkpoint.state.blackboard || {});
            console.log(`[Checkpointer] Resuming EVENT_DRIVEN at iteration: ${currentIteration}`);
        }
        
        for (let i = currentIteration; i < iterations && eventQueue.length > 0; i++) {
            const currentEvent = eventQueue.shift()!;
            const listeners = config.events[currentEvent] || [];
            
            const prioritizedListeners = agents
                .filter(a => listeners.includes(a.card.id))
                .map(a => a.card.id);
            
            for (const agentId of prioritizedListeners) {
                const agent = agentMap.get(agentId);
                if (agent) {
                    const response = await context.executeAgentTask(agent, `Handle event ${currentEvent} given state: ${resultState}`, context.threadId, blackboard);
                    resultState = `${resultState}\n[${agentId} response]: ${response}`;
                    
                    if (response.includes('EMIT_FINISH')) {
                        return { status: 'success', finalState: resultState };
                    } else if (response.includes('EMIT_NEXT')) {
                        eventQueue.push('NEXT_EVENT');
                    }
                }
            }

            await globalCheckpointer.saveCheckpoint(context.threadId, `event_step_${i}`, {
                resultState,
                eventQueue,
                currentIteration: i + 1,
                blackboard
            });
        }
        
        return { status: 'completed_or_max_iterations', finalState: resultState };
    }
}
