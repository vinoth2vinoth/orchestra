import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';
import { WorkflowConfig } from '../Orchestrator.ts';
import { ConfigurationError } from '../../core/ErrorHandler.ts';

/**
 * MapReduce Paradigm: Planner splits task, workers execute subtasks, manager synthesizes.
 */
export class MapReduceStrategy extends ParadigmStrategy {
    async run(task: any, agents: BaseAgent[], context: ParadigmContext, config?: WorkflowConfig) {
        const planner = agents.find(a => a.card.role === 'PLANNER');
        if (!planner) throw new ConfigurationError("MAP_REDUCE requires a PLANNER agent");

        const workers = agents.filter(a => a.card.role === 'WORKER');
        if (workers.length === 0) throw new ConfigurationError("MAP_REDUCE requires at least one WORKER agent");

        // 1. Plan Phase
        const plannerResult = await context.executeAgentTask(planner, task, context.threadId, context.blackboard);
        const dag = this.normalizePlannerResult(plannerResult);
        if (!dag || !dag.subtasks || !Array.isArray(dag.subtasks)) {
            throw new Error(`Invalid DAG structure returned by PLANNER`);
        }

        // 2. Map Phase (Fan-out)
        const subtasks = dag.subtasks;
        const taskResults = new Map<string, any>();
        
        const checkpoint = await context.checkpointer.getLatestCheckpoint(context.threadId);
        if (checkpoint && checkpoint.stepId === 'map_reduce_map_complete') {
            Object.entries(checkpoint.state.taskResults).forEach(([id, res]) => taskResults.set(id, res));
            console.log(`[Checkpointer] Resuming MAP_REDUCE after Map phase.`);
        } else {
            let pending = [...subtasks];
            while (pending.length > 0) {
                const readyTasks = pending.filter(st => 
                    !st.dependencies || st.dependencies.every((dep: string) => taskResults.has(dep))
                );

                if (readyTasks.length === 0) throw new Error("Deadlock detected in Planner DAG dependencies.");

                const promises = readyTasks.map(async (st) => {
                    const worker = this.selectWorkerForSubtask(workers, st);
                    let stContext = '';
                    if (st.dependencies && st.dependencies.length > 0) {
                        stContext = '\nContext from dependencies:\n' + st.dependencies.map((dep: string) => `[${dep}]: ${JSON.stringify(taskResults.get(dep))}`).join('\n');
                    }
                    const execTask = `Objective: ${task}\nSubtask: ${st.description}${stContext}`;
                    const result = await context.executeAgentTask(worker, execTask, context.threadId, context.blackboard);
                    return { id: st.id, result };
                });

                const completed = await Promise.all(promises);
                for (const { id, result } of completed) {
                    taskResults.set(id, result);
                }
                pending = pending.filter(st => !completed.find(c => c.id === st.id));
            }
            await context.checkpointer.saveCheckpoint(context.threadId, 'map_reduce_map_complete', {
                taskResults: Object.fromEntries(taskResults), 
                blackboard: context.blackboard 
            });
        }

        // 3. Reduce Phase
        const manager = agents.find(a => a.card.role === 'MANAGER') || planner;
        const reduceTask = `Objective: ${task}\n\nMap Results:\n${Array.from(taskResults.entries()).map(([id, res]) => `[Task ${id}]: ${JSON.stringify(res)}`).join('\n')}\n\nPlease synthesize the final answer.`;
        
        const finalAnswer = await context.executeAgentTask(manager, reduceTask, context.threadId, context.blackboard);
        
        return {
            plan: dag,
            mapResults: Object.fromEntries(taskResults),
            finalAnswer
        };
    }

    private selectWorkerForSubtask(workers: BaseAgent[], subtask: any): BaseAgent {
        const required = Array.isArray(subtask.requiredCapabilities) ? subtask.requiredCapabilities : [];
        if (required.length > 0) {
            const capable = workers.find(worker => required.some((cap: string) => worker.card.capabilities.includes(cap)));
            if (capable) return capable;
        }

        const description = `${subtask.description || ''}`.toLowerCase();
        const keywordMatch = workers.find(worker =>
            worker.card.capabilities.some(cap => description.includes(cap.toLowerCase().replace(/[_-]/g, ' ')))
        );
        if (keywordMatch) return keywordMatch;

        const id = `${subtask.id || subtask.description || ''}`;
        const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return workers[hash % workers.length];
    }

    private normalizePlannerResult(plannerResult: any): any {
        if (typeof plannerResult !== 'string') return plannerResult;
        try {
            return JSON.parse(plannerResult);
        } catch {
            const fenced = plannerResult.match(/```(?:json)?\s*([\s\S]*?)```/i);
            if (fenced?.[1]) {
                try {
                    return JSON.parse(fenced[1]);
                } catch {
                    return null;
                }
            }
            return null;
        }
    }
}
