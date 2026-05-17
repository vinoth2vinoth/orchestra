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
    'flaky_verification_tool',
    'Verifies the marketing copy facts. Might fail, requiring a retry.',
    z.object({ copy: z.string() }),
    async ({ copy }) => {
        attemptCount++;
        if (attemptCount === 1) {
            throw new Error('Verification service timed out. Please retry.');
        }
        return 'FACT CHECK: PASSED. The claims in the copy are mathematically sound.';
    },
    { capabilities: [] }
);

const agentWriter = new WorkerAgent('Agent_Writer', 'Creative copywriter', 'WORKER', mem, llmConfig);
const agentEditor = new WorkerAgent('Agent_Editor', 'Editor who verifies logic using flaky_verification_tool', 'WORKER', mem, llmConfig);

globalRegistry.register(agentWriter);
globalRegistry.register(agentEditor);
globalRegistry.grantTool(agentEditor.card.id, 'flaky_verification_tool');

async function run() {
    const orch = new Orchestrator();
    console.log('STARTING WORKFLOW RUN 3: Multi-agent coordination with shared state and retries');
    
    try {
        const task = `Write a 2-sentence pitch for a quantum battery. Agent_Writer MUST provide the first draft. Agent_Editor MUST rewrite it and invoke the flaky_verification_tool. You MUST NOT return SIGNAL_STABILIZATION until the copy has been verified by the editor.`;

        const keepalive = setInterval(() => {
            console.log('... [keepalive] Waiting for swarm agents to stabilize ...');
        }, 10000);

        const res = await orch.executeWorkflow(
            task,
            {
                paradigm: 'DECENTRALIZED_SWARM',
                agents: [agentWriter, agentEditor],
                maxRetries: 3,
                maxIterations: 3,
                blackboard: {} // Shared state injected here
            },
            'thread_run3_v2'
        );
        clearInterval(keepalive);
        fs.writeFileSync('complex_result_run3.json', JSON.stringify(res, null, 2));
        console.log('SUCCESS: Result written to complex_result_run3.json');
    } catch (e: any) {
        console.error('FAILED:', e);
    }
    process.exit(0);
}
run();