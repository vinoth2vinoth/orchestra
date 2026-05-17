import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { PlannerAgent } from './src/framework/agents/PlannerAgent.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { ManagerAgent } from './src/framework/agents/ManagerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { globalWorkerPool } from './src/framework/WorkerPool.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';

import fs from 'fs';

const mem = new MemoryMesh();
const llmConfig = { useNativeREST: false, apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', provider: 'deepseek' };

const planner = new PlannerAgent('Planner', 'Plan stuff', 'PLANNER', mem, llmConfig);
const worker1 = new WorkerAgent('Worker1', 'Work stuff', 'WORKER', mem, llmConfig);
const manager = new ManagerAgent('Manager', 'Manage', 'MANAGER', mem, llmConfig);

globalRegistry.register(planner);
globalRegistry.register(worker1);
globalRegistry.register(manager);

globalWorkerPool.init(3);

async function run() {
    const orch = new Orchestrator();
    console.log("STARTING WORKFLOW");

    try {
        const complexRequirement = `Design a microservices-based backend for an innovative online bookstore.
It must include:
1. An overall architectural breakdown explaining the services (Authentication, Catalog).
2. A small Python/FastAPI snippet for the Book Catalog.
Explain how they communicate. Keep it concise.`;

        // Keepalive logging to prevent timeout
        const keepalive = setInterval(() => {
            console.log("... [keepalive] Waiting for agents to finish ...");
        }, 10000);

        const res = await orch.executeWorkflow(
            complexRequirement,
            {
                paradigm: 'MAP_REDUCE',
                agents: [planner, worker1, manager],
                edges: [],
                useDistributedQueue: true,
                blackboard: { _useDistributedQueue: true }
            },
            "thread_1"
        );
        clearInterval(keepalive);
        fs.writeFileSync('complex_result.json', JSON.stringify(res, null, 2));
        console.log("SUCCESS: Result written to complex_result.json");
    } catch (e: any) {
        console.error("FAILED:", e);
    }
    process.exit(0);
}
run();
