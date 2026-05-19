import { BaseAgent } from '../src/framework/agents/BaseAgent.ts';
import { Orchestrator, WorkflowConfig } from '../src/framework/orchestration/Orchestrator.ts';
import { MemoryMesh } from '../src/framework/memory/MemoryMesh.ts';
import { PluginRegistry } from '../src/framework/core/PluginRegistry.ts';
import { getExecutionContext } from '../src/framework/core/ExecutionContext.ts';

class EchoManagerAgent extends BaseAgent {
  async execute(task: any, threadId: string): Promise<any> {
    const ctx = getExecutionContext();
    return {
      task,
      threadId,
      tenantId: ctx.tenantId,
      agentId: ctx.agentId
    };
  }
}

async function testRuntimePluginAndTenantScope() {
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.register({
    name: 'RuntimeScopeTestPlugin',
    version: '1.0.0',
    async beforeAgentExecute(agentId, task) {
      return `${task} :: scoped-plugin`;
    }
  });

  const manager = new EchoManagerAgent(
    'ScopedManager',
    'Echoes task and runtime context.',
    'MANAGER',
    new MemoryMesh(),
    { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
    [],
    undefined,
    undefined,
    undefined,
    'scoped-manager'
  );

  const config: WorkflowConfig = {
    paradigm: 'HIERARCHICAL',
    agents: [manager],
    maxRetries: 0
  };

  const result = await new Orchestrator({
    tenantId: 'tenant-runtime-test',
    pluginRegistry
  }).executeWorkflow('original-task', config, `RUNTIME_CTX_${Date.now()}`);

  if (typeof result.task !== 'string' || !result.task.includes('original-task') || !result.task.endsWith(':: scoped-plugin')) {
    throw new Error(`Runtime plugin did not modify task: ${JSON.stringify(result)}`);
  }
  if (result.tenantId !== 'tenant-runtime-test') {
    throw new Error(`Execution context tenant was not scoped: ${JSON.stringify(result)}`);
  }
}

const tests = [
  ['runtime plugin and tenant scope', testRuntimePluginAndTenantScope]
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
