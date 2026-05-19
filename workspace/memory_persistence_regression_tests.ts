import { MemoryMesh } from '../src/framework/memory/MemoryMesh.ts';
import { MemoryStateAdapter } from '../src/framework/core/StateAdapter.ts';

async function wait(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function testPersistedSemanticMemoryReloadsByTenantAndNamespace() {
  const state = new MemoryStateAdapter();
  const namespace = `memory-test-${Date.now()}`;

  const writer = new MemoryMesh({
    namespace,
    tenantId: 'tenant-a',
    persist: true,
    stateAdapter: state
  });
  await writer.addSemanticMemory('orchestra durable memory marker alpha', ['orchestra', 'durable']);

  const reader = new MemoryMesh({
    namespace,
    tenantId: 'tenant-a',
    persist: true,
    stateAdapter: state
  });
  await wait(25);

  const results = await reader.searchSimilarMemories('durable memory marker', 3);
  if (!results.some(result => String(result.content).includes('alpha'))) {
    throw new Error(`Persisted memory was not reloaded: ${JSON.stringify(results)}`);
  }

  const otherTenant = new MemoryMesh({
    namespace,
    tenantId: 'tenant-b',
    persist: true,
    stateAdapter: state
  });
  await wait(25);
  const isolatedResults = await otherTenant.searchSimilarMemories('durable memory marker', 3);
  if (isolatedResults.length !== 0) {
    throw new Error(`Tenant-b saw tenant-a memories: ${JSON.stringify(isolatedResults)}`);
  }
}

const tests = [
  ['persisted semantic memory reloads by tenant namespace', testPersistedSemanticMemoryReloadsByTenantAndNamespace]
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
