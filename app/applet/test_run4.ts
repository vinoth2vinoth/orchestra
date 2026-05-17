import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';
import fs from 'fs';

const mem = new MemoryMesh();
const llmConfig = { useNativeREST: false, apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', provider: 'deepseek' };

const triageAgent = new WorkerAgent('TriageAgent', 'Triages the incoming request. Must emit NEXT_EVENT.', 'WORKER', mem, llmConfig);
const resolverAgent = new WorkerAgent('ResolverAgent', 'Resolves the request. Must emit FINISH_EVENT.', 'WORKER', mem, llmConfig);

globalRegistry.register(triageAgent);
globalRegistry.register(resolverAgent);

async function run() {
    const orch = new Orchestrator();
    console.log('STARTING WORKFLOW RUN 4: Event-Driven Orchestration');
    
    try {
        const task = `A user has submitted a ticket.
If you are TriageAgent handling START_EVENT, reply with 'EMIT_NEXT' to trigger the next event.
If you are ResolverAgent handling NEXT_EVENT, reply with 'EMIT_FINISH' to complete the workflow.`;

        const keepalive = setInterval(() => {
            console.log('... [keepalive] Waiting for event loop to finish ...');
        }, 10000);

        const res = await orch.executeWorkflow(
            task,
            {
                paradigm: 'EVENT_DRIVEN',
                agents: [triageAgent, resolverAgent],
                events: {
                    'START_EVENT': [triageAgent.card.id],
                    'NEXT_EVENT': [resolverAgent.card.id],
                },
                maxRetries: 3,
                maxIterations: 5,
                blackboard: {} 
            },
            'thread_run4'
        );
        clearInterval(keepalive);
        fs.writeFileSync('complex_result_run4.json', JSON.stringify(res, null, 2));
        console.log('SUCCESS: Result written to complex_result_run4.json');
    } catch (e: any) {
        console.error('FAILED:', e);
    }
    process.exit(0);
}
run();
