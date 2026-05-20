import { BaseAgent } from '../src/framework/agents/BaseAgent.ts';
import { ManagerAgent } from '../src/framework/agents/ManagerAgent.ts';
import { Orchestrator, WorkflowConfig } from '../src/framework/orchestration/Orchestrator.ts';
import { MemoryMesh } from '../src/framework/memory/MemoryMesh.ts';
import { PluginRegistry } from '../src/framework/core/PluginRegistry.ts';
import { getExecutionContext } from '../src/framework/core/ExecutionContext.ts';
import { StateStore, globalStateStore } from '../src/framework/orchestration/StateStore.ts';
import { WorkflowSuspendedError } from '../src/framework/orchestration/WorkflowSuspendedError.ts';
import type { CheckpointData } from '../src/framework/orchestration/Checkpointer.ts';
import type { FrameworkEvent } from '../src/framework/core/types.ts';
import { AgentRegistry } from '../src/framework/agents/AgentRegistry.ts';
import { z } from 'zod';

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

class BlackboardEchoAgent extends BaseAgent {
  async execute(task: any): Promise<any> {
    return {
      marker: task.blackboard?.marker,
      originalTaskMutated: Object.prototype.hasOwnProperty.call(task, 'blackboard')
    };
  }
}

class RecordingGraphAgent extends BaseAgent {
  public calls: any[] = [];

  constructor(id: string, private readonly answer: string) {
    super(
      id,
      `Records graph calls for ${id}.`,
      'WORKER',
      new MemoryMesh(),
      { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
      [],
      undefined,
      undefined,
      undefined,
      id
    );
  }

  async execute(task: any): Promise<any> {
    this.calls.push(task);
    return this.answer;
  }
}

class SuspendingAgent extends BaseAgent {
  constructor(id: string, private readonly approvalId: string) {
    super(
      id,
      `Suspends workflow for ${id}.`,
      'MANAGER',
      new MemoryMesh(),
      { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
      [],
      undefined,
      undefined,
      undefined,
      id
    );
  }

  async execute(): Promise<any> {
    throw new WorkflowSuspendedError(this.approvalId, { reason: 'runtime-state-store-test' });
  }
}

class RuntimeMutationAgent extends BaseAgent {
  async execute(): Promise<any> {
    this.mutate('runtime-scoped-patch');
    this.reset();
    this.hostTool('runtime_scoped_tool', {
      description: 'Runtime scoped test tool.',
      parameters: z.object({}),
      execute: async () => 'ok'
    });
    return 'runtime-mutated';
  }
}

class RecordingEventStore {
  public events: FrameworkEvent[] = [];

  append(event: Omit<FrameworkEvent, 'id' | 'timestamp'>): FrameworkEvent {
    const fullEvent = {
      ...event,
      id: `recording-event-${this.events.length + 1}`,
      timestamp: Date.now()
    } as FrameworkEvent;
    this.events.push(fullEvent);
    return fullEvent;
  }

  getEventsByThread(threadId: string): FrameworkEvent[] {
    return this.events.filter(event => event.threadId === threadId);
  }

  getLogs(): FrameworkEvent[] {
    return [...this.events];
  }

  clear() {
    this.events = [];
  }
}

class InMemoryCheckpointer {
  private checkpoints = new Map<string, CheckpointData>();

  async saveCheckpoint(threadId: string, stepId: string, state: any): Promise<void> {
    this.checkpoints.set(threadId, {
      threadId,
      stepId,
      state: JSON.parse(JSON.stringify(state)),
      timestamp: Date.now()
    });
  }

  async getLatestCheckpoint(threadId: string): Promise<CheckpointData | null> {
    return this.checkpoints.get(threadId) || null;
  }

  async clearCheckpoint(threadId: string): Promise<void> {
    this.checkpoints.delete(threadId);
  }
}

async function testWorkflowInjectsRuntimeIntoAgents() {
  const eventStore = new RecordingEventStore();
  const agent = new RuntimeMutationAgent(
    'RuntimeMutationAgent',
    'Mutates its own runtime scoped state.',
    'MANAGER',
    new MemoryMesh(),
    { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
    [],
    undefined,
    undefined,
    undefined,
    'runtime-mutation-agent'
  );

  const result = await new Orchestrator({ eventStore: eventStore as any }).executeWorkflow(
    'mutate runtime',
    {
      paradigm: 'HIERARCHICAL',
      agents: [agent],
      maxRetries: 0
    },
    `RUNTIME_AGENT_SCOPE_${Date.now()}`
  );

  if (result !== 'runtime-mutated') {
    throw new Error(`Runtime mutation agent returned unexpected result: ${JSON.stringify(result)}`);
  }

  const actions = eventStore.events.map(event => event.payload?.action);
  for (const action of ['INSTRUCTION_MUTATED', 'AGENT_STATE_RESET', 'TOOL_HOSTED_LOCALLY']) {
    if (!actions.includes(action)) {
      throw new Error(`Scoped event store missed ${action}: ${JSON.stringify(eventStore.events)}`);
    }
  }
}

async function testManagerUsesScopedAgentRegistryForToolGrant() {
  const scopedRegistry = new AgentRegistry();
  const manager = new ManagerAgent(
    'ScopedGrantManager',
    'Approves low-risk tool grants.',
    'MANAGER',
    new MemoryMesh(),
    { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
    [],
    undefined,
    undefined,
    undefined,
    'scoped-grant-manager'
  );
  const worker = new RuntimeMutationAgent(
    'ScopedGrantWorker',
    'Receives scoped tool grants.',
    'WORKER',
    new MemoryMesh(),
    { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
    [],
    undefined,
    undefined,
    undefined,
    'scoped-grant-worker'
  );

  scopedRegistry.register(manager);
  scopedRegistry.register(worker);
  manager.setSubordinates([worker]);
  manager.setRuntimeContext({ agentRegistry: scopedRegistry });

  const review = await manager.reviewResourceRequest(worker.card.id, 'discovery_index', 'Need local discovery access.', `RUNTIME_GRANT_${Date.now()}`);

  if (!review.authorized) {
    throw new Error(`Expected scoped manager auto-grant, got ${JSON.stringify(review)}`);
  }
  if (!worker.card.capabilities.includes('tool:discovery_index')) {
    throw new Error(`Scoped registry did not grant tool to worker: ${JSON.stringify(worker.card.capabilities)}`);
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

async function testTenantOnlyRuntimeGetsScopedAgentRegistry() {
  const tenantAAgent = new EchoManagerAgent(
    'TenantOnlyA',
    'Echoes tenant A.',
    'MANAGER',
    new MemoryMesh(),
    { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
    [],
    undefined,
    undefined,
    undefined,
    'tenant-only-agent'
  );
  const tenantBAgent = new EchoManagerAgent(
    'TenantOnlyB',
    'Echoes tenant B.',
    'MANAGER',
    new MemoryMesh(),
    { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
    [],
    undefined,
    undefined,
    undefined,
    'tenant-only-agent'
  );

  const configA: WorkflowConfig = {
    paradigm: 'HIERARCHICAL',
    agents: [tenantAAgent],
    maxRetries: 0,
    runtime: { tenantId: 'tenant-only-a' }
  };
  const configB: WorkflowConfig = {
    paradigm: 'HIERARCHICAL',
    agents: [tenantBAgent],
    maxRetries: 0,
    runtime: { tenantId: 'tenant-only-b' }
  };

  const [resultA, resultB] = await Promise.all([
    new Orchestrator().executeWorkflow('tenant-a-task', configA, `TENANT_ONLY_A_${Date.now()}`),
    new Orchestrator().executeWorkflow('tenant-b-task', configB, `TENANT_ONLY_B_${Date.now()}`)
  ]);

  if (resultA.tenantId !== 'tenant-only-a') {
    throw new Error(`Tenant-only workflow A used wrong runtime: ${JSON.stringify(resultA)}`);
  }
  if (resultB.tenantId !== 'tenant-only-b') {
    throw new Error(`Tenant-only workflow B used wrong runtime: ${JSON.stringify(resultB)}`);
  }
}

async function testRuntimeCheckpointerScope() {
  const threadId = `RUNTIME_CHECKPOINT_SHARED_${Date.now()}`;
  const scopedCheckpointerA = new InMemoryCheckpointer();
  const scopedCheckpointerB = new InMemoryCheckpointer();

  await scopedCheckpointerA.saveCheckpoint(threadId, 'graph_step_graph-a', {
    currentState: 'A_DONE_FROM_SCOPED_CHECKPOINT',
    executed: ['graph-a'],
    results: { 'graph-a': 'A_DONE_FROM_SCOPED_CHECKPOINT' },
    blackboard: { fromCheckpoint: true }
  });

  const agentAForRuntimeA = new RecordingGraphAgent('graph-a', 'A_SHOULD_NOT_RUN');
  const agentBForRuntimeA = new RecordingGraphAgent('graph-b', 'B_DONE_RUNTIME_A');
  const resultA = await new Orchestrator({ checkpointer: scopedCheckpointerA as any }).executeWorkflow(
    'start',
    {
      paradigm: 'GRAPH',
      agents: [agentAForRuntimeA, agentBForRuntimeA],
      edges: [{ from: 'graph-a', to: 'graph-b' }],
      maxRetries: 0,
      blackboard: {}
    } as WorkflowConfig,
    threadId
  );

  if (agentAForRuntimeA.calls.length !== 0) {
    throw new Error(`Runtime A should have resumed from scoped checkpoint without rerunning graph-a, got ${agentAForRuntimeA.calls.length}`);
  }
  if (resultA.results?.['graph-a'] !== 'A_DONE_FROM_SCOPED_CHECKPOINT') {
    throw new Error(`Runtime A did not use scoped checkpoint: ${JSON.stringify(resultA)}`);
  }

  const agentAForRuntimeB = new RecordingGraphAgent('graph-a', 'A_DONE_RUNTIME_B');
  const agentBForRuntimeB = new RecordingGraphAgent('graph-b', 'B_DONE_RUNTIME_B');
  const resultB = await new Orchestrator({ checkpointer: scopedCheckpointerB as any }).executeWorkflow(
    'start',
    {
      paradigm: 'GRAPH',
      agents: [agentAForRuntimeB, agentBForRuntimeB],
      edges: [{ from: 'graph-a', to: 'graph-b' }],
      maxRetries: 0,
      blackboard: {}
    } as WorkflowConfig,
    threadId
  );

  if (agentAForRuntimeB.calls.length !== 1) {
    throw new Error(`Runtime B should not see Runtime A checkpoint, got ${agentAForRuntimeB.calls.length} graph-a calls`);
  }
  if (resultB.results?.['graph-a'] !== 'A_DONE_RUNTIME_B') {
    throw new Error(`Runtime B used the wrong checkpoint state: ${JSON.stringify(resultB)}`);
  }
}

async function testRuntimeStateStoreScopeForSuspendedWorkflow() {
  const approvalId = `approval-runtime-${Date.now()}`;
  const scopedStore = new StateStore();
  await globalStateStore.deleteState(approvalId);

  const result = await new Orchestrator({ stateStore: scopedStore as any }).executeWorkflow(
    'needs approval',
    {
      paradigm: 'HIERARCHICAL',
      agents: [new SuspendingAgent('scoped-suspender', approvalId)],
      maxRetries: 0
    },
    `RUNTIME_STATE_STORE_${Date.now()}`
  );

  if (result.status !== 'SUSPENDED' || result.approvalId !== approvalId) {
    throw new Error(`Expected suspended workflow, got ${JSON.stringify(result)}`);
  }

  const scopedState = await scopedStore.getState(approvalId);
  if (!scopedState) {
    throw new Error('Scoped runtime state store did not receive suspended workflow state');
  }

  const globalState = await globalStateStore.getState(approvalId);
  if (globalState) {
    throw new Error(`Suspended workflow leaked into global state store: ${JSON.stringify(globalState)}`);
  }
}

async function testConcurrentWorkflowsDoNotMutateSharedTaskObject() {
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.register({
    name: 'ConcurrentTaskDelayPlugin',
    version: '1.0.0',
    async beforeAgentExecute(_agentId, task) {
      if (task?.requestId === 'shared-task') {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }
  });

  const sharedTask = { requestId: 'shared-task' };
  const agentA = new BlackboardEchoAgent(
    'TenantAManager',
    'Echoes tenant A blackboard.',
    'MANAGER',
    new MemoryMesh(),
    { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
    [],
    undefined,
    undefined,
    undefined,
    'tenant-a-manager'
  );
  const agentB = new BlackboardEchoAgent(
    'TenantBManager',
    'Echoes tenant B blackboard.',
    'MANAGER',
    new MemoryMesh(),
    { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
    [],
    undefined,
    undefined,
    undefined,
    'tenant-b-manager'
  );

  const configA: WorkflowConfig = {
    paradigm: 'HIERARCHICAL',
    agents: [agentA],
    maxRetries: 0,
    blackboard: { marker: 'tenant-a-only' },
    runtime: { pluginRegistry, tenantId: 'tenant-a' }
  };
  const configB: WorkflowConfig = {
    paradigm: 'HIERARCHICAL',
    agents: [agentB],
    maxRetries: 0,
    blackboard: { marker: 'tenant-b-only' },
    runtime: { pluginRegistry, tenantId: 'tenant-b' }
  };

  const [resultA, resultB] = await Promise.all([
    new Orchestrator().executeWorkflow(sharedTask, configA, `RUNTIME_ISO_A_${Date.now()}`),
    new Orchestrator().executeWorkflow(sharedTask, configB, `RUNTIME_ISO_B_${Date.now()}`)
  ]);

  if (resultA.marker !== 'tenant-a-only') {
    throw new Error(`Tenant A saw the wrong blackboard: ${JSON.stringify(resultA)}`);
  }
  if (resultB.marker !== 'tenant-b-only') {
    throw new Error(`Tenant B saw the wrong blackboard: ${JSON.stringify(resultB)}`);
  }
  if (Object.prototype.hasOwnProperty.call(sharedTask, 'blackboard')) {
    throw new Error(`Shared task object was mutated: ${JSON.stringify(sharedTask)}`);
  }
}

const tests = [
  ['workflow injects runtime into agents', testWorkflowInjectsRuntimeIntoAgents],
  ['manager uses scoped agent registry for tool grant', testManagerUsesScopedAgentRegistryForToolGrant],
  ['runtime plugin and tenant scope', testRuntimePluginAndTenantScope],
  ['tenant-only runtime gets scoped agent registry', testTenantOnlyRuntimeGetsScopedAgentRegistry],
  ['runtime checkpointer scope', testRuntimeCheckpointerScope],
  ['runtime state store scope for suspended workflow', testRuntimeStateStoreScopeForSuspendedWorkflow],
  ['concurrent workflows do not mutate shared task object', testConcurrentWorkflowsDoNotMutateSharedTaskObject]
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
