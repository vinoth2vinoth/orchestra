import { runReliabilityRecoveryDemo } from './workflow.ts';

try {
  const result = await runReliabilityRecoveryDemo();

  console.log('\nOrchestra Reliability Recovery Demo');
  console.log('===================================');
  console.log(`Thread: ${result.threadId}`);
  console.log(`Final release gate: ${result.finalDecision.releaseGate}`);
  console.log(`Summary: ${result.finalDecision.summary}\n`);

  console.table(result.timeline.map(entry => ({
    step: entry.step,
    aiAgent: entry.aiAgent,
    status: entry.status,
    detail: entry.detail
  })));

  console.log('\nProof');
  console.log(JSON.stringify({
    workflowCompleted: result.workflowCompleted,
    failedAiAgentRecovered: result.failedAiAgentRecovered,
    retryHappened: result.retryHappened,
    staleResultIgnored: result.staleResultIgnored,
    finalResultAccepted: result.finalResultAccepted,
    eventCount: result.eventCount
  }, null, 2));

  process.exit(0);
} catch (err: any) {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
