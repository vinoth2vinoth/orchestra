import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { CriticAgent } from './src/framework/agents/CriticAgent.ts';
import { ManagerAgent } from './src/framework/agents/ManagerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';
import fs from 'fs';

const mem = new MemoryMesh();
const llmConfig = { useNativeREST: false, apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', provider: 'deepseek' };

const expert1 = new WorkerAgent('CreativeExpert', 'You provide highly creative, out-of-the-box sci-fi concepts.', 'WORKER', mem, llmConfig);
const expert2 = new WorkerAgent('TechnicalExpert', 'You provide strict, mathematically sound technical solutions and physics constraints.', 'WORKER', mem, llmConfig);
const expert3 = new CriticAgent('RiskAnalyst', 'You strictly analyze risks and potential downsides of proposals.', 'CRITIC', mem, llmConfig);
const manager = new ManagerAgent('Synthesizer', 'Synthesizes partial outputs from diverse experts into one holistic strategy.', 'MANAGER', mem, llmConfig);

globalRegistry.register(expert1);
globalRegistry.register(expert2);
globalRegistry.register(expert3);
globalRegistry.register(manager);

async function run() {
    const orch = new Orchestrator();
    console.log('STARTING WORKFLOW RUN 7: MOA (Mixture of Agents)');
    
    try {
        const task = 'Propose a system to generate renewable energy from orbital satellites. The solution must be highly creative, technically feasible, and practically safe.';

        const res = await orch.executeWorkflow(
            task,
            {
                paradigm: 'MOA',
                agents: [expert1, expert2, expert3, manager],
                maxRetries: 2,
                blackboard: {}
            },
            'thread_run7'
        );
        fs.writeFileSync('complex_result_run7.json', JSON.stringify(res, null, 2));
        console.log('SUCCESS: Result written to complex_result_run7.json');
    } catch (e: any) {
        console.error('FAILED:', e);
    }
    process.exit(0);
}
run();
