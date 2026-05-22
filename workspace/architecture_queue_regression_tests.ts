import { QueueBroker, TaskPayload } from '../src/framework/orchestration/QueueBroker.ts';
import { WorkerNode } from '../src/framework/orchestration/WorkerNode.ts';
import { WorkerCluster } from '../src/framework/orchestration/WorkerCluster.ts';
import { globalQueueBroker } from '../src/framework/orchestration/QueueBroker.ts';
import { BaseAgent } from '../src/framework/agents/BaseAgent.ts';
import { AgentRegistry, globalRegistry } from '../src/framework/agents/AgentRegistry.ts';
import { MemoryMesh } from '../src/framework/memory/MemoryMesh.ts';
import { LocalMessageBus, globalMessageBus } from '../src/framework/core/MessageBus.ts';
import type { LLMConfig } from '../src/framework/llm/ProviderRegistry.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function task(id: string, maxAttempts = 3): TaskPayload {
  return {
    taskId: id,
    threadId: `QUEUE_TEST_${id}`,
    agentId: 'agent',
    agentConfig: {},
    payload: { id },
    blackboard: {},
    maxAttempts
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))
  ]);
}

class QueueLifecycleAgent extends BaseAgent {
  public calls = 0;

  constructor(id: string) {
    const llmConfig: LLMConfig = { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' };
    super(id, 'Queue lifecycle test agent.', 'WORKER', new MemoryMesh({ tenantId: 'queue-lifecycle', namespace: id }), llmConfig, [], undefined, undefined, undefined, id);
  }

  async execute(task: any): Promise<any> {
    this.calls++;
    return { processed: task.id, calls: this.calls };
  }
}

async function testRetryThenSuccess() {
  const broker = new QueueBroker({ visibilityTimeoutMs: 2000, defaultMaxAttempts: 3 });
  try {
    await broker.resetForTests();

    let attempts = 0;
    broker.subscribeToAllTasks(async (payload) => {
      attempts++;
      if (attempts === 1) {
        await broker.publishResult({ taskId: payload.taskId, status: 'error', error: 'first failure', leaseId: payload.leaseId });
        return;
      }
      await broker.publishResult({ taskId: payload.taskId, status: 'success', result: { ok: true, attempts }, leaseId: payload.leaseId });
    }, 'queue-test-worker');

    const result = await withTimeout(broker.publish(task(`retry-${Date.now()}`)), 5000);
    if (result.status !== 'success' || result.result?.attempts !== 2) {
      throw new Error(`Expected retry success on second attempt, got ${JSON.stringify(result)}`);
    }
  } finally {
    broker.dispose();
  }
}

async function testDeadLetterAfterMaxAttempts() {
  const broker = new QueueBroker({ visibilityTimeoutMs: 250, defaultMaxAttempts: 2 });
  try {
    await broker.resetForTests();

    const taskId = `dlq-${Date.now()}`;
    broker.subscribeToAllTasks(async (payload) => {
      await broker.publishResult({ taskId: payload.taskId, status: 'error', error: 'permanent failure', leaseId: payload.leaseId });
    }, 'queue-dlq-worker');

    const result = await withTimeout(broker.publish(task(taskId, 2)), 2000);
    const record = await broker.getTaskRecord(taskId);
    const dlq = await broker.getDeadLetterQueue();

    if (result.status !== 'error' || record?.status !== 'DEAD_LETTER' || !dlq.includes(taskId)) {
      throw new Error(`Expected task in DLQ, got result=${JSON.stringify(result)} record=${JSON.stringify(record)} dlq=${JSON.stringify(dlq)}`);
    }
  } finally {
    broker.dispose();
  }
}

async function testExpiredLeaseRecovery() {
  const broker = new QueueBroker({ visibilityTimeoutMs: 500, defaultMaxAttempts: 3 });
  try {
    await broker.resetForTests();

    let attempts = 0;
    broker.subscribeToAllTasks(async (payload) => {
      attempts++;
      if (attempts === 1) {
        return; // Simulate a worker crash after leasing but before ACK/NACK.
      }
      await broker.publishResult({ taskId: payload.taskId, status: 'success', result: { recovered: true, attempts }, leaseId: payload.leaseId });
    }, 'queue-recovery-worker');

    const result = await withTimeout(broker.publish(task(`lease-${Date.now()}`)), 5000);
    if (result.status !== 'success' || result.result?.recovered !== true || result.result?.attempts !== 2) {
      throw new Error(`Expected lease recovery success on second attempt, got ${JSON.stringify(result)}`);
    }
  } finally {
    broker.dispose();
  }
}

async function testQueueSubscriberUnregisters() {
  const broker = new QueueBroker({ visibilityTimeoutMs: 2000, defaultMaxAttempts: 2 });
  try {
    await broker.resetForTests();

    let firstWorkerCalls = 0;
    const unsubscribe = broker.subscribeToAllTasks(async (payload) => {
      firstWorkerCalls++;
      await broker.publishResult({
        taskId: payload.taskId,
        status: 'success',
        result: { worker: 'old' },
        leaseId: payload.leaseId
      });
    }, 'restartable-worker');

    unsubscribe();

    let secondWorkerCalls = 0;
    broker.subscribeToAllTasks(async (payload) => {
      secondWorkerCalls++;
      await broker.publishResult({
        taskId: payload.taskId,
        status: 'success',
        result: { worker: 'new' },
        leaseId: payload.leaseId
      });
    }, 'restartable-worker');

    const result = await withTimeout(broker.publish(task(`unsubscribe-${Date.now()}`)), 2000);
    assert(result.status === 'success', `Expected success after subscriber restart, got ${JSON.stringify(result)}`);
    assert(result.result?.worker === 'new', `Expected new worker to handle task, got ${JSON.stringify(result)}`);
    assert(firstWorkerCalls === 0, `Stopped subscriber should not receive tasks, got ${firstWorkerCalls}`);
    assert(secondWorkerCalls === 1, `New subscriber should receive one task, got ${secondWorkerCalls}`);
  } finally {
    broker.dispose();
  }
}

async function testWorkerNodeCanRestartWithSameId() {
  const agentId = `worker-lifecycle-agent-${Date.now()}`;
  const workerId = `worker-lifecycle-node-${Date.now()}`;
  const agent = new QueueLifecycleAgent(agentId);
  const firstWorker = new WorkerNode(workerId);
  const secondWorker = new WorkerNode(workerId);

  try {
    await globalQueueBroker.resetForTests();
    globalRegistry.register(agent);

    firstWorker.start();
    firstWorker.stop();
    secondWorker.start();

    const result = await withTimeout(globalQueueBroker.publish({
      ...task(`worker-restart-${Date.now()}`),
      agentId,
      payload: { id: 'worker-restart' }
    }), 4000);

    assert(result.status === 'success', `Expected restarted worker success, got ${JSON.stringify(result)}`);
    assert(result.result?.processed === 'worker-restart', `Expected restarted worker result, got ${JSON.stringify(result)}`);
    assert(agent.calls === 1, `Expected one agent execution after restart, got ${agent.calls}`);
  } finally {
    firstWorker.stop();
    secondWorker.stop();
    globalRegistry.unregister(agentId);
    await globalQueueBroker.resetForTests();
  }
}

async function testWorkerClusterStopsAllWorkers() {
  const cluster = new WorkerCluster();
  cluster.init(2);
  assert(cluster.getWorkers().length === 2, `Expected 2 workers, got ${cluster.getWorkers().length}`);

  cluster.stop();
  assert(cluster.getWorkers().length === 0, `Expected stopped cluster to clear workers, got ${cluster.getWorkers().length}`);

  cluster.init(1);
  assert(cluster.getWorkers().length === 1, `Expected cluster to restart with 1 worker, got ${cluster.getWorkers().length}`);
  cluster.stop();
}

async function testWorkerNodeUsesScopedQueueAndRegistry() {
  const scopedQueue = new QueueBroker({ visibilityTimeoutMs: 100, defaultMaxAttempts: 2 });
  const scopedRegistry = new AgentRegistry();
  const agentId = `scoped-worker-agent-${Date.now()}`;
  const agent = new QueueLifecycleAgent(agentId);
  const worker = new WorkerNode(`scoped-worker-node-${Date.now()}`, {
    queueBroker: scopedQueue,
    agentRegistry: scopedRegistry
  });

  try {
    await scopedQueue.resetForTests();
    await globalQueueBroker.resetForTests();
    scopedRegistry.register(agent);

    worker.start();
    const result = await withTimeout(scopedQueue.publish({
      ...task(`scoped-worker-${Date.now()}`),
      agentId,
      payload: { id: 'scoped-worker' }
    }), 3000);

    assert(result.status === 'success', `Expected scoped worker success, got ${JSON.stringify(result)}`);
    assert(result.result?.processed === 'scoped-worker', `Expected scoped queue result, got ${JSON.stringify(result)}`);
    assert(agent.calls === 1, `Expected scoped agent to run once, got ${agent.calls}`);
    assert(globalRegistry.get(agentId) === undefined, 'Scoped worker test should not register agent globally');
  } finally {
    worker.stop();
    scopedRegistry.unregister(agentId);
    await scopedQueue.resetForTests();
    await globalQueueBroker.resetForTests();
    scopedQueue.dispose();
  }
}

async function testWorkerClusterPassesScopedServicesToWorkers() {
  const scopedQueue = new QueueBroker({ visibilityTimeoutMs: 100, defaultMaxAttempts: 2 });
  const scopedRegistry = new AgentRegistry();
  const agentId = `scoped-cluster-agent-${Date.now()}`;
  const agent = new QueueLifecycleAgent(agentId);
  const cluster = new WorkerCluster({
    queueBroker: scopedQueue,
    agentRegistry: scopedRegistry
  });

  try {
    await scopedQueue.resetForTests();
    scopedRegistry.register(agent);

    cluster.init(1);
    const result = await withTimeout(scopedQueue.publish({
      ...task(`scoped-cluster-${Date.now()}`),
      agentId,
      payload: { id: 'scoped-cluster' }
    }), 3000);

    assert(result.status === 'success', `Expected scoped cluster success, got ${JSON.stringify(result)}`);
    assert(result.result?.processed === 'scoped-cluster', `Expected scoped cluster result, got ${JSON.stringify(result)}`);
    assert(agent.calls === 1, `Expected scoped cluster agent to run once, got ${agent.calls}`);
    assert(globalRegistry.get(agentId) === undefined, 'Scoped cluster test should not register agent globally');
  } finally {
    cluster.stop();
    scopedRegistry.unregister(agentId);
    await scopedQueue.resetForTests();
    scopedQueue.dispose();
  }
}

async function testWorkerNodeHeartbeatsUseScopedMessageBus() {
  const scopedBus = new LocalMessageBus();
  const scopedQueue = new QueueBroker({
    visibilityTimeoutMs: 100,
    defaultMaxAttempts: 2,
    messageBus: scopedBus
  });
  const nodeId = `scoped-heartbeat-node-${Date.now()}`;
  const worker = new WorkerNode(nodeId, {
    queueBroker: scopedQueue,
    messageBus: scopedBus,
    agentRegistry: new AgentRegistry()
  });
  let scopedHeartbeats = 0;
  let globalHeartbeats = 0;
  const unsubscribeScoped = await scopedBus.subscribe('WORKER_HEARTBEATS', (msg: any) => {
    if (msg.nodeId === nodeId) scopedHeartbeats++;
  });
  const unsubscribeGlobal = await globalMessageBus.subscribe('WORKER_HEARTBEATS', (msg: any) => {
    if (msg.nodeId === nodeId) globalHeartbeats++;
  });

  try {
    worker.start();
    await new Promise(resolve => setTimeout(resolve, 2200));

    assert(scopedHeartbeats > 0, 'Expected worker heartbeat on scoped message bus');
    assert(globalHeartbeats === 0, `Expected no worker heartbeat on global message bus, got ${globalHeartbeats}`);
  } finally {
    worker.stop();
    unsubscribeScoped();
    unsubscribeGlobal();
    scopedQueue.dispose();
  }
}

const tests = [
  ['queue retry then success', testRetryThenSuccess],
  ['queue dead letter after max attempts', testDeadLetterAfterMaxAttempts],
  ['queue expired lease recovery', testExpiredLeaseRecovery],
  ['queue subscriber unregisters', testQueueSubscriberUnregisters],
  ['worker node can restart with same id', testWorkerNodeCanRestartWithSameId],
  ['worker cluster stops all workers', testWorkerClusterStopsAllWorkers],
  ['worker node uses scoped queue and registry', testWorkerNodeUsesScopedQueueAndRegistry],
  ['worker cluster passes scoped services to workers', testWorkerClusterPassesScopedServicesToWorkers],
  ['worker node heartbeats use scoped message bus', testWorkerNodeHeartbeatsUseScopedMessageBus]
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
