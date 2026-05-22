import {
  BaseAgent,
  MemoryMesh,
  Orchestrator,
  QueueBroker,
  type QueueTaskRecord,
  type TaskPayload,
  type TaskResult
} from '../src/framework/index.ts';
import { StateStore } from '../src/framework/orchestration/StateStore.ts';
import { WorkflowSuspendedError } from '../src/framework/orchestration/WorkflowSuspendedError.ts';

class DurableSuspendingAgent extends BaseAgent {
  constructor(id: string, private readonly approvalId: string) {
    super(
      id,
      `Suspends workflow for ${id}.`,
      'MANAGER',
      new MemoryMesh(),
      { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
      [],
      undefined,
      undefined,
      undefined,
      id
    );
  }

  async execute(): Promise<any> {
    throw new WorkflowSuspendedError(this.approvalId, { reason: 'durability-restart-test' });
  }
}

class DurableResultAgent extends BaseAgent {
  constructor(id: string, private readonly answer: any) {
    super(
      id,
      `Completes workflow for ${id}.`,
      'MANAGER',
      new MemoryMesh(),
      { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
      [],
      undefined,
      undefined,
      undefined,
      id
    );
  }

  async execute(task: any): Promise<any> {
    return { answer: this.answer, task };
  }
}

class DurableFailingAgent extends BaseAgent {
  constructor(id: string) {
    super(
      id,
      `Fails workflow for ${id}.`,
      'MANAGER',
      new MemoryMesh(),
      { apiKey: 'SIMULATION_ONLY', modelName: 'test-model' },
      [],
      undefined,
      undefined,
      undefined,
      id
    );
  }

  async execute(): Promise<any> {
    throw new Error('resume failed after restart');
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function waitFor<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  let lastValue: T;

  while (Date.now() - start < timeoutMs) {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await new Promise(resolve => setTimeout(resolve, 25));
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))
  ]);
}

function createTask(taskId: string): TaskPayload {
  return {
    taskId,
    threadId: `DURABILITY_${taskId}`,
    agentId: 'durable-agent',
    agentConfig: {},
    payload: { taskId },
    blackboard: {},
    maxAttempts: 3
  };
}

async function testDuplicatePublishIsIdempotentWhileInFlight() {
  const broker = new QueueBroker({ visibilityTimeoutMs: 5000, defaultMaxAttempts: 3 });
  try {
    await broker.resetForTests();

    let executions = 0;
    broker.subscribeToAllTasks(async payload => {
      executions++;
      await new Promise(resolve => setTimeout(resolve, 75));
      await broker.publishResult({
        taskId: payload.taskId,
        status: 'success',
        result: { executions, payload: payload.payload },
        leaseId: payload.leaseId
      });
    }, 'idempotent-worker');

    const task = createTask(`idempotent-${Date.now()}`);
    const first = broker.publish(task);
    await waitFor(() => broker.getTaskRecord(task.taskId), record => record !== null);
    const duplicate = broker.publish(task);

    const [firstResult, duplicateResult] = await withTimeout(Promise.all([first, duplicate]), 3000);
    assert(firstResult.status === 'success', `Expected first publish success, got ${JSON.stringify(firstResult)}`);
    assert(duplicateResult.status === 'success', `Expected duplicate publish success, got ${JSON.stringify(duplicateResult)}`);
    assert(firstResult.result?.executions === 1, `Expected first result from one execution, got ${JSON.stringify(firstResult)}`);
    assert(duplicateResult.result?.executions === 1, `Expected duplicate result from same execution, got ${JSON.stringify(duplicateResult)}`);
    assert(executions === 1, `Expected duplicate publish not to re-execute task, got ${executions} executions`);

    const replay = await broker.publish(task);
    assert(replay.status === 'success' && replay.result?.executions === 1, `Expected completed task replay to return stored result, got ${JSON.stringify(replay)}`);

    const record = await broker.getTaskRecord(task.taskId);
    assert(record?.attempts === 1, `Expected one leased attempt, got ${record?.attempts}`);
  } finally {
    broker.dispose();
  }
}

async function testFreshBrokerRecoversExpiredLeaseAfterRestart() {
  const brokerBeforeRestart = new QueueBroker({ visibilityTimeoutMs: 100, defaultMaxAttempts: 3 });
  let brokerAfterRestart: QueueBroker | undefined;
  try {
    await brokerBeforeRestart.resetForTests();

    let preRestartExecutions = 0;
    brokerBeforeRestart.subscribeToAllTasks(async () => {
      preRestartExecutions++;
      // Simulate process loss after lease. No ACK/NACK/result is published.
    }, 'pre-restart-worker');

    const task = createTask(`restart-${Date.now()}`);
    void brokerBeforeRestart.publish(task);

    const leased = await waitFor(
      () => brokerBeforeRestart.getTaskRecord(task.taskId),
      (record): record is QueueTaskRecord => record?.status === 'LEASED',
      2000
    );
    assert(leased.attempts === 1, `Expected first broker to lease once, got ${leased.attempts}`);

    brokerBeforeRestart.dispose();
    await new Promise(resolve => setTimeout(resolve, 150));

    brokerAfterRestart = new QueueBroker({ visibilityTimeoutMs: 100, defaultMaxAttempts: 3 });
    let postRestartExecutions = 0;
    brokerAfterRestart.subscribeToAllTasks(async payload => {
      postRestartExecutions++;
      await brokerAfterRestart!.publishResult({
        taskId: payload.taskId,
        status: 'success',
        result: { recoveredByFreshBroker: true, postRestartExecutions },
        leaseId: payload.leaseId
      });
    }, 'post-restart-worker');

    const recoveredResult = await withTimeout(brokerAfterRestart.publish(task), 4000);
    assert(recoveredResult.status === 'success', `Expected fresh broker recovery success, got ${JSON.stringify(recoveredResult)}`);
    assert(recoveredResult.result?.recoveredByFreshBroker === true, `Expected recovery marker, got ${JSON.stringify(recoveredResult)}`);
    assert(preRestartExecutions === 1, `Expected one pre-restart execution, got ${preRestartExecutions}`);
    assert(postRestartExecutions === 1, `Expected one post-restart execution, got ${postRestartExecutions}`);

    const finalRecord = await brokerAfterRestart.getTaskRecord(task.taskId);
    assert(finalRecord?.status === 'SUCCEEDED', `Expected final record succeeded, got ${finalRecord?.status}`);
    assert(finalRecord?.attempts === 2, `Expected second attempt after restart recovery, got ${finalRecord?.attempts}`);
  } finally {
    brokerBeforeRestart.dispose();
    brokerAfterRestart?.dispose();
  }
}

async function testStaleLeaseResultCannotWinCurrentLease() {
  const broker = new QueueBroker({ visibilityTimeoutMs: 250, defaultMaxAttempts: 3 });
  try {
    await broker.resetForTests();

    let attempts = 0;
    broker.subscribeToAllTasks(async payload => {
      attempts++;
      if (attempts === 1) {
        const staleLeaseId = payload.leaseId;
        void (async () => {
          await waitFor(
            () => broker.getTaskRecord(payload.taskId),
            record => Boolean(record && record.attempts >= 2 && record.leaseId !== staleLeaseId),
            3000
          );
          await broker.publishResult({
            taskId: payload.taskId,
            status: 'success',
            result: { staleLeaseWon: true },
            leaseId: staleLeaseId
          });
        })().catch(err => {
          console.error(`Failed to publish stale lease result in durability test: ${err.message}`);
        });
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 50));
      await broker.publishResult({
        taskId: payload.taskId,
        status: 'success',
        result: { currentLeaseWon: true, attempts },
        leaseId: payload.leaseId
      });
    }, 'stale-lease-worker');

    const result = await withTimeout(broker.publish(createTask(`stale-${Date.now()}`)), 4000);
    assert(result.status === 'success', `Expected eventual success, got ${JSON.stringify(result)}`);
    assert(result.result?.currentLeaseWon === true, `Expected current lease result to win, got ${JSON.stringify(result)}`);
    assert(result.result?.staleLeaseWon !== true, `Stale lease result should not win, got ${JSON.stringify(result)}`);
  } finally {
    broker.dispose();
  }
}

async function suspendWorkflowForRestart(stateStore: StateStore, approvalId: string, threadId: string) {
  const result = await new Orchestrator({ stateStore }).executeWorkflow(
    'requires human approval before continuing',
    {
      paradigm: 'HIERARCHICAL',
      agents: [new DurableSuspendingAgent(`suspender-${approvalId}`, approvalId)],
      maxRetries: 0
    },
    threadId
  );

  assert(result.status === 'SUSPENDED' && result.approvalId === approvalId, `Expected suspended workflow, got ${JSON.stringify(result)}`);
  const saved = await stateStore.getState(approvalId);
  assert(saved?.threadId === threadId, `Expected saved suspended state for ${approvalId}, got ${JSON.stringify(saved)}`);
}

async function testFreshOrchestratorResumesSuspendedWorkflow() {
  const stateStore = new StateStore();
  const approvalId = `restart-approval-${Date.now()}`;
  const threadId = `DURABILITY_APPROVAL_${Date.now()}`;

  await suspendWorkflowForRestart(stateStore, approvalId, threadId);

  const result = await new Orchestrator({ stateStore }).resumeWorkflow(
    approvalId,
    'APPROVED',
    'continue after restart',
    [new DurableResultAgent('resume-completer', 'resumed-after-restart')]
  );

  assert(result.answer === 'resumed-after-restart', `Expected resumed result, got ${JSON.stringify(result)}`);
  assert(typeof result.task === 'string' && result.task.includes('continue after restart'), `Expected human feedback in resumed task, got ${JSON.stringify(result)}`);
  const saved = await stateStore.getState(approvalId);
  assert(!saved, `Successful resume should delete approval state, got ${JSON.stringify(saved)}`);
}

async function testFailedResumeKeepsSuspendedState() {
  const stateStore = new StateStore();
  const approvalId = `failed-resume-approval-${Date.now()}`;
  const threadId = `DURABILITY_FAILED_RESUME_${Date.now()}`;

  await suspendWorkflowForRestart(stateStore, approvalId, threadId);

  let failed = false;
  try {
    await new Orchestrator({ stateStore }).resumeWorkflow(
      approvalId,
      'APPROVED',
      undefined,
      [new DurableFailingAgent('resume-failer')]
    );
  } catch {
    failed = true;
  }

  assert(failed, 'Expected resumed workflow to fail');
  const saved = await stateStore.getState(approvalId);
  assert(saved?.threadId === threadId, `Failed resume must keep approval state for retry, got ${JSON.stringify(saved)}`);
}

async function testGraphResumePreservesSavedShape() {
  const stateStore = new StateStore();
  const approvalId = `graph-resume-approval-${Date.now()}`;
  const threadId = `DURABILITY_GRAPH_RESUME_${Date.now()}`;
  const edges = [{ from: 'graph-start', to: 'graph-end' }];

  const suspended = await new Orchestrator({ stateStore }).executeWorkflow(
    'graph work that pauses before the second AI Agent',
    {
      paradigm: 'GRAPH',
      agents: [
        new DurableSuspendingAgent('graph-start', approvalId),
        new DurableResultAgent('graph-end', 'should-not-run-before-approval')
      ],
      edges,
      maxRetries: 0
    },
    threadId
  );

  assert(suspended.status === 'SUSPENDED', `Expected graph workflow to suspend, got ${JSON.stringify(suspended)}`);

  const saved = await stateStore.getState(approvalId);
  assert(JSON.stringify(saved?.config?.edges) === JSON.stringify(edges), `Expected graph edges to be saved, got ${JSON.stringify(saved?.config)}`);
  assert(saved?.agentDefinitions?.some(agent => agent.id === 'graph-start'), `Expected saved graph-start AI Agent id, got ${JSON.stringify(saved?.agentDefinitions)}`);
  assert(saved?.agentDefinitions?.some(agent => agent.id === 'graph-end'), `Expected saved graph-end AI Agent id, got ${JSON.stringify(saved?.agentDefinitions)}`);

  const resumed = await new Orchestrator({ stateStore }).resumeWorkflow(
    approvalId,
    'APPROVED',
    'continue graph after approval',
    [
      new DurableResultAgent('graph-start', 'start-after-approval'),
      new DurableResultAgent('graph-end', 'end-after-approval')
    ]
  );

  assert(resumed.graphCompleted === true, `Expected graph resume to complete, got ${JSON.stringify(resumed)}`);
  assert(resumed.results?.['graph-start']?.answer === 'start-after-approval', `Expected graph-start result after resume, got ${JSON.stringify(resumed.results)}`);
  assert(resumed.results?.['graph-end']?.answer === 'end-after-approval', `Expected graph-end result after resume, got ${JSON.stringify(resumed.results)}`);

  const remaining = await stateStore.getState(approvalId);
  assert(!remaining, `Successful graph resume should delete approval state, got ${JSON.stringify(remaining)}`);
}

const tests = [
  ['duplicate publish is idempotent while in flight', testDuplicatePublishIsIdempotentWhileInFlight],
  ['fresh broker recovers expired lease after restart', testFreshBrokerRecoversExpiredLeaseAfterRestart],
  ['stale lease result cannot win current lease', testStaleLeaseResultCannotWinCurrentLease],
  ['fresh orchestrator resumes suspended workflow', testFreshOrchestratorResumesSuspendedWorkflow],
  ['failed resume keeps suspended state', testFailedResumeKeepsSuspendedState],
  ['graph resume preserves saved shape', testGraphResumePreservesSavedShape]
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
