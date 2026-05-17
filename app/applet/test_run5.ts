import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';
import fs from 'fs';

const mem = new MemoryMesh();
const llmConfig = { useNativeREST: false, apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', provider: 'deepseek' };

// We want consensus among workers
const agent1 = new WorkerAgent('Agent1', 'A worker responding to the prompt.', 'WORKER', mem, llmConfig);
const agent2 = new WorkerAgent('Agent2', 'A worker responding to the prompt.', 'WORKER', mem, llmConfig);
const agent3 = new WorkerAgent('Agent3', 'A worker responding to the prompt.', 'WORKER', mem, llmConfig);

globalRegistry.register(agent1);
globalRegistry.register(agent2);
globalRegistry.register(agent3);

async function run() {
    const orch = new Orchestrator();
    console.log('STARTING WORKFLOW RUN 5: WBFT Consensus');
    
    try {
        const task = `Return exactly "YELLOW" as your response. Do not include any other words or punctuation.`;

        const res = await orch.executeWorkflow(
            task,
            {
                paradigm: 'CONSENSUS',
                agents: [agent1, agent2, agent3],
                maxRetries: 3,
                blackboard: {}
            },
            'thread_run5'
        );
        fs.writeFileSync('complex_result_run5.json', JSON.stringify(res, null, 2));
        console.log('SUCCESS: Result written to complex_result_run5.json');
    } catch (e: any) {
        console.error('FAILED:', e);
    }
    process.exit(0);
}
run();
