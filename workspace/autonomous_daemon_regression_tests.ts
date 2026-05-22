import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { AutonomousDaemon } from '../src/framework/orchestration/AutonomousDaemon.ts';
import { readProjectBoard } from '../src/framework/tools/ProjectBoardStore.ts';
import { AgentRegistry, EventStore, globalEventStore, globalRegistry, LocalMessageBus, MemoryStateAdapter, createRuntimeContext } from '../src/framework/index.ts';
import { SimulationManager } from '../src/framework/core/SimulationManager.ts';

const projectPath = path.join(process.cwd(), 'workspace', 'projects.json');

type TestDaemonOptions = {
  now?: () => number;
  staleTaskMs?: number;
  maxTaskRuntimeMs?: number;
  heartbeatIntervalMs?: number;
  maxAttempts?: number;
  runtime?: any;
};

class TestDaemon extends AutonomousDaemon {
  public executions: Array<{ projectId: string; taskId: string }> = [];

  constructor(private readonly result: any = 'daemon completed', options: TestDaemonOptions = {}) {
    super(100000, options);
  }

  protected async executeSwarmTask(project: any, task: any): Promise<any> {
    this.executions.push({ projectId: project.id, taskId: task.id });
    return typeof this.result === 'function' ? this.result(project, task, this.executions.length) : this.result;
  }

  public async exposeFinalize(projectId: string, taskId: string, runId: string, result: any, isError = false) {
    await this.finalizeTask(projectId, taskId, runId, result, isError);
  }
}

class ExposedDaemon extends AutonomousDaemon {
  public async exposeExecuteSwarmTask(project: any, task: any) {
    return this.executeSwarmTask(project, task);
  }
}

function createScopedRuntime(label: string) {
  const eventStore = new EventStore({
    stateAdapter: new MemoryStateAdapter(),
    messageBus: new LocalMessageBus(),
    historyKey: `daemon-${label}-${crypto.randomUUID()}`
  });
  const agentRegistry = new AgentRegistry({ eventStore });
  return {
    eventStore,
    agentRegistry,
    runtime: createRuntimeContext({
      tenantId: `tenant-${label}`,
      stateAdapter: new MemoryStateAdapter(),
      eventStore,
      agentRegistry
    })
  };
}

function writeBoard(board: any) {
  fs.mkdirSync(path.dirname(projectPath), { recursive: true });
  fs.writeFileSync(projectPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
}

async function waitForStatus(taskId: string, status: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const board = await readProjectBoard();
    const task = board.projects.flatMap((project: any) => project.tasks || []).find((item: any) => item.id === taskId);
    if (task?.status === status) return task;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${taskId} to become ${status}`);
}

async function waitForTask(taskId: string, predicate: (task: any) => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const board = await readProjectBoard();
    const task = board.projects.flatMap((project: any) => project.tasks || []).find((item: any) => item.id === taskId);
    if (task && predicate(task)) return task;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${taskId} to match predicate`);
}

async function withBoardFixture(run: () => Promise<void>) {
  const hadOriginal = fs.existsSync(projectPath);
  const original = hadOriginal ? fs.readFileSync(projectPath, 'utf8') : '';
  try {
    await run();
  } finally {
    if (hadOriginal) {
      fs.writeFileSync(projectPath, original, 'utf8');
    } else if (fs.existsSync(projectPath)) {
      fs.unlinkSync(projectPath);
    }
  }
}

async function testTodoTaskIsLeasedAndCompleted() {
  await withBoardFixture(async () => {
    writeBoard({
      projects: [{
        id: 'daemon-project',
        name: 'Daemon Project',
        tasks: [{
          id: 'task-todo',
          title: 'Run background AI Agent task',
          status: 'TODO',
          assignee: 'AI Bot'
        }]
      }]
    });

    const daemon = new TestDaemon('finished cleanly');
    await daemon.runOnce();
    const task = await waitForStatus('task-todo', 'DONE');

    assert.equal(daemon.executions.length, 1);
    assert.equal(task.daemonAttempts, 1);
    assert.equal(task.daemonLease, undefined);
    assert(String(task.description).includes('finished cleanly'));
  });
}

async function testExpiredTaskIsRequeuedAndRetried() {
  await withBoardFixture(async () => {
    writeBoard({
      projects: [{
        id: 'daemon-project',
        name: 'Daemon Project',
        tasks: [{
          id: 'task-expired',
          title: 'Recover stale task',
          status: 'IN_PROGRESS',
          assignee: 'AI Swarm',
          daemonAttempts: 1,
          daemonLease: {
            runId: 'old-run',
            startedAt: 100,
            expiresAt: 200
          }
        }]
      }]
    });

    const daemon = new TestDaemon('retry completed', { now: () => 1000, staleTaskMs: 5000, maxAttempts: 3 });
    await daemon.runOnce();
    const task = await waitForStatus('task-expired', 'DONE');

    assert.equal(daemon.executions.length, 1);
    assert.equal(task.daemonAttempts, 2);
    assert.equal(task.daemonLease, undefined);
    assert(String(task.description).includes('old-run'));
    assert(String(task.description).includes('retry completed'));
  });
}

async function testExpiredTaskBlocksAfterMaxAttempts() {
  await withBoardFixture(async () => {
    writeBoard({
      projects: [{
        id: 'daemon-project',
        name: 'Daemon Project',
        tasks: [{
          id: 'task-maxed',
          title: 'Do not retry forever',
          status: 'IN_PROGRESS',
          assignee: 'AI Bot',
          daemonAttempts: 3,
          daemonLease: {
            runId: 'maxed-run',
            startedAt: 100,
            expiresAt: 200
          }
        }]
      }]
    });

    const daemon = new TestDaemon('should not run', { now: () => 1000, staleTaskMs: 5000, maxAttempts: 3 });
    await daemon.runOnce();
    const board = await readProjectBoard();
    const task = board.projects[0].tasks[0];

    assert.equal(task.status, 'BLOCKED');
    assert.equal(task.daemonLease, undefined);
    assert.equal(daemon.executions.length, 0);
    assert(String(task.description).includes('Max retry count reached'));
  });
}

async function testDaemonRecoveryEventsUseScopedRuntime() {
  await withBoardFixture(async () => {
    const projectId = `daemon-scope-project-${crypto.randomUUID()}`;
    const taskId = `task-scope-${crypto.randomUUID()}`;
    writeBoard({
      projects: [{
        id: projectId,
        name: 'Scoped Daemon Project',
        tasks: [{
          id: taskId,
          title: 'Block scoped expired task',
          status: 'IN_PROGRESS',
          assignee: 'AI Bot',
          daemonAttempts: 3,
          daemonLease: {
            runId: 'scoped-expired-run',
            startedAt: 100,
            expiresAt: 200
          }
        }]
      }]
    });

    const { eventStore, runtime } = createScopedRuntime('recovery');
    try {
      const daemon = new TestDaemon('should not run', { now: () => 1000, staleTaskMs: 5000, maxAttempts: 3, runtime });
      await daemon.runOnce();

      const scopedEvent = eventStore.getLogs().find(event =>
        event.payload?.action === 'BACKGROUND_TASK_BLOCKED' &&
        event.payload?.projectId === projectId &&
        event.payload?.taskId === taskId
      );
      const leakedEvent = globalEventStore.getLogs().find(event =>
        event.payload?.action === 'BACKGROUND_TASK_BLOCKED' &&
        event.payload?.projectId === projectId &&
        event.payload?.taskId === taskId
      );

      assert(scopedEvent, 'Expected daemon recovery event in scoped event store');
      assert(!leakedEvent, 'Expected daemon recovery event not to leak into global event store');
    } finally {
      eventStore.dispose();
    }
  });
}

async function testLegacyInProgressTaskWithoutLeaseIsRecovered() {
  await withBoardFixture(async () => {
    writeBoard({
      projects: [{
        id: 'daemon-project',
        name: 'Daemon Project',
        tasks: [{
          id: 'task-legacy',
          title: 'Recover legacy in-progress task',
          status: 'IN_PROGRESS',
          assignee: 'AI Bot',
          daemonAttempts: 0
        }]
      }]
    });

    const daemon = new TestDaemon('legacy completed', { now: () => 1000, staleTaskMs: 5000, maxAttempts: 3 });
    await daemon.runOnce();
    const task = await waitForStatus('task-legacy', 'DONE');

    assert.equal(daemon.executions.length, 1);
    assert.equal(task.daemonAttempts, 1);
    assert.equal(task.daemonLease, undefined);
    assert(String(task.description).includes('legacy-unleased-run'));
    assert(String(task.description).includes('legacy completed'));
  });
}

async function testStaleFinalizeCannotOverwriteCurrentLease() {
  await withBoardFixture(async () => {
    writeBoard({
      projects: [{
        id: 'daemon-project',
        name: 'Daemon Project',
        tasks: [{
          id: 'task-current',
          title: 'Protect current run',
          status: 'IN_PROGRESS',
          assignee: 'AI Bot',
          daemonAttempts: 2,
          daemonLease: {
            runId: 'current-run',
            startedAt: Date.now(),
            expiresAt: Date.now() + 10000
          }
        }]
      }]
    });

    const daemon = new TestDaemon();
    await daemon.exposeFinalize('daemon-project', 'task-current', 'old-run', 'stale success');
    const board = await readProjectBoard();
    const task = board.projects[0].tasks[0];

    assert.equal(task.status, 'IN_PROGRESS');
    assert.equal(task.daemonLease.runId, 'current-run');
    assert(!String(task.description || '').includes('stale success'));
  });
}

async function testHeartbeatExtendsCurrentLease() {
  await withBoardFixture(async () => {
    writeBoard({
      projects: [{
        id: 'daemon-project',
        name: 'Daemon Project',
        tasks: [{
          id: 'task-heartbeat',
          title: 'Keep active work alive',
          status: 'TODO',
          assignee: 'AI Bot'
        }]
      }]
    });

    const daemon = new TestDaemon(new Promise(() => {}), {
      staleTaskMs: 100,
      maxTaskRuntimeMs: 500,
      heartbeatIntervalMs: 25,
      maxAttempts: 3
    });
    await daemon.runOnce();

    const leased = await waitForStatus('task-heartbeat', 'IN_PROGRESS');
    const initialHeartbeat = leased.daemonLease.lastHeartbeatAt;
    const updated = await waitForTask(
      'task-heartbeat',
      task => task.daemonLease?.lastHeartbeatAt > initialHeartbeat && task.daemonLease?.expiresAt > leased.daemonLease.expiresAt,
      300
    );

    assert.equal(updated.daemonAttempts, 1);
    assert.equal(updated.daemonLease.runId, leased.daemonLease.runId);
    daemon.stop();
  });
}

async function testHungTaskTimesOutAndBecomesRetryable() {
  await withBoardFixture(async () => {
    writeBoard({
      projects: [{
        id: 'daemon-project',
        name: 'Daemon Project',
        tasks: [{
          id: 'task-timeout',
          title: 'Timeout hung work',
          status: 'TODO',
          assignee: 'AI Bot'
        }]
      }]
    });

    const daemon = new TestDaemon(new Promise(() => {}), {
      staleTaskMs: 1000,
      maxTaskRuntimeMs: 30,
      heartbeatIntervalMs: 10,
      maxAttempts: 3
    });
    await daemon.runOnce();
    const task = await waitForStatus('task-timeout', 'TODO', 3000);

    assert.equal(task.daemonAttempts, 1);
    assert.equal(task.daemonLease, undefined);
    assert(String(task.description).includes('Timed out after 30ms'));
    daemon.stop();
  });
}

async function testHungTaskBlocksAtMaxAttempts() {
  await withBoardFixture(async () => {
    writeBoard({
      projects: [{
        id: 'daemon-project',
        name: 'Daemon Project',
        tasks: [{
          id: 'task-timeout-block',
          title: 'Block repeated hung work',
          status: 'TODO',
          assignee: 'AI Bot',
          daemonAttempts: 2
        }]
      }]
    });

    const daemon = new TestDaemon(new Promise(() => {}), {
      staleTaskMs: 1000,
      maxTaskRuntimeMs: 30,
      heartbeatIntervalMs: 10,
      maxAttempts: 3
    });
    await daemon.runOnce();
    const task = await waitForStatus('task-timeout-block', 'BLOCKED', 3000);

    assert.equal(task.daemonAttempts, 3);
    assert.equal(task.daemonLease, undefined);
    assert(String(task.description).includes('Timed out after 30ms'));
    daemon.stop();
  });
}

async function testLateTimedOutResultCannotOverwriteRetry() {
  await withBoardFixture(async () => {
    writeBoard({
      projects: [{
        id: 'daemon-project',
        name: 'Daemon Project',
        tasks: [{
          id: 'task-late-result',
          title: 'Protect retry from late result',
          status: 'TODO',
          assignee: 'AI Bot'
        }]
      }]
    });

    let releaseLateResult: (value: string) => void = () => {};
    const lateResult = new Promise<string>(resolve => { releaseLateResult = resolve; });
    const daemon = new TestDaemon((_project: any, _task: any, executionCount: number) => {
      return executionCount === 1 ? lateResult : 'retry completed';
    }, {
      staleTaskMs: 1000,
      maxTaskRuntimeMs: 30,
      heartbeatIntervalMs: 10,
      maxAttempts: 3
    });

    await daemon.runOnce();
    await waitForStatus('task-late-result', 'TODO', 3000);
    await daemon.runOnce();
    const completed = await waitForStatus('task-late-result', 'DONE', 3000);
    releaseLateResult('late stale result');
    await new Promise(resolve => setTimeout(resolve, 50));

    const board = await readProjectBoard();
    const task = board.projects[0].tasks[0];
    assert.equal(completed.daemonAttempts, 2);
    assert.equal(task.status, 'DONE');
    assert(String(task.description).includes('retry completed'));
    assert(!String(task.description).includes('late stale result'));
    daemon.stop();
  });
}

async function testDaemonSwarmUsesScopedRuntimeServices() {
  const { eventStore, agentRegistry, runtime } = createScopedRuntime('swarm');
  const beforeGlobalAgents = globalRegistry.getAllAgents().length;
  const daemon = new ExposedDaemon(100000, { runtime });
  const projectId = `daemon-swarm-project-${crypto.randomUUID()}`;
  const taskId = `task-swarm-${crypto.randomUUID()}`;

  SimulationManager.enable();
  try {
    await daemon.exposeExecuteSwarmTask(
      { id: projectId, name: 'Scoped Swarm Project' },
      { id: taskId, title: 'Run scoped daemon swarm', description: 'No real API calls.' }
    );

    const scopedStart = eventStore.getLogs().find(event =>
      event.payload?.action === 'BACKGROUND_TASK_STARTED' &&
      event.payload?.taskId === taskId
    );
    const leakedStart = globalEventStore.getLogs().find(event =>
      event.payload?.action === 'BACKGROUND_TASK_STARTED' &&
      event.payload?.taskId === taskId
    );

    assert(scopedStart, 'Expected daemon swarm start event in scoped event store');
    assert(!leakedStart, 'Expected daemon swarm start event not to leak into global event store');
    assert.equal(globalRegistry.getAllAgents().length, beforeGlobalAgents);
    assert.equal(agentRegistry.findAgentsByRole('WORKER').length, 0);
  } finally {
    SimulationManager.disable();
    eventStore.dispose();
  }
}

const tests = [
  ['TODO daemon task is leased and completed', testTodoTaskIsLeasedAndCompleted],
  ['expired daemon task is requeued and retried', testExpiredTaskIsRequeuedAndRetried],
  ['expired daemon task blocks after max attempts', testExpiredTaskBlocksAfterMaxAttempts],
  ['daemon recovery events use scoped runtime', testDaemonRecoveryEventsUseScopedRuntime],
  ['legacy in-progress task without lease is recovered', testLegacyInProgressTaskWithoutLeaseIsRecovered],
  ['stale finalize cannot overwrite current lease', testStaleFinalizeCannotOverwriteCurrentLease],
  ['heartbeat extends current lease', testHeartbeatExtendsCurrentLease],
  ['hung task times out and becomes retryable', testHungTaskTimesOutAndBecomesRetryable],
  ['hung task blocks at max attempts', testHungTaskBlocksAtMaxAttempts],
  ['late timed-out result cannot overwrite retry', testLateTimedOutResultCannotOverwriteRetry],
  ['daemon swarm uses scoped runtime services', testDaemonSwarmUsesScopedRuntimeServices]
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
process.exit(results.some(result => !result.ok) ? 1 : 0);
