import { CriticAgent, MemoryMesh, Orchestrator, WorkerAgent, type LLMConfig } from '../src/framework/index.ts';

const memory = new MemoryMesh({ tenantId: 'examples', namespace: 'consensus-debate' });
const llmConfig: LLMConfig = {
  apiKey: process.env.GEMINI_API_KEY ?? 'SIMULATION_ONLY',
  modelName: process.env.LLM_MODEL ?? 'gemini-2.5-flash'
};

const growthLead = new WorkerAgent('Growth Lead', 'Prioritize speed and feature velocity.', 'WORKER', memory, llmConfig);
const securityAuditor = new WorkerAgent('Security Auditor', 'Prioritize risk reduction and release safety.', 'WORKER', memory, llmConfig);
const judge = new CriticAgent('Neutral Arbiter', 'Adjudicate trade-offs and produce a final decision.', 'JUDGE', memory, llmConfig);

const orchestrator = new Orchestrator();

async function run() {
  const decision = await orchestrator.executeWorkflow(
    'Should we remove the Redis cache and replace it with SQLite for local-first deployments?',
    {
      paradigm: 'CONSENSUS',
      agents: [growthLead, securityAuditor, judge],
      maxIterations: 3,
      enableLearning: false,
      blackboard: { proposalId: 'ARCH-1049' }
    },
    'example-consensus-debate'
  );

  console.log('Consensus decision:\n', decision);
}

void run();
