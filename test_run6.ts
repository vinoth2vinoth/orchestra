import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { PlannerAgent } from './src/framework/agents/PlannerAgent.ts';
import { ManagerAgent } from './src/framework/agents/ManagerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';
import fs from 'fs';

const mem = new MemoryMesh();
const llmConfig = { useNativeREST: false, apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', provider: 'deepseek' };

const planner = new PlannerAgent('Planner', 'Breaks down complex problems into subtasks', 'PLANNER', mem, llmConfig);
const worker1 = new WorkerAgent('Worker_A', 'General worker', 'WORKER', mem, llmConfig);
const worker2 = new WorkerAgent('Worker_B', 'General worker', 'WORKER', mem, llmConfig);
const manager = new ManagerAgent('Manager', 'Synthesizes partial results into a final conclusion', 'MANAGER', mem, llmConfig);

globalRegistry.register(planner);
globalRegistry.register(worker1);
globalRegistry.register(worker2);
globalRegistry.register(manager);

async function run() {
    const orch = new Orchestrator();
    console.log('STARTING WORKFLOW RUN 6: MAP_REDUCE with dynamic DAG');
    
    try {
        const task = 'Calculate the total cost of a project with 3 independent phases: Phase A costs 500. Phase B costs double of Phase A. Phase C costs 300 + Phase B. Determine the final cost. (Plan should have 3 tasks to calculate A, B, and C, and Manager should sum them.)';

        const res = await orch.executeWorkflow(
            task,
            {
                paradigm: 'MAP_REDUCE',
                agents: [planner, worker1, worker2, manager],
                maxRetries: 1,
                blackboard: {}
            },
            'thread_run6'
        );
        fs.writeFileSync('complex_result_run6.json', JSON.stringify(res, null, 2));
        console.log('SUCCESS: Result written to complex_result_run6.json');
    } catch (e: any) {
        console.error('FAILED:', e);
    }
    process.exit(0);
}
run();