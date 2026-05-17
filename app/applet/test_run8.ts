import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';
import fs from 'fs';

const mem = new MemoryMesh();
const llmConfig = { useNativeREST: false, apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', provider: 'deepseek' };

const agent1 = new WorkerAgent('LifeSupport', 'You focus on oxygen, water, and food.', 'WORKER', mem, llmConfig);
const agent2 = new WorkerAgent('Energy', 'You focus on power generation and storage.', 'WORKER', mem, llmConfig);
const agent3 = new WorkerAgent('Structure', 'You focus on habitat shielding and structural integrity.', 'WORKER', mem, llmConfig);

globalRegistry.register(agent1);
globalRegistry.register(agent2);
globalRegistry.register(agent3);

async function run() {
    const orch = new Orchestrator();
    console.log('STARTING WORKFLOW RUN 8: DECENTRALIZED_SWARM');
    
    try {
        const task = `Design a basic 3-component survival architecture for a Mars colony. Each specialist should contribute their part. Once all three (Life Support, Energy, Structure) parts are listed in the 'Collective State', the next system MUST reply EXACTLY with "SIGNAL_STABILIZATION".`;

        const res = await orch.executeWorkflow(
            task,
            {
                paradigm: 'DECENTRALIZED_SWARM',
                agents: [agent1, agent2, agent3],
                maxRetries: 2,
                maxIterations: 3,
                blackboard: {}
            },
            'thread_run8'
        );
        fs.writeFileSync('complex_result_run8.json', JSON.stringify(res, null, 2));
        console.log('SUCCESS: Result written to complex_result_run8.json');
    } catch (e: any) {
        console.error('FAILED:', e);
    }
    process.exit(0);
}
run();
