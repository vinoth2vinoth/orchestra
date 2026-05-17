import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { ManagerAgent } from './src/framework/agents/ManagerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';
import fs from 'fs';

const mem = new MemoryMesh();
const llmConfig = { useNativeREST: false, apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', provider: 'deepseek' };

const proponent = new WorkerAgent('Proponent', 'You argue fiercely FOR the proposition, finding every advantage.', 'WORKER', mem, llmConfig);
const opponent = new WorkerAgent('Opponent', 'You argue fiercely AGAINST the proposition, finding every flaw.', 'WORKER', mem, llmConfig);
const judge = new ManagerAgent('Judge', 'You weigh both sides objectively and declare a winner.', 'JUDGE', mem, llmConfig);

globalRegistry.register(proponent);
globalRegistry.register(opponent);
globalRegistry.register(judge);

async function run() {
    const orch = new Orchestrator();
    console.log('STARTING WORKFLOW RUN 9: DEBATE');
    
    try {
        const task = 'Proposition: Artificial Intelligence should be granted legal personhood.';

        const res = await orch.executeWorkflow(
            task,
            {
                paradigm: 'DEBATE',
                agents: [proponent, opponent, judge],
                maxRetries: 2,
                maxIterations: 2,
                blackboard: {}
            },
            'thread_run9'
        );
        fs.writeFileSync('complex_result_run9.json', JSON.stringify(res, null, 2));
        console.log('SUCCESS: Result written to complex_result_run9.json');
    } catch (e: any) {
        console.error('FAILED:', e);
    }
    process.exit(0);
}
run();