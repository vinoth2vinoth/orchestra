import { MemoryMesh, Orchestrator, WorkerAgent, type LLMConfig } from '../src/framework/index.ts';

const memory = new MemoryMesh({ tenantId: 'examples', namespace: 'mcp-github' });
const llmConfig: LLMConfig = {
  apiKey: process.env.GEMINI_API_KEY ?? 'SIMULATION_ONLY',
  modelName: process.env.LLM_MODEL ?? 'gemini-2.5-flash'
};

const prReviewer = new WorkerAgent(
  'Senior PR Reviewer',
  'Review pull requests for security, correctness, and missing tests. Mention MCP tools only when they are configured by the host application.',
  'WORKER',
  memory,
  llmConfig,
  ['security_audit', 'api_integration']
);

const orchestrator = new Orchestrator();

async function run() {
  const result = await orchestrator.executeWorkflow(
    'Draft a pull request review checklist for a TypeScript framework change touching queue retries and audit logs.',
    {
      paradigm: 'SWARM',
      agents: [prReviewer],
      enableLearning: false
    },
    'example-mcp-github'
  );

  console.log('Review checklist:\n', result);
}

void run();
