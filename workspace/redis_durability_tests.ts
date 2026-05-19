import { RedisStateAdapter } from '../src/framework/core/RedisStateAdapter.ts';
import { globalStateAdapter } from '../src/framework/core/StateAdapter.ts';
import { QueueBroker, TaskPayload } from '../src/framework/orchestration/QueueBroker.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function task(id: string, maxAttempts = 3): TaskPayload {
  return {
    taskId: id,
    threadId: `REDIS_QUEUE_${id}`,
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

async function wait(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function testRedisStateAdapterParity() {
  const redisUrl = process.env.REDIS_URL!;

  const adapter = new RedisStateAdapter(redisUrl);
  const prefix = `redis-parity:${Date.now()}:${crypto.randomUUID()}`;
  const keys = {
    value: `${prefix}:value`,
    deleted: `${prefix}:deleted`,
    counter: `${prefix}:counter`,
    cas: `${prefix}:cas`,
    list: `${prefix}:list`,
    lock: `${prefix}:lock`,
    ttl: `${prefix}:ttl`
  };

  try {
    await adapter.set(keys.value, { ok: true, nested: { n: 1 } });
    const value = await adapter.get<any>(keys.value);
    assert(value?.ok === true && value?.nested?.n === 1, `Redis get/set failed: ${JSON.stringify(value)}`);

    await adapter.set(keys.deleted, 'remove-me');
    await adapter.delete(keys.deleted);
    assert(await adapter.get(keys.deleted) === null, 'Redis delete failed');

    await Promise.all(Array.from({ length: 100 }, () => adapter.increment(keys.counter)));
    assert(await adapter.get<number>(keys.counter) === 100, 'Redis increment lost updates');

    const mutated = await Promise.all(Array.from({ length: 50 }, () =>
      adapter.mutate<number>(keys.counter, current => (current || 0) + 1)
    ));
    assert(mutated.length === 50, 'Redis mutate did not return all updates');
    assert(await adapter.get<number>(keys.counter) === 150, 'Redis mutate lost updates');

    await adapter.set(keys.cas, { version: 1 });
    const won = await adapter.compareAndSwap(keys.cas, { version: 1 }, { version: 2 });
    const lost = await adapter.compareAndSwap(keys.cas, { version: 1 }, { version: 3 });
    const casFinal = await adapter.get<any>(keys.cas);
    assert(won === true && lost === false && casFinal?.version === 2, `Redis CAS failed: ${JSON.stringify({ won, lost, casFinal })}`);

    const firstLock = await adapter.acquireLock(keys.lock, 500);
    const secondLock = await adapter.acquireLock(keys.lock, 500);
    assert(firstLock === true && secondLock === false, 'Redis lock should be exclusive');
    await adapter.releaseLock(keys.lock);
    assert(await adapter.acquireLock(keys.lock, 500) === true, 'Redis lock should be reusable after release');
    await adapter.releaseLock(keys.lock);

    await adapter.pushToList(keys.list, { item: 1 });
    await adapter.pushToList(keys.list, { item: 2 });
    const list = await adapter.getRange(keys.list, 0, -1);
    assert(list.length === 2 && list[0].item === 1 && list[1].item === 2, `Redis list operations failed: ${JSON.stringify(list)}`);

    await adapter.set(keys.ttl, 'expires', 1);
    assert(await adapter.get(keys.ttl) === 'expires', 'Redis TTL value missing before expiry');
    await wait(1200);
    assert(await adapter.get(keys.ttl) === null, 'Redis TTL value did not expire');
  } finally {
    await Promise.all([
      adapter.delete(keys.value),
      adapter.delete(keys.deleted),
      adapter.delete(keys.counter),
      adapter.delete(keys.cas),
      adapter.delete(keys.list),
      adapter.delete(keys.ttl)
    ]);
    await adapter.releaseLock(keys.lock);
    adapter.disconnect();
  }
}

async function testQueueBrokerUsesRedisGlobalState() {
  assert(
    globalStateAdapter instanceof RedisStateAdapter,
    'QueueBroker Redis test requires ORCHESTRA_STATE_ADAPTER=redis so the global state adapter is Redis-backed.'
  );

  const broker = new QueueBroker({ visibilityTimeoutMs: 100, defaultMaxAttempts: 3 });
  try {
    await broker.resetForTests();

    let attempts = 0;
    broker.subscribeToAllTasks(async (payload) => {
      attempts++;
      if (attempts === 1) return;
      await broker.publishResult({
        taskId: payload.taskId,
        status: 'success',
        result: { recovered: true, attempts }
      });
    }, 'redis-queue-worker');

    const taskId = `redis-lease-${Date.now()}`;
    const result = await withTimeout(broker.publish(task(taskId)), 4000);
    const record = await broker.getTaskRecord(taskId);

    assert(result.status === 'success', `Expected Redis-backed queue success, got ${JSON.stringify(result)}`);
    assert(result.result?.recovered === true && result.result?.attempts === 2, `Expected Redis lease recovery on second attempt, got ${JSON.stringify(result)}`);
    assert(record?.status === 'SUCCEEDED' && record?.attempts === 2, `Expected Redis task record to persist success, got ${JSON.stringify(record)}`);
  } finally {
    await broker.resetForTests();
    broker.dispose();
    if (globalStateAdapter instanceof RedisStateAdapter) {
      globalStateAdapter.disconnect();
    }
  }
}

const tests = [
  ['redis state adapter parity', testRedisStateAdapterParity],
  ['queue broker uses redis global state', testQueueBrokerUsesRedisGlobalState]
] as const;

if (!process.env.REDIS_URL) {
  console.log(JSON.stringify([
    {
      name: 'redis-backed durability',
      ok: true,
      skipped: true,
      reason: 'REDIS_URL is not set'
    }
  ], null, 2));
  process.exit(0);
}

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
process.exit(results.some(result => !result.ok) ? 1 : 0);
