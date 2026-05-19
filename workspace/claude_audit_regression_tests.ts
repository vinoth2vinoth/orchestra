import { Orchestrator, WorkflowConfig } from '../src/framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from '../src/framework/agents/WorkerAgent.ts';
import { MemoryMesh } from '../src/framework/memory/MemoryMesh.ts';
import { SimulationManager } from '../src/framework/core/SimulationManager.ts';
import { ConfigurationError } from '../src/framework/core/ErrorHandler.ts';

const memory = new MemoryMesh();
const llmConfig = { apiKey: 'SIMULATION_ONLY', modelName: 'gemini-2.5-flash' };

async function testSwarmStatus() {
  SimulationManager.enable();
  const worker = new WorkerAgent('SwarmWorker', 'Return a concise answer.', 'WORKER', memory, llmConfig, [], undefined, undefined, undefined, 'swarm-worker');
  const config: WorkflowConfig = {
    paradigm: 'SWARM',
    agents: [worker],
    maxRetries: 0
  };
  const result = await new Orchestrator().executeWorkflow('Say hello. GOAL_MET', config, `CLAUDE_SWARM_${Date.now()}`);
  if (result?.status !== 'Completed') {
    throw new Error(`SWARM did not return status=Completed: ${JSON.stringify(result)}`);
  }
}

async function testMapReduceConfigErrorNoBackoff() {
  const worker = new WorkerAgent('WorkerOnly', 'Return a concise answer.', 'WORKER', memory, llmConfig, [], undefined, undefined, undefined, 'worker-only');
  const config: WorkflowConfig = {
    paradigm: 'MAP_REDUCE',
    agents: [worker],
    maxRetries: 3
  };

  const start = Date.now();
  try {
    await new Orchestrator().executeWorkflow('This is invalid because there is no planner.', config, `CLAUDE_MAP_${Date.now()}`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    if (!(err instanceof ConfigurationError || err.name === 'ConfigurationError')) {
      throw new Error(`Expected ConfigurationError, got ${err.name}: ${err.message}`);
    }
    if (durationMs > 500) {
      throw new Error(`ConfigurationError was retried/backed off for ${durationMs}ms`);
    }
    return;
  }

  throw new Error('Expected MAP_REDUCE without PLANNER to fail.');
}

async function testGraphConfigErrorNoBackoff() {
  const worker = new WorkerAgent('GraphWorker', 'Return a concise answer.', 'WORKER', memory, llmConfig, [], undefined, undefined, undefined, 'graph-worker');
  const config: WorkflowConfig = {
    paradigm: 'GRAPH',
    agents: [worker],
    edges: [{ from: 'graph-worker', to: 'missing-agent' }],
    maxRetries: 3
  };

  const start = Date.now();
  try {
    await new Orchestrator().executeWorkflow('This graph references a missing agent.', config, `CLAUDE_GRAPH_${Date.now()}`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    if (!(err instanceof ConfigurationError || err.name === 'ConfigurationError')) {
      throw new Error(`Expected ConfigurationError, got ${err.name}: ${err.message}`);
    }
    if (durationMs > 500) {
      throw new Error(`Graph ConfigurationError was retried/backed off for ${durationMs}ms`);
    }
    return;
  }

  throw new Error('Expected GRAPH with an unknown edge endpoint to fail.');
}

const tests = [
  ['swarm status shape', testSwarmStatus],
  ['map-reduce config error no backoff', testMapReduceConfigErrorNoBackoff],
  ['graph config error no backoff', testGraphConfigErrorNoBackoff]
] as const;

const results = [];
for (const [name, run] of tests) {
  const start = Date.now();
  try {
    await run();
    results.push({ name, ok: true, ms: Date.now() - start });
  } catch (err: any) {
    results.push({ name, ok: false, error: err.message, ms: Date.now() - start });
  }
}

console.log(JSON.stringify(results, null, 2));
if (results.some(r => !r.ok)) process.exit(1);
