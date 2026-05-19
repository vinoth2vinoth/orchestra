import { MemoryMesh, Orchestrator, WorkerAgent, globalToolRegistry, type LLMConfig } from '../src/framework/index.ts';
import { z } from 'zod';

globalToolRegistry.register(
  'deployExampleService',
  'Deploy a named service to a production environment after human approval.',
  z.object({
    serviceName: z.string(),
    version: z.string()
  }),
  async ({ serviceName, version }) => `Deployment queued for ${serviceName}@${version}.`,
  { highRisk: true, capabilities: ['deployment_admin'] }
);

const memory = new MemoryMesh({ tenantId: 'examples', namespace: 'human-approval' });
const llmConfig: LLMConfig = {
  apiKey: process.env.GEMINI_API_KEY ?? 'SIMULATION_ONLY',
  modelName: process.env.LLM_MODEL ?? 'gemini-2.5-flash'
};

const devOpsAgent = new WorkerAgent(
  'DevOps Lead',
  'Handle deployment requests. Use the deployment tool only when explicitly requested.',
  'WORKER',
  memory,
  llmConfig,
  ['deployment_admin']
);

const orchestrator = new Orchestrator();

async function run() {
  const deploymentTask = await orchestrator.executeWorkflow(
    'Deploy backend-api version 8f9b2a to production.',
    {
      paradigm: 'SWARM',
      agents: [devOpsAgent],
      enableLearning: false
    },
    'example-human-approval'
  );

  console.log('Deployment workflow status:', deploymentTask);
}

void run();
