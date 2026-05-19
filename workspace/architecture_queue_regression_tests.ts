import { QueueBroker, TaskPayload } from '../src/framework/orchestration/QueueBroker.ts';

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

async function testRetryThenSuccess() {
  const broker = new QueueBroker({ visibilityTimeoutMs: 250, defaultMaxAttempts: 3 });
  try {
    await broker.resetForTests();

    let attempts = 0;
    broker.subscribeToAllTasks(async (payload) => {
      attempts++;
      if (attempts === 1) {
        await broker.publishResult({ taskId: payload.taskId, status: 'error', error: 'first failure' });
        return;
      }
      await broker.publishResult({ taskId: payload.taskId, status: 'success', result: { ok: true, attempts } });
    }, 'queue-test-worker');

    const result = await withTimeout(broker.publish(task(`retry-${Date.now()}`)), 2000);
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
      await broker.publishResult({ taskId: payload.taskId, status: 'error', error: 'permanent failure' });
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
  const broker = new QueueBroker({ visibilityTimeoutMs: 100, defaultMaxAttempts: 3 });
  try {
    await broker.resetForTests();

    let attempts = 0;
    broker.subscribeToAllTasks(async (payload) => {
      attempts++;
      if (attempts === 1) {
        return; // Simulate a worker crash after leasing but before ACK/NACK.
      }
      await broker.publishResult({ taskId: payload.taskId, status: 'success', result: { recovered: true, attempts } });
    }, 'queue-recovery-worker');

    const result = await withTimeout(broker.publish(task(`lease-${Date.now()}`)), 3000);
    if (result.status !== 'success' || result.result?.recovered !== true || result.result?.attempts !== 2) {
      throw new Error(`Expected lease recovery success on second attempt, got ${JSON.stringify(result)}`);
    }
  } finally {
    broker.dispose();
  }
}

const tests = [
  ['queue retry then success', testRetryThenSuccess],
  ['queue dead letter after max attempts', testDeadLetterAfterMaxAttempts],
  ['queue expired lease recovery', testExpiredLeaseRecovery]
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
