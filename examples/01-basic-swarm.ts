import { MemoryMesh, Orchestrator, WorkerAgent, type LLMConfig } from '../src/framework/index.ts';

const memory = new MemoryMesh({ tenantId: 'examples', namespace: 'basic-swarm' });
const llmConfig: LLMConfig = {
  apiKey: process.env.GEMINI_API_KEY ?? 'SIMULATION_ONLY',
  modelName: process.env.LLM_MODEL ?? 'gemini-2.5-flash'
};

const researcher = new WorkerAgent('Researcher', 'Find factual information.', 'WORKER', memory, llmConfig, ['research']);
const analyst = new WorkerAgent('Analyst', 'Analyze data and find trends.', 'WORKER', memory, llmConfig, ['analysis']);
const writer = new WorkerAgent('Writer', 'Synthesize findings into a final report.', 'WORKER', memory, llmConfig, ['writing']);

const orchestrator = new Orchestrator();

async function run() {
  const result = await orchestrator.executeWorkflow(
    'Research the impact of quantum computing on modern cryptography, analyze timelines, and write a two-paragraph executive summary.',
    {
      paradigm: 'SWARM',
      agents: [researcher, analyst, writer],
      enableLearning: false
    },
    'example-basic-swarm'
  );

  console.log('\nFinal swarm output:\n', result);
}

void run();
