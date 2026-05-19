import * as fs from 'fs';
import * as path from 'path';
import { globalToolRegistry } from '../src/framework/tools/ToolRegistry.ts';
import '../src/framework/tools/ExternalTools.ts';
import { MemoryStateAdapter } from '../src/framework/core/StateAdapter.ts';
import { StorageMesh } from '../src/framework/storage/StorageMesh.ts';
import { InfraStressor } from '../src/framework/testing/Stressor.ts';
import { globalIAMInterceptor } from '../src/framework/security/IAMInterceptor.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function testToolTraversalBlocked() {
  globalIAMInterceptor.registerPolicy({
    tenantId: 'GLOBAL',
    allowedTools: ['fileSystemWrite'],
    requiredSecrets: {},
  });

  const tools = globalToolRegistry.getAllTools();
  const blockedPaths = [
    '../workspace_evil/pwned.txt',
    '../../etc/passwd',
    '/etc/passwd',
    '..%2Fworkspace_evil%2Fpwned.txt',
  ];

  for (const filePath of blockedPaths) {
    const result = await tools.fileSystemWrite.execute({ filePath, content: 'PWNED' });
    assert(String(result).includes('Access denied'), `fileSystemWrite allowed traversal path: ${filePath}`);
  }
}

async function testStorageTraversalBlocked() {
  const baseDir = fs.mkdtempSync(path.join(process.cwd(), 'workspace', 'storage-regression-'));
  const storage = new StorageMesh(baseDir);
  try {
    await storage.writeFile('../workspace_evil/storage_pwned.txt', 'PWNED');
    throw new Error('StorageMesh allowed traversal write');
  } catch (error: any) {
    assert(String(error.message).includes('Path traversal detected'), `Unexpected StorageMesh error: ${error.message}`);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

async function testAtomicStateMutation() {
  const adapter = new MemoryStateAdapter();
  await adapter.set('counter', 0);

  await Promise.all(Array.from({ length: 500 }, () => adapter.increment('counter')));
  const final = await adapter.get<number>('counter');
  assert(final === 500, `Expected 500 atomic increments, got ${final}`);

  const won = await adapter.compareAndSwap('counter', 500, 501);
  const lost = await adapter.compareAndSwap('counter', 500, 999);
  const casFinal = await adapter.get<number>('counter');
  assert(won === true, 'Expected first compare-and-swap to succeed');
  assert(lost === false, 'Expected stale compare-and-swap to fail');
  assert(casFinal === 501, `Expected CAS final value 501, got ${casFinal}`);
}

async function testStressSuiteFailsOnCorruption() {
  const result = await InfraStressor.runAll();
  assert(result.stateOps.collisions === 0, `Expected no state collisions, got ${result.stateOps.collisions}`);
  assert(result.syncCheck.inSync === true, 'Expected stress sync check to pass');
}

async function main() {
  const tests = [
    ['tool traversal blocked', testToolTraversalBlocked],
    ['storage traversal blocked', testStorageTraversalBlocked],
    ['atomic state mutation', testAtomicStateMutation],
    ['stress suite correctness', testStressSuiteFailsOnCorruption],
  ] as const;

  const results = [];
  for (const [name, test] of tests) {
    const started = Date.now();
    try {
      await test();
      results.push({ name, ok: true, ms: Date.now() - started });
    } catch (error: any) {
      results.push({ name, ok: false, ms: Date.now() - started, error: error.message });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  process.exit(results.some(result => !result.ok) ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
