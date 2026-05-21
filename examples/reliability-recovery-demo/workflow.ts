import {
  BaseAgent,
  EventStore,
  LocalMessageBus,
  MemoryMesh,
  MemoryStateAdapter,
  Orchestrator,
  QueueBroker,
  createRuntimeContext,
  type LLMConfig,
  type RuntimeServices,
  type StateAdapter,
  type TaskPayload,
  type WorkflowConfig
} from '../../src/framework/index.ts';

const llmConfig: LLMConfig = {
  apiKey: 'SIMULATION_ONLY',
  modelName: 'deterministic-reliability-agent'
};

const noopCheckpointer = {
  async saveCheckpoint() {},
  async getLatestCheckpoint() {
    return null;
  },
  async clearCheckpoint() {}
};

export interface ReliabilityDemoTimelineEntry {
  step: string;
  aiAgent: string;
  status: 'started' | 'failed' | 'retried' | 'ignored' | 'accepted' | 'completed';
  detail: string;
}

export interface ReliabilityDemoResult {
  threadId: string;
  workflowCompleted: boolean;
  failedAiAgentRecovered: boolean;
  retryHappened: boolean;
  staleResultIgnored: boolean;
  finalResultAccepted: boolean;
  eventCount: number;
  timeline: ReliabilityDemoTimelineEntry[];
  finalDecision: {
    releaseGate: string;
    summary: string;
  };
}

interface RuntimeBundle {
  runtime: RuntimeServices;
  stateAdapter: StateAdapter;
  eventStore: EventStore;
  messageBus: LocalMessageBus;
  queueBroker: QueueBroker;
}

abstract class ReliabilityDemoAgent extends BaseAgent {
  constructor(
    id: string,
    name: string,
    description: string,
    role: 'WORKER' | 'JUDGE',
    runtime: RuntimeServices
  ) {
    const memory = new MemoryMesh({
      tenantId: 'reliability-recovery-demo',
      namespace: id,
      stateAdapter: runtime.stateAdapter,
      eventStore: runtime.eventStore
    });

    super(
      name,
      description,
      role,
      memory,
      llmConfig,
      ['deterministic_reasoning'],
      undefined,
      undefined,
      undefined,
      id,
      runtime
    );
  }
}

class RequirementsAiAgent extends ReliabilityDemoAgent {
  constructor(runtime: RuntimeServices) {
    super(
      'reliability-requirements-agent',
      'Requirements AI Agent',
      'Checks whether the requested workflow has clear release criteria.',
      'WORKER',
      runtime
    );
  }

  public async execute(task: any) {
    return {
      aiAgent: this.card.name,
      status: 'ok',
      summary: `Release criteria reviewed for ${task.serviceName}.`,
      requiredSignals: ['tests-pass', 'risk-review-pass', 'human-approval-if-high-risk']
    };
  }
}

class RiskAiAgent extends ReliabilityDemoAgent {
  private attempts = 0;

  constructor(runtime: RuntimeServices) {
    super(
      'reliability-risk-agent',
      'Risk AI Agent',
      'Checks risky deployment behavior and intentionally fails once in the demo.',
      'WORKER',
      runtime
    );
  }

  public async execute(task: any) {
    this.attempts++;
    if (this.attempts === 1) {
      throw new Error('Simulated AI Agent crash while checking deployment risk.');
    }

    return {
      aiAgent: this.card.name,
      status: 'ok-after-retry',
      attempts: this.attempts,
      summary: `Recovered and completed risk review for ${task.serviceName}.`,
      risk: 'medium'
    };
  }
}

class ReleaseJudgeAiAgent extends ReliabilityDemoAgent {
  constructor(runtime: RuntimeServices) {
    super(
      'reliability-release-judge',
      'Release Judge AI Agent',
      'Accepts the recovered specialist outputs and produces the final decision.',
      'JUDGE',
      runtime
    );
  }

  public async execute(task: string) {
    const recovered = task.includes('ok-after-retry');
    return {
      aiAgent: this.card.name,
      releaseGate: recovered ? 'PROCEED_WITH_MONITORING' : 'HOLD',
      summary: recovered
        ? 'All required AI Agent reviews completed after queue recovery.'
        : 'Release held because recovery evidence was not present.'
    };
  }
}

function createRuntimeBundle(threadId: string): RuntimeBundle {
  const stateAdapter = new MemoryStateAdapter();
  const messageBus = new LocalMessageBus();
  const eventStore = new EventStore({
    stateAdapter,
    messageBus,
    historyKey: `events:${threadId}`,
    topic: `events:${threadId}`
  });
  const queueBroker = new QueueBroker({
    stateAdapter,
    messageBus,
    namespace: `reliability-demo:${threadId}`,
    visibilityTimeoutMs: 150,
    defaultMaxAttempts: 3
  });
  const runtime = createRuntimeContext({
    tenantId: 'reliability-recovery-demo',
    stateAdapter,
    eventStore,
    queueBroker,
    checkpointer: noopCheckpointer
  });

  return { runtime, stateAdapter, eventStore, messageBus, queueBroker };
}

function appendTimelineEvent(
  eventStore: EventStore,
  threadId: string,
  entry: ReliabilityDemoTimelineEntry
) {
  eventStore.append({
    type: 'SYSTEM_HOOK',
    sourceAgentId: entry.aiAgent,
    threadId,
    payload: {
      action: 'RELIABILITY_DEMO_STEP',
      ...entry
    }
  });
}

function collectTimeline(eventStore: EventStore, threadId: string): ReliabilityDemoTimelineEntry[] {
  return eventStore
    .getEventsByThread(threadId)
    .map(event => event.payload)
    .filter(payload => payload?.action === 'RELIABILITY_DEMO_STEP')
    .map(payload => ({
      step: payload.step,
      aiAgent: payload.aiAgent,
      status: payload.status,
      detail: payload.detail
    }));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))
  ]);
}

async function waitFor<T>(
  read: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  timeoutMs = 3000
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

function startDeterministicWorker(runtime: RuntimeServices, threadId: string) {
  return runtime.queueBroker.subscribeToAllTasks(async (task: TaskPayload) => {
    const agent = runtime.agentRegistry.get(task.agentId);
    const aiAgentName = agent?.card.name || task.agentId;

    appendTimelineEvent(runtime.eventStore, threadId, {
      step: `attempt-${task.agentId}`,
      aiAgent: aiAgentName,
      status: 'started',
      detail: `Worker leased task ${task.taskId}.`
    });

    if (!agent) {
      await runtime.queueBroker.publishResult({
        taskId: task.taskId,
        status: 'error',
        error: `AI Agent ${task.agentId} was not registered.`,
        leaseId: task.leaseId
      });
      return;
    }

    try {
      const result = await agent.execute(task.payload, task.threadId);
      appendTimelineEvent(runtime.eventStore, threadId, {
        step: `accepted-${task.agentId}`,
        aiAgent: aiAgentName,
        status: 'accepted',
        detail: `Accepted result from lease ${task.leaseId}.`
      });
      await runtime.queueBroker.publishResult({
        taskId: task.taskId,
        status: 'success',
        result,
        leaseId: task.leaseId
      });
    } catch (err: any) {
      appendTimelineEvent(runtime.eventStore, threadId, {
        step: `failed-${task.agentId}`,
        aiAgent: aiAgentName,
        status: 'failed',
        detail: err.message || String(err)
      });
      await runtime.queueBroker.publishResult({
        taskId: task.taskId,
        status: 'error',
        error: err.message || String(err),
        leaseId: task.leaseId
      });
    }
  }, 'reliability-demo-worker');
}

async function runOrchestratedRecoveryWorkflow(bundle: RuntimeBundle, threadId: string) {
  const requirements = new RequirementsAiAgent(bundle.runtime);
  const risk = new RiskAiAgent(bundle.runtime);
  const judge = new ReleaseJudgeAiAgent(bundle.runtime);
  const stopWorker = startDeterministicWorker(bundle.runtime, threadId);

  try {
    const config: WorkflowConfig = {
      paradigm: 'GRAPH',
      agents: [requirements, risk, judge],
      edges: [
        { from: requirements.card.id, to: judge.card.id },
        { from: risk.card.id, to: judge.card.id }
      ],
      maxRetries: 0,
      useDistributedQueue: true,
      enableLearning: false,
      enableReflection: false,
      runtime: bundle.runtime,
      blackboard: {
        demo: 'reliability-recovery',
        expectedFailure: risk.card.id
      }
    };

    const result = await new Orchestrator(bundle.runtime).executeWorkflow({
      serviceName: 'payments-api',
      change: 'deploy webhook guarded by release policy'
    }, config, threadId);

    appendTimelineEvent(bundle.eventStore, threadId, {
      step: 'workflow-completed',
      aiAgent: 'Orchestrator',
      status: 'completed',
      detail: 'The graph workflow completed after the failed AI Agent was retried.'
    });

    return result;
  } finally {
    stopWorker();
  }
}

async function runStaleLeaseGuard(bundle: RuntimeBundle, threadId: string): Promise<boolean> {
  const broker = new QueueBroker({
    stateAdapter: bundle.stateAdapter,
    messageBus: bundle.messageBus,
    namespace: `reliability-demo-stale:${threadId}`,
    visibilityTimeoutMs: 100,
    defaultMaxAttempts: 3
  });

  try {
    let attempts = 0;
    let stalePublishAttempt: Promise<void> = Promise.resolve();
    broker.subscribeToAllTasks(async payload => {
      attempts++;
      if (attempts === 1) {
        const staleLeaseId = payload.leaseId;
        appendTimelineEvent(bundle.eventStore, threadId, {
          step: 'stale-started',
          aiAgent: 'Late Result AI Agent',
          status: 'started',
          detail: `First lease ${staleLeaseId} will expire without an accepted result.`
        });

        stalePublishAttempt = (async () => {
          await waitFor(
            () => broker.getTaskRecord(payload.taskId),
            record => Boolean(record && record.attempts >= 2 && record.leaseId !== staleLeaseId),
            4000
          );
          await broker.publishResult({
            taskId: payload.taskId,
            status: 'success',
            result: { staleLeaseWon: true },
            leaseId: staleLeaseId
          });
        })().catch(err => {
          appendTimelineEvent(bundle.eventStore, threadId, {
            step: 'stale-error',
            aiAgent: 'Late Result AI Agent',
            status: 'failed',
            detail: err.message || String(err)
          });
        });
        return;
      }

      appendTimelineEvent(bundle.eventStore, threadId, {
        step: 'stale-retry',
        aiAgent: 'Late Result AI Agent',
        status: 'retried',
        detail: `New lease ${payload.leaseId} replaced the expired lease.`
      });

      await broker.publishResult({
        taskId: payload.taskId,
        status: 'success',
        result: { currentLeaseWon: true, attempts },
        leaseId: payload.leaseId
      });
    }, 'late-result-worker');

    const taskId = `late-result-${threadId}`;
    const result = await withTimeout(broker.publish({
      taskId,
      threadId,
      agentId: 'late-result-agent',
      agentConfig: {},
      payload: { demo: 'stale-lease-guard' },
      blackboard: {},
      maxAttempts: 3
    }), 5000);

    await withTimeout(stalePublishAttempt, 1000);
    const record = await broker.getTaskRecord(taskId);
    const ignored = result.status === 'success'
      && result.result?.currentLeaseWon === true
      && record?.result?.staleLeaseWon !== true;

    appendTimelineEvent(bundle.eventStore, threadId, {
      step: 'stale-ignored',
      aiAgent: 'QueueBroker',
      status: ignored ? 'ignored' : 'failed',
      detail: ignored
        ? 'The stale late result did not overwrite the current accepted result.'
        : 'The stale late result check did not prove the expected guard.'
    });

    return ignored;
  } finally {
    broker.dispose();
  }
}

export async function runReliabilityRecoveryDemo(
  threadId = `RELIABILITY_DEMO_${Date.now()}`
): Promise<ReliabilityDemoResult> {
  const bundle = createRuntimeBundle(threadId);

  try {
    const workflowResult = await runOrchestratedRecoveryWorkflow(bundle, threadId);
    const staleResultIgnored = await runStaleLeaseGuard(bundle, threadId);
    const timeline = collectTimeline(bundle.eventStore, threadId);
    const finalState = workflowResult.finalState || {};
    const retryHappened = timeline.some(entry =>
      entry.aiAgent === 'Risk AI Agent' && entry.status === 'failed'
    ) && timeline.filter(entry => entry.aiAgent === 'Risk AI Agent' && entry.status === 'started').length >= 2;

    return {
      threadId,
      workflowCompleted: workflowResult.graphCompleted === true,
      failedAiAgentRecovered: retryHappened && finalState.releaseGate === 'PROCEED_WITH_MONITORING',
      retryHappened,
      staleResultIgnored,
      finalResultAccepted: finalState.releaseGate === 'PROCEED_WITH_MONITORING',
      eventCount: bundle.eventStore.getEventsByThread(threadId).length,
      timeline,
      finalDecision: {
        releaseGate: finalState.releaseGate || 'UNKNOWN',
        summary: finalState.summary || 'No final summary was produced.'
      }
    };
  } finally {
    bundle.queueBroker.dispose();
    bundle.eventStore.dispose();
  }
}
