import { runCodeReviewReference } from '../examples/reference-code-review/workflow.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function testReferenceCodeReviewBlocksCriticalRelease() {
  const result = await runCodeReviewReference(undefined, `REFERENCE_TEST_${Date.now()}`);

  assert(result.releaseGate === 'BLOCK', `Expected BLOCK release gate, got ${result.releaseGate}`);
  assert(result.risk === 'critical', `Expected critical risk, got ${result.risk}`);
  assert(result.needsHumanApproval === true, 'Expected human approval requirement for blocked release');
  assert(result.auditTrailSummary.graphCompleted === true, 'Expected graph workflow completion');
  assert(result.auditTrailSummary.participatingAgents.length === 4, 'Expected four participating agents');
  assert(result.findings.length >= 3, `Expected at least three findings, got ${result.findings.length}`);
  assert(result.findings.some(finding => finding.category === 'security' && finding.severity === 'critical'), 'Expected critical security finding');
  assert(result.findings.some(finding => finding.category === 'architecture'), 'Expected architecture finding');
  assert(result.findings.some(finding => finding.category === 'testing'), 'Expected testing finding');
  assert(result.requiredActions.some(action => action.toLowerCase().includes('command execution')), 'Expected command execution remediation action');
}

const tests = [
  ['reference code review blocks critical release', testReferenceCodeReviewBlocksCriticalRelease]
] as const;

const results = [];
for (const [name, run] of tests) {
  const start = Date.now();
  try {
    await run();
    results.push({ name, ok: true, ms: Date.now() - start });
  } catch (err: any) {
    results.push({ name, ok: false, error: err.message, stack: err.stack, ms: Date.now() - start });
  }
}

console.log(JSON.stringify(results, null, 2));
process.exit(results.some(result => !result.ok) ? 1 : 0);
