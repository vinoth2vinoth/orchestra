import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { EventStore } from '../src/framework/core/EventStore.ts';
import { LocalMessageBus } from '../src/framework/core/MessageBus.ts';
import { MemoryStateAdapter } from '../src/framework/core/StateAdapter.ts';
import { createRuntimeContext } from '../src/framework/core/RuntimeContext.ts';
import { runWithContext } from '../src/framework/core/ExecutionContext.ts';
import { MemoryMesh } from '../src/framework/memory/MemoryMesh.ts';
import { QueueBroker, TaskPayload } from '../src/framework/orchestration/QueueBroker.ts';
import { globalIAMInterceptor } from '../src/framework/security/IAMInterceptor.ts';
import { ToolRegistry, globalToolRegistry } from '../src/framework/tools/ToolRegistry.ts';
import '../src/framework/tools/ProjectBoardTool.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function task(taskId: string, agentId: string): TaskPayload {
  return {
    taskId,
    threadId: `INFRA_ISO_${taskId}`,
    agentId,
    agentConfig: {},
    payload: { taskId, agentId },
    blackboard: {},
    maxAttempts: 1
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))
  ]);
}

async function wait(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function testQueueBrokersUseScopedStateAndMessageBus() {
  const stateA = new MemoryStateAdapter();
  const stateB = new MemoryStateAdapter();
  const brokerA = new QueueBroker({
    namespace: 'tenant-a-queue',
    stateAdapter: stateA,
    messageBus: new LocalMessageBus(),
    visibilityTimeoutMs: 2000,
    defaultMaxAttempts: 2
  });
  const brokerB = new QueueBroker({
    namespace: 'tenant-b-queue',
    stateAdapter: stateB,
    messageBus: new LocalMessageBus(),
    visibilityTimeoutMs: 2000,
    defaultMaxAttempts: 2
  });

  try {
    brokerA.subscribeToAllTasks(async payload => {
      await brokerA.publishResult({
        taskId: payload.taskId,
        status: 'success',
        result: { handledBy: 'tenant-a-worker' },
        leaseId: payload.leaseId
      });
    }, 'tenant-a-worker');

    brokerB.subscribeToAllTasks(async payload => {
      await brokerB.publishResult({
        taskId: payload.taskId,
        status: 'success',
        result: { handledBy: 'tenant-b-worker' },
        leaseId: payload.leaseId
      });
    }, 'tenant-b-worker');

    const sharedTaskId = `same-task-id-${Date.now()}`;
    const [resultA, resultB] = await Promise.all([
      withTimeout(brokerA.publish(task(sharedTaskId, 'agent-a')), 2000),
      withTimeout(brokerB.publish(task(sharedTaskId, 'agent-b')), 2000)
    ]);

    assert(resultA.result?.handledBy === 'tenant-a-worker', `Broker A got wrong result: ${JSON.stringify(resultA)}`);
    assert(resultB.result?.handledBy === 'tenant-b-worker', `Broker B got wrong result: ${JSON.stringify(resultB)}`);

    const recordA = await brokerA.getTaskRecord(sharedTaskId);
    const recordB = await brokerB.getTaskRecord(sharedTaskId);
    assert(recordA?.task.agentId === 'agent-a', `Broker A task record was polluted: ${JSON.stringify(recordA)}`);
    assert(recordB?.task.agentId === 'agent-b', `Broker B task record was polluted: ${JSON.stringify(recordB)}`);
  } finally {
    brokerA.dispose();
    brokerB.dispose();
  }
}

async function testEventStoresUseScopedStateAndMessageBus() {
  const eventStoreA = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-a-events',
    topic: 'TENANT_A_EVENTS'
  });
  const eventStoreB = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-b-events',
    topic: 'TENANT_B_EVENTS'
  });

  try {
    const threadId = `same-thread-${Date.now()}`;
    eventStoreA.append({
      type: 'SYSTEM_HOOK',
      sourceAgentId: 'tenant-a',
      threadId,
      payload: { marker: 'tenant-a-only' }
    });
    eventStoreB.append({
      type: 'SYSTEM_HOOK',
      sourceAgentId: 'tenant-b',
      threadId,
      payload: { marker: 'tenant-b-only' }
    });
    await wait(10);

    const eventsA = eventStoreA.getEventsByThread(threadId);
    const eventsB = eventStoreB.getEventsByThread(threadId);
    assert(eventsA.length === 1 && eventsA[0].payload.marker === 'tenant-a-only', `Event store A leaked or lost events: ${JSON.stringify(eventsA)}`);
    assert(eventsB.length === 1 && eventsB[0].payload.marker === 'tenant-b-only', `Event store B leaked or lost events: ${JSON.stringify(eventsB)}`);
  } finally {
    eventStoreA.dispose();
    eventStoreB.dispose();
  }
}

async function testMemoryMeshUsesScopedEventStore() {
  const eventStoreA = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-a-memory-events',
    topic: 'TENANT_A_MEMORY_EVENTS'
  });
  const eventStoreB = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-b-memory-events',
    topic: 'TENANT_B_MEMORY_EVENTS'
  });
  const memoryA = new MemoryMesh({
    tenantId: 'tenant-a',
    namespace: 'memory-a',
    eventStore: eventStoreA
  });
  const memoryB = new MemoryMesh({
    tenantId: 'tenant-b',
    namespace: 'memory-b',
    eventStore: eventStoreB
  });

  try {
    memoryA.updateCoreMemory('same-context', 'human', 'tenant-a private profile');
    memoryB.updateCoreMemory('same-context', 'human', 'tenant-b private profile');

    const eventsA = eventStoreA.getEventsByThread('same-context');
    const eventsB = eventStoreB.getEventsByThread('same-context');
    assert(eventsA.length === 1 && eventsA[0].payload.content.includes('tenant-a'), `Memory A logged to wrong event store: ${JSON.stringify(eventsA)}`);
    assert(eventsB.length === 1 && eventsB[0].payload.content.includes('tenant-b'), `Memory B logged to wrong event store: ${JSON.stringify(eventsB)}`);
  } finally {
    eventStoreA.dispose();
    eventStoreB.dispose();
  }
}

async function testToolRegistryLogsToScopedEventStore() {
  const eventStoreA = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-a-tool-events',
    topic: 'TENANT_A_TOOL_EVENTS'
  });
  const eventStoreB = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-b-tool-events',
    topic: 'TENANT_B_TOOL_EVENTS'
  });
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(
    'scopedEchoTool',
    'Echo scoped tool input.',
    z.object({ marker: z.string() }),
    async ({ marker }) => `echo:${marker}`
  );

  const tenantA = `tool-scope-a-${Date.now()}`;
  const tenantB = `tool-scope-b-${Date.now()}`;
  globalIAMInterceptor.registerPolicy({ tenantId: tenantA, allowedTools: ['scopedEchoTool'], requiredSecrets: {} });
  globalIAMInterceptor.registerPolicy({ tenantId: tenantB, allowedTools: ['scopedEchoTool'], requiredSecrets: {} });

  try {
    const tools = toolRegistry.getAllTools();
    const runtimeA = createRuntimeContext({ tenantId: tenantA, eventStore: eventStoreA, toolRegistry });
    const runtimeB = createRuntimeContext({ tenantId: tenantB, eventStore: eventStoreB, toolRegistry });
    const threadId = `same-tool-thread-${Date.now()}`;

    const [resultA, resultB] = await Promise.all([
      runWithContext({
        tenantId: tenantA,
        agentId: 'tool-agent-a',
        threadId,
        capabilities: [],
        runtime: runtimeA
      }, () => tools.scopedEchoTool.execute({ marker: 'tenant-a-only' })),
      runWithContext({
        tenantId: tenantB,
        agentId: 'tool-agent-b',
        threadId,
        capabilities: [],
        runtime: runtimeB
      }, () => tools.scopedEchoTool.execute({ marker: 'tenant-b-only' }))
    ]);

    assert(resultA === 'echo:tenant-a-only', `Tool A returned wrong result: ${JSON.stringify(resultA)}`);
    assert(resultB === 'echo:tenant-b-only', `Tool B returned wrong result: ${JSON.stringify(resultB)}`);

    const eventsA = eventStoreA.getEventsByThread(threadId);
    const eventsB = eventStoreB.getEventsByThread(threadId);
    assert(eventsA.length === 1 && eventsA[0].sourceAgentId === 'tool-agent-a', `Tool A logged outside scoped event store: ${JSON.stringify(eventsA)}`);
    assert(eventsB.length === 1 && eventsB[0].sourceAgentId === 'tool-agent-b', `Tool B logged outside scoped event store: ${JSON.stringify(eventsB)}`);
    assert(eventsA[0].payload.args.marker === 'tenant-a-only', `Tool A logged wrong args: ${JSON.stringify(eventsA)}`);
    assert(eventsB[0].payload.args.marker === 'tenant-b-only', `Tool B logged wrong args: ${JSON.stringify(eventsB)}`);
  } finally {
    eventStoreA.dispose();
    eventStoreB.dispose();
  }
}

async function testProjectBoardToolUsesScopedRuntimeServices() {
  const projectPath = path.join(process.cwd(), 'workspace', 'projects.json');
  const hadOriginal = fs.existsSync(projectPath);
  const original = hadOriginal ? fs.readFileSync(projectPath, 'utf8') : '';
  const eventStore = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'project-tool-events',
    topic: 'PROJECT_TOOL_EVENTS'
  });
  const stateAdapter = new MemoryStateAdapter();
  const tenantId = `project-tool-tenant-${Date.now()}`;
  const threadId = `project-tool-thread-${Date.now()}`;
  globalIAMInterceptor.registerPolicy({ tenantId, allowedTools: ['createProjectTask'], requiredSecrets: {} });

  try {
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.writeFileSync(projectPath, JSON.stringify({
      projects: [{ id: 'project-tool-scope', name: 'Scoped Project', description: '', createdAt: Date.now(), tasks: [] }]
    }, null, 2), 'utf8');

    const runtime = createRuntimeContext({ tenantId, eventStore, stateAdapter });
    const result = await runWithContext({
      tenantId,
      agentId: 'project-tool-agent',
      threadId,
      capabilities: [],
      idempotencyKey: 'project-tool-scope:create-task:scoped-task',
      runtime
    }, () => globalToolRegistry.getAllTools().createProjectTask.execute({
      projectId: 'project-tool-scope',
      title: 'Scoped task'
    }));
    const retryResult = await runWithContext({
      tenantId,
      agentId: 'project-tool-agent',
      threadId,
      capabilities: [],
      idempotencyKey: 'project-tool-scope:create-task:scoped-task',
      runtime
    }, () => globalToolRegistry.getAllTools().createProjectTask.execute({
      projectId: 'project-tool-scope',
      title: 'Scoped task'
    }));

    assert(String(result).includes('Scoped task'), `Project board tool returned wrong result: ${JSON.stringify(result)}`);
    assert(String(retryResult).includes('already exists'), `Project board retry should reuse existing task, got: ${JSON.stringify(retryResult)}`);
    const board = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    const scopedTasks = board.projects[0].tasks.filter((task: any) => task.title === 'Scoped task');
    assert(scopedTasks.length === 1, `Idempotent project task retry should not create duplicates: ${JSON.stringify(scopedTasks)}`);
    assert(scopedTasks[0].orchestraIdempotencyKey === 'project-tool-scope:create-task:scoped-task', `Task should retain idempotency key: ${JSON.stringify(scopedTasks[0])}`);
    const events = eventStore.getEventsByThread(threadId);
    assert(events.some(event => event.type === 'TOOL_CALL_REQUESTED' && event.sourceAgentId === 'project-tool-agent'), `Project board tool request did not use scoped event store: ${JSON.stringify(events)}`);
    assert(events.some(event => event.type === 'TELEMETRY_EMIT' && event.payload.action === 'TASK_CREATED'), `Project board telemetry did not use scoped event store: ${JSON.stringify(events)}`);
    assert(events.filter(event => event.type === 'TELEMETRY_EMIT' && event.payload.action === 'TASK_CREATED').length === 1, `Idempotent retry should not emit duplicate create telemetry: ${JSON.stringify(events)}`);
  } finally {
    eventStore.dispose();
    if (hadOriginal) {
      fs.writeFileSync(projectPath, original, 'utf8');
    } else if (fs.existsSync(projectPath)) {
      fs.unlinkSync(projectPath);
    }
  }
}

async function testCircuitBreakerUsesScopedEventStore() {
  const eventStoreA = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-a-circuit-events',
    topic: 'TENANT_A_CIRCUIT_EVENTS'
  });
  const eventStoreB = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-b-circuit-events',
    topic: 'TENANT_B_CIRCUIT_EVENTS'
  });

  try {
    const runtimeA = createRuntimeContext({ eventStore: eventStoreA });
    const runtimeB = createRuntimeContext({ eventStore: eventStoreB });

    await runtimeA.circuitBreakers.execute('same-breaker-key', async () => 'ok');

    let failed = false;
    try {
      await runtimeB.circuitBreakers.execute('same-breaker-key', async () => {
        throw new Error('intentional scoped failure');
      });
    } catch {
      failed = true;
    }

    assert(failed, 'Expected failing AI Agent workflow to throw.');
    const circuitEventsA = eventStoreA.getLogs().filter(event => event.sourceAgentId === 'CIRCUIT_BREAKER');
    const circuitEventsB = eventStoreB.getLogs().filter(event => event.sourceAgentId === 'CIRCUIT_BREAKER');
    assert(circuitEventsA.length === 0, `Passing scoped workflow saw circuit events: ${JSON.stringify(circuitEventsA)}`);
    assert(circuitEventsB.some(event => event.type === 'ERROR_THROWN'), `Failing scoped workflow missed circuit event: ${JSON.stringify(circuitEventsB)}`);
  } finally {
    eventStoreA.dispose();
    eventStoreB.dispose();
  }
}

async function testPolicyEngineUsesScopedEventStore() {
  const eventStoreA = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-a-policy-events',
    topic: 'TENANT_A_POLICY_EVENTS'
  });
  const eventStoreB = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: 'tenant-b-policy-events',
    topic: 'TENANT_B_POLICY_EVENTS'
  });

  try {
    const threadA = `policy-a-${Date.now()}`;
    const threadB = `policy-b-${Date.now()}`;
    const oversizedTask = 'x'.repeat(200001);
    const runtimeA = createRuntimeContext({ eventStore: eventStoreA });
    const runtimeB = createRuntimeContext({ eventStore: eventStoreB });

    const blockedResult = runtimeA.policyEngine.evaluate(oversizedTask, 'policy-blocked-agent', threadA);
    const safeResult = runtimeB.policyEngine.evaluate('normal safe task', 'policy-safe-agent', threadB);

    assert(blockedResult.status === 'RED', `Expected oversized task to be blocked by policy: ${JSON.stringify(blockedResult)}`);
    assert(safeResult.status === 'GREEN', `Expected safe task to pass policy: ${JSON.stringify(safeResult)}`);
    const policyEventsA = eventStoreA.getEventsByThread(threadA).filter(event => event.sourceAgentId === 'GOVERNANCE');
    const policyEventsB = eventStoreB.getEventsByThread(threadB).filter(event => event.sourceAgentId === 'GOVERNANCE');
    assert(policyEventsA.some(event => event.payload.status === 'RED'), `Blocked workflow missed policy event: ${JSON.stringify(policyEventsA)}`);
    assert(policyEventsB.length === 0, `Safe scoped workflow saw policy events: ${JSON.stringify(policyEventsB)}`);
  } finally {
    eventStoreA.dispose();
    eventStoreB.dispose();
  }
}

const tests = [
  ['queue brokers use scoped state and message bus', testQueueBrokersUseScopedStateAndMessageBus],
  ['event stores use scoped state and message bus', testEventStoresUseScopedStateAndMessageBus],
  ['memory mesh uses scoped event store', testMemoryMeshUsesScopedEventStore],
  ['tool registry logs to scoped event store', testToolRegistryLogsToScopedEventStore],
  ['project board tool uses scoped runtime services', testProjectBoardToolUsesScopedRuntimeServices],
  ['circuit breaker uses scoped event store', testCircuitBreakerUsesScopedEventStore],
  ['policy engine uses scoped event store', testPolicyEngineUsesScopedEventStore]
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
if (results.some(result => !result.ok)) process.exit(1);
