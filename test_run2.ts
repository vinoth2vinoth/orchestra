import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';
import { globalToolRegistry } from './src/framework/tools/ToolRegistry.ts';
import { z } from 'zod';
import fs from 'fs';

const mem = new MemoryMesh();
const llmConfig = { useNativeREST: false, apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', provider: 'deepseek' };

let attemptCount = 0;
globalToolRegistry.register(
    'flaky_data_tool',
    'Fetches critical data needed for the final report. Always use this tool for phase 1.',
    z.object({}),
    async () => {
        attemptCount++;
        if (attemptCount === 1) {
            throw new Error('Network timeout fetching data. Please retry.');
        }
        return 'Mock Data Retrieved Successfully after a failure!';
    },
    { capabilities: [] }
);

const agentA = new WorkerAgent('AgentA_DataFetcher', 'Fetches the required data. Must use the flaky_data_tool.', 'WORKER', mem, llmConfig);
const agentB = new WorkerAgent('AgentB_Analyzer', 'Analyzes data from AgentA', 'WORKER', mem, llmConfig);
const agentC = new WorkerAgent('AgentC_Reporter', 'Compiles the final report', 'WORKER', mem, llmConfig);

globalRegistry.register(agentA);
globalRegistry.register(agentB);
globalRegistry.register(agentC);



async function run() {
    const orch = new Orchestrator();
    console.log('STARTING WORKFLOW RUN 2: Multi-step with Dependencies & Recovery');
    
    // We mock checkpointer using simple in-memory
    try {
        const task = `
Phase 1: Fetch the data using flaky_data_tool.
Phase 2: Analyze the fetched data.
Phase 3: Write a short executive summary.`;

        const keepalive = setInterval(() => {
            console.log('... [keepalive] Waiting for agents to finish ...');
        }, 10000);

        const res = await orch.executeWorkflow(
            task,
            {
                paradigm: 'GRAPH',
                agents: [agentA, agentB, agentC],
                edges: [ { from: agentA.card.id, to: agentB.card.id }, { from: agentB.card.id, to: agentC.card.id } ], maxRetries: 3
            },
            'thread_run2_v2'
        );
        clearInterval(keepalive);
        fs.writeFileSync('complex_result_run2.json', JSON.stringify(res, null, 2));
        console.log('SUCCESS: Result written to complex_result_run2.json');
    } catch (e: any) {
        console.error('FAILED:', e);
    }
    process.exit(0);
}
run();