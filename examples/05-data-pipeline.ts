import { MemoryMesh } from '../src/framework/memory/MemoryMesh.ts';
import { Orchestrator } from '../src/framework/orchestration/Orchestrator.ts';
import { ManagerAgent } from '../src/framework/agents/ManagerAgent.ts';
import { PlannerAgent } from '../src/framework/agents/PlannerAgent.ts';
import { WorkerAgent } from '../src/framework/agents/WorkerAgent.ts';
import type { LLMConfig } from '../src/framework/llm/ProviderRegistry.ts';

const memory = new MemoryMesh({ tenantId: 'examples', namespace: 'data-pipeline' });
const llmConfig: LLMConfig = {
  apiKey: process.env.GEMINI_API_KEY ?? 'SIMULATION_ONLY',
  modelName: process.env.LLM_MODEL ?? 'gemini-2.5-flash'
};

const planner = new PlannerAgent('Pipeline Planner', 'Split log-analysis work into a small DAG.', 'PLANNER', memory, llmConfig);
const parser = new WorkerAgent('Log Parser', 'Extract timestamp, latency, and error code from raw logs.', 'WORKER', memory, llmConfig, ['log parsing']);
const aggregator = new WorkerAgent('Log Aggregator', 'Summarize errors and latency statistics.', 'WORKER', memory, llmConfig, ['aggregation']);
const manager = new ManagerAgent('Pipeline Manager', 'Synthesize the final operational health summary.', 'MANAGER', memory, llmConfig);

const orchestrator = new Orchestrator();

async function run() {
  const logs = [
    '2026-05-17T14:22:10Z [INFO] GET /api/v1/users 120ms',
    '2026-05-17T14:22:15Z [ERROR] POST /api/v1/login 500 Network Timeout',
    '2026-05-17T14:22:18Z [INFO] GET /dashboard 45ms'
  ];

  const insights = await orchestrator.executeWorkflow(
    { objective: 'Generate a health summary JSON from these raw logs.', logs },
    {
      paradigm: 'MAP_REDUCE',
      agents: [planner, parser, aggregator, manager],
      enableLearning: false
    },
    'example-data-pipeline'
  );

  console.log('Health summary:\n', insights);
}

void run();
