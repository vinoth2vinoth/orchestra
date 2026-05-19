import { AuditLog } from '../src/framework/governance/AuditLog.ts';

async function testConcurrentAuditEntriesVerifyAsChainSegment() {
  const audit = new AuditLog();
  const fromTimestamp = Date.now();
  await Promise.all(Array.from({ length: 5 }, (_, index) =>
    audit.log('AUDIT_CHAIN_TEST', `agent-${index}`, 'TEST_ACTION', `entry ${index}`)
  ));

  const result = await audit.verify(new Date(), { fromTimestamp });
  if (!result.valid || result.entries < 5) {
    throw new Error(`Audit chain verification failed: ${JSON.stringify(result)}`);
  }
}

const tests = [
  ['concurrent audit entries verify as chain segment', testConcurrentAuditEntriesVerifyAsChainSegment]
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
