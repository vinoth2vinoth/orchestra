import * as fs from 'fs';
import * as path from 'path';
import { globalToolRegistry } from '../src/framework/tools/ToolRegistry.ts';
import '../src/framework/tools/ExternalTools.ts';
import { MemoryStateAdapter } from '../src/framework/core/StateAdapter.ts';
import { StorageMesh } from '../src/framework/storage/StorageMesh.ts';
import { InfraStressor } from '../src/framework/testing/Stressor.ts';
import { globalIAMInterceptor } from '../src/framework/security/IAMInterceptor.ts';
import { createApiAuthMiddleware } from '../src/framework/security/ApiAuth.ts';

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

async function testFileSystemWriteIsAtomicAndRepeatable() {
  globalIAMInterceptor.registerPolicy({
    tenantId: 'GLOBAL',
    allowedTools: ['fileSystemWrite'],
    requiredSecrets: {},
  });

  const tools = globalToolRegistry.getAllTools();
  const relativePath = `atomic-write-${Date.now()}/output.txt`;
  const absolutePath = path.join(process.cwd(), 'workspace', relativePath);
  const dir = path.dirname(absolutePath);
  try {
    const first = await tools.fileSystemWrite.execute({ filePath: relativePath, content: 'first version' });
    const second = await tools.fileSystemWrite.execute({ filePath: relativePath, content: 'second version' });

    assert(String(first).includes('Successfully wrote'), `Unexpected first write result: ${first}`);
    assert(String(second).includes('Successfully wrote'), `Unexpected second write result: ${second}`);
    assert(fs.readFileSync(absolutePath, 'utf8') === 'second version', 'Expected final file content from last complete write');

    const tempFiles = fs.readdirSync(dir).filter(name => name.endsWith('.tmp'));
    assert(tempFiles.length === 0, `Atomic writer left temp files behind: ${tempFiles.join(', ')}`);
  } finally {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
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

async function testMemoryLockExpiresAfterTtl() {
  const adapter = new MemoryStateAdapter();
  assert(await adapter.acquireLock('ttl-lock', 25), 'Expected first lock acquisition');
  assert(!(await adapter.acquireLock('ttl-lock', 25)), 'Expected active lock to block second acquisition');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert(await adapter.acquireLock('ttl-lock', 25), 'Expected expired lock to be acquirable');
  await adapter.releaseLock('ttl-lock');
}

async function testStressSuiteFailsOnCorruption() {
  const result = await InfraStressor.runAll();
  assert(result.stateOps.collisions === 0, `Expected no state collisions, got ${result.stateOps.collisions}`);
  assert(result.syncCheck.inSync === true, 'Expected stress sync check to pass');
}

async function invokeAuth(env: NodeJS.ProcessEnv, headers: Record<string, string> = {}) {
  let statusCode = 200;
  let body: any;
  let nextCalled = false;
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  const middleware = createApiAuthMiddleware(env);
  await middleware(
    { header: (name: string) => normalizedHeaders.get(name.toLowerCase()) } as any,
    {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        body = payload;
        return this;
      }
    } as any,
    () => {
      nextCalled = true;
    }
  );

  return { statusCode, body, nextCalled };
}

async function testApiAuthMiddleware() {
  const unconfigured = await invokeAuth({});
  assert(unconfigured.statusCode === 503, `Expected unconfigured auth to return 503, got ${unconfigured.statusCode}`);
  assert(unconfigured.nextCalled === false, 'Unconfigured auth should not call next');

  const missingToken = await invokeAuth({ ORCHESTRA_API_TOKEN: 'secret-token' });
  assert(missingToken.statusCode === 401, `Expected missing token to return 401, got ${missingToken.statusCode}`);
  assert(missingToken.nextCalled === false, 'Missing token should not call next');

  const bearer = await invokeAuth(
    { ORCHESTRA_API_TOKEN: 'secret-token' },
    { authorization: 'Bearer secret-token' }
  );
  assert(bearer.nextCalled === true, 'Valid bearer token should call next');

  const apiKey = await invokeAuth(
    { ORCHESTRA_API_TOKEN: 'secret-token' },
    { 'x-orchestra-api-key': 'secret-token' }
  );
  assert(apiKey.nextCalled === true, 'Valid API key header should call next');

  const bypass = await invokeAuth({ ORCHESTRA_DEV_AUTH_BYPASS: 'true' });
  assert(bypass.nextCalled === true, 'Explicit dev auth bypass should call next');
}

async function main() {
  const tests = [
    ['tool traversal blocked', testToolTraversalBlocked],
    ['file system write is atomic and repeatable', testFileSystemWriteIsAtomicAndRepeatable],
    ['api auth middleware', testApiAuthMiddleware],
    ['storage traversal blocked', testStorageTraversalBlocked],
    ['atomic state mutation', testAtomicStateMutation],
    ['memory lock ttl expires', testMemoryLockExpiresAfterTtl],
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
