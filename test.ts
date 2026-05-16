import { config } from 'dotenv';
import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { globalEventStore } from './src/framework/core/EventStore.ts';
import { ManagerAgent } from './src/framework/agents/ManagerAgent.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import './src/framework/tools/ExternalTools.ts';

config();

async function run() {
    const orchestrator = new Orchestrator();
    console.log("Executing task...");

    const memory = new MemoryMesh();
    const llmConfig = { apiKey: process.env.GEMINI_API_KEY || '' };

    const manager = new ManagerAgent('Director', 'Oversees the operation', 'MANAGER', memory, llmConfig);
    const worker1 = new WorkerAgent('Worker 1', 'Executor', 'WORKER', memory, llmConfig);
    worker1.card.capabilities = ['searchDatabase'];
    
    manager.subordinates.push(worker1);

    const result = await orchestrator.executeWorkflow(
        "Use the executeShellCommand tool to find out the contents of the current directory, then tell me what's inside.",
        { paradigm: 'HIERARCHICAL', agents: [manager, worker1] },
        "test-thread-10"
    );
    console.log("Result:", result);
}
run();
