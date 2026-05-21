import { runReliabilityRecoveryDemo } from '../examples/reliability-recovery-demo/workflow.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function testReliabilityDemoProvesRecovery() {
  const result = await runReliabilityRecoveryDemo(`RELIABILITY_DEMO_TEST_${Date.now()}`);

  assert(result.workflowCompleted === true, 'Expected orchestrated workflow to complete.');
  assert(result.retryHappened === true, 'Expected failed AI Agent work to be retried.');
  assert(result.failedAiAgentRecovered === true, 'Expected failed AI Agent to recover and contribute to the final decision.');
  assert(result.staleResultIgnored === true, 'Expected stale late result to be ignored.');
  assert(result.finalResultAccepted === true, 'Expected final accepted result after recovery.');
  assert(result.finalDecision.releaseGate === 'PROCEED_WITH_MONITORING', `Unexpected release gate: ${result.finalDecision.releaseGate}`);
  assert(result.eventCount >= 8, `Expected event trail to include recovery evidence, got ${result.eventCount} events.`);

  const riskFailures = result.timeline.filter(entry => entry.aiAgent === 'Risk AI Agent' && entry.status === 'failed');
  const riskStarts = result.timeline.filter(entry => entry.aiAgent === 'Risk AI Agent' && entry.status === 'started');
  const staleIgnored = result.timeline.some(entry => entry.step === 'stale-ignored' && entry.status === 'ignored');

  assert(riskFailures.length === 1, `Expected exactly one simulated Risk AI Agent failure, got ${riskFailures.length}.`);
  assert(riskStarts.length >= 2, `Expected Risk AI Agent to start at least twice, got ${riskStarts.length}.`);
  assert(staleIgnored === true, 'Expected timeline to record stale result guard.');
}

const tests = [
  ['reliability recovery demo proves retry and stale-result safety', testReliabilityDemoProvesRecovery]
] as const;

const results: Array<{ name: string; ok: boolean; ms: number; error?: string; stack?: string }> = [];
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
