import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';
import fs from 'fs';

const mem = new MemoryMesh();
const llmConfig = { useNativeREST: false, apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', provider: 'deepseek' };

const worker1 = new WorkerAgent('Worker1', 'Copywriter', 'WORKER', mem, llmConfig);

globalRegistry.register(worker1);

async function run() {
    console.log("STARTING WORKFLOW RUN 1");
    // Single agent execution, no orchestration map-reduce overhead required.
    try {
        const complexRequirement = `You are a copywriter. Create a comprehensive product description for a new fictional tech gadget called the 'NeuroLens' - AR glasses that translate visual input into emotional insights.`;

        console.log("... [Worker1] Executing single task ...");
        const res = await worker1.execute(complexRequirement, "thread_run1");
        
        fs.writeFileSync('complex_result_run1.json', JSON.stringify(res, null, 2));
        console.log("SUCCESS: Result written to complex_result_run1.json");
    } catch (e: any) {
        console.error("FAILED:", e);
    }
    process.exit(0);
}

run();
