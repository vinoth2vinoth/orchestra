import { IMessageBus, globalMessageBus } from '../core/MessageBus.ts';
import { StateAdapter, globalStateAdapter } from '../core/StateAdapter.ts';

export interface TaskPayload {
    taskId: string;
    threadId: string;
    agentId: string;
    agentConfig: any;
    payload: any;
    blackboard: any;
    maxAttempts?: number;
    leaseId?: string;
    idempotencyKey?: string;
}

export interface TaskResult {
    taskId: string;
    status: 'success' | 'error';
    result?: any;
    error?: string;
    leaseId?: string;
}

export type QueueTaskStatus = 'PENDING' | 'LEASED' | 'SUCCEEDED' | 'FAILED' | 'DEAD_LETTER';

export interface QueueTaskRecord {
    task: TaskPayload;
    status: QueueTaskStatus;
    attempts: number;
    maxAttempts: number;
    createdAt: number;
    updatedAt: number;
    leaseUntil?: number;
    leasedBy?: string;
    leaseId?: string;
    lastError?: string;
    result?: any;
    brokerId?: string;
}

export interface QueueBrokerOptions {
    visibilityTimeoutMs?: number;
    defaultMaxAttempts?: number;
    stateAdapter?: StateAdapter;
    messageBus?: IMessageBus;
    namespace?: string;
}

interface TaskSubscriber {
    id: string;
    handler: (task: TaskPayload) => Promise<void> | void;
    active: boolean;
}

/**
 * QueueBroker provides lease/ACK/NACK semantics for distributed execution.
 *
 * The local broker still dispatches in-process worker callbacks, but task state is
 * stored through StateAdapter so distributed deployments can recover pending/leased work.
 */
export class QueueBroker {
    private completionCallbacks: Map<string, Set<(result: TaskResult) => void>> = new Map();
    private allTasksSubscribers: TaskSubscriber[] = [];
    private nextSubscriberIndex = 0;
    private dispatching = false;
    private redispatchRequested = false;
    private readonly pendingKey: string;
    private readonly knownTasksKey: string;
    private readonly dlqKey: string;
    private readonly visibilityTimeoutMs: number;
    private readonly defaultMaxAttempts: number;
    private readonly stateAdapter: StateAdapter;
    private readonly messageBus: IMessageBus;
    private readonly namespace: string;
    private readonly brokerId = crypto.randomUUID();
    private readonly recoveryTimer: NodeJS.Timeout;
    private resultUnsubscribe?: () => void;
    private disposed = false;

    constructor(options: QueueBrokerOptions = {}) {
        this.visibilityTimeoutMs = options.visibilityTimeoutMs ?? Number(process.env.ORCHESTRA_QUEUE_VISIBILITY_TIMEOUT_MS || 30000);
        this.defaultMaxAttempts = options.defaultMaxAttempts ?? Number(process.env.ORCHESTRA_QUEUE_MAX_ATTEMPTS || 3);
        this.stateAdapter = options.stateAdapter || globalStateAdapter;
        this.messageBus = options.messageBus || globalMessageBus;
        this.namespace = options.namespace || 'queue';
        this.pendingKey = this.key('pending');
        this.knownTasksKey = this.key('known_tasks');
        this.dlqKey = this.key('dead_letter');

        this.messageBus.subscribe(this.topic('TASK_RESULTS'), (result: TaskResult) => {
            this.handleTaskResult(result).catch(err => {
                console.error(`[QueueBroker] Failed to handle task result for ${result.taskId}:`, err);
            });
        }).then(unsubscribe => {
            if (this.disposed) {
                unsubscribe();
            } else {
                this.resultUnsubscribe = unsubscribe;
            }
        });

        this.recoveryTimer = setInterval(() => {
            this.recoverExpiredLeases().catch(err => console.error('[QueueBroker] Lease recovery failed:', err));
        }, Math.max(1000, Math.min(this.visibilityTimeoutMs / 2, 5000)));
        if (this.recoveryTimer.unref) this.recoveryTimer.unref();

        setTimeout(() => {
            this.recoverExpiredLeases().catch(err => console.error('[QueueBroker] Boot recovery failed:', err));
        }, 0);
    }

    public async publish(task: TaskPayload): Promise<TaskResult> {
        const now = Date.now();
        const existing = await this.getTaskRecord(task.taskId);
        if (existing) {
            if (existing.status === 'SUCCEEDED') {
                return { taskId: task.taskId, status: 'success', result: existing.result };
            }

            if (existing.status === 'DEAD_LETTER') {
                return {
                    taskId: task.taskId,
                    status: 'error',
                    error: existing.lastError || `Task ${task.taskId} is already in the dead-letter queue`
                };
            }

            return new Promise(resolve => {
                this.addCompletionCallback(task.taskId, resolve);
                if (existing.status === 'PENDING') {
                    void this.enqueuePendingTask(task.taskId).then(() => this.dispatchAvailableTasks());
                }
            });
        }

        const record: QueueTaskRecord = {
            task,
            status: 'PENDING',
            attempts: 0,
            maxAttempts: task.maxAttempts ?? this.defaultMaxAttempts,
            createdAt: now,
            updatedAt: now,
            brokerId: this.brokerId
        };

        return new Promise((resolve) => {
            this.addCompletionCallback(task.taskId, resolve);
            this.stateAdapter.set(this.recordKey(task.taskId), record)
                .then(() => this.addKnownTask(task.taskId))
                .then(() => this.stateAdapter.mutate<string[]>(this.pendingKey, current => {
                    const queue = current || [];
                    return queue.includes(task.taskId) ? queue : [...queue, task.taskId];
                }))
                .then(() => this.dispatchAvailableTasks())
                .catch(err => {
                    this.clearCompletionCallbacks(task.taskId);
                    resolve({
                        taskId: task.taskId,
                        status: 'error',
                        error: err.message || String(err)
                    });
                });
        });
    }

    public subscribe(agentId: string, handler: (task: TaskPayload) => Promise<void> | void) {
        this.messageBus.subscribe(this.topic(`TASKS:${agentId}`), handler);
    }

    public subscribeToAllTasks(handler: (task: TaskPayload) => Promise<void> | void, subscriberId: string = crypto.randomUUID()) {
        this.unsubscribeFromAllTasks(subscriberId);
        this.allTasksSubscribers.push({ id: subscriberId, handler, active: false });
        void this.dispatchAvailableTasks();
        return () => this.unsubscribeFromAllTasks(subscriberId);
    }

    public async publishResult(result: TaskResult) {
        await this.handleTaskResult(result);
        await this.messageBus.publish(this.topic('TASK_RESULTS'), result);
    }

    public dispose() {
        this.disposed = true;
        clearInterval(this.recoveryTimer);
        this.resultUnsubscribe?.();
        this.completionCallbacks.clear();
        this.allTasksSubscribers = [];
    }

    public async ackTask(taskId: string, result: any): Promise<void> {
        const record = await this.getTaskRecord(taskId);
        await this.handleTaskResult({ taskId, status: 'success', result, leaseId: record?.leaseId });
    }

    public async nackTask(taskId: string, error: string): Promise<void> {
        const record = await this.getTaskRecord(taskId);
        await this.handleTaskResult({ taskId, status: 'error', error, leaseId: record?.leaseId });
    }

    public async getTaskRecord(taskId: string): Promise<QueueTaskRecord | null> {
        return this.stateAdapter.get<QueueTaskRecord>(this.recordKey(taskId));
    }

    public async getDeadLetterQueue(): Promise<string[]> {
        return (await this.stateAdapter.get<string[]>(this.dlqKey)) || [];
    }

    public async resetForTests(): Promise<void> {
        const knownTasks = (await this.stateAdapter.get<string[]>(this.knownTasksKey)) || [];
        await Promise.all(knownTasks.map(taskId => this.stateAdapter.delete(this.recordKey(taskId))));
        await this.stateAdapter.set(this.knownTasksKey, []);
        await this.stateAdapter.set(this.pendingKey, []);
        await this.stateAdapter.set(this.dlqKey, []);
        this.completionCallbacks.clear();
        this.allTasksSubscribers = [];
        this.nextSubscriberIndex = 0;
        this.dispatching = false;
    }

    public unsubscribeFromAllTasks(subscriberId: string): void {
        this.allTasksSubscribers = this.allTasksSubscribers.filter(subscriber => subscriber.id !== subscriberId);
        if (this.allTasksSubscribers.length === 0) {
            this.nextSubscriberIndex = 0;
        } else {
            this.nextSubscriberIndex = this.nextSubscriberIndex % this.allTasksSubscribers.length;
        }
        void this.dispatchAvailableTasks();
    }

    private async handleTaskResult(result: TaskResult) {
        const record = await this.getTaskRecord(result.taskId);
        if (!record) return;
        if (record.status === 'SUCCEEDED') {
            this.resolveTask({ taskId: result.taskId, status: 'success', result: record.result });
            return;
        }
        if (record.status === 'DEAD_LETTER') {
            this.resolveTask({
                taskId: result.taskId,
                status: 'error',
                error: record.lastError || `Task ${result.taskId} is already in the dead-letter queue`
            });
            return;
        }
        if (record.leaseUntil && record.leaseUntil < Date.now()) {
            return;
        }
        if (record.leaseId && result.leaseId !== record.leaseId) {
            return;
        }

        if (result.status === 'success') {
            const nextRecord: QueueTaskRecord = {
                ...record,
                status: 'SUCCEEDED',
                result: result.result,
                leaseUntil: undefined,
                leasedBy: undefined,
                leaseId: undefined,
                updatedAt: Date.now()
            };
            await this.stateAdapter.set(this.recordKey(result.taskId), nextRecord);
            this.resolveTask(result);
            void this.dispatchAvailableTasks();
            return;
        }

        await this.retryOrDeadLetter(record, result.error || 'Worker returned an error');
    }

    private async retryOrDeadLetter(record: QueueTaskRecord, error: string) {
        const nextRecord: QueueTaskRecord = {
            ...record,
            status: record.attempts >= record.maxAttempts ? 'DEAD_LETTER' : 'PENDING',
            lastError: error,
            leaseUntil: undefined,
            leasedBy: undefined,
            leaseId: undefined,
            updatedAt: Date.now(),
            brokerId: this.brokerId
        };

        await this.stateAdapter.set(this.recordKey(record.task.taskId), nextRecord);

        if (nextRecord.status === 'DEAD_LETTER') {
            await this.stateAdapter.mutate<string[]>(this.dlqKey, current => {
                const dlq = current || [];
                return dlq.includes(record.task.taskId) ? dlq : [...dlq, record.task.taskId];
            });
            this.resolveTask({
                taskId: record.task.taskId,
                status: 'error',
                error: `Task moved to DLQ after ${record.attempts} attempts: ${error}`
            });
            return;
        }

        await this.stateAdapter.mutate<string[]>(this.pendingKey, current => {
            const queue = current || [];
            return queue.includes(record.task.taskId) ? queue : [...queue, record.task.taskId];
        });
        void this.dispatchAvailableTasks();
    }

    private async recoverExpiredLeases() {
        const pending = await this.stateAdapter.get<string[]>(this.pendingKey);
        await this.stateAdapter.mutate<string[]>(this.pendingKey, current => current || []);

        const queue = pending || [];
        const now = Date.now();
        const taskIds = new Set(queue);

        const knownTasks = (await this.stateAdapter.get<string[]>(this.knownTasksKey)) || [];
        for (const taskId of knownTasks) {
            const record = await this.getTaskRecord(taskId);
            if (!record) continue;

            if (record.status === 'PENDING' && !taskIds.has(taskId)) {
                await this.enqueuePendingTask(taskId);
                continue;
            }

            if (record.status !== 'LEASED' || !record.leaseUntil || record.leaseUntil > now) continue;
            if (taskIds.has(taskId)) continue;
            await this.retryOrDeadLetter(record, `Lease expired for worker ${record.leasedBy || 'unknown'}`);
        }

        void this.dispatchAvailableTasks();
    }

    private async dispatchAvailableTasks() {
        if (this.dispatching) {
            this.redispatchRequested = true;
            return;
        }
        this.dispatching = true;

        try {
            while (true) {
                this.redispatchRequested = false;
                const subscriber = this.nextAvailableSubscriber();
                if (!subscriber) break;

                const taskId = await this.popPendingTaskId();
                if (!taskId) break;

                const record = await this.getTaskRecord(taskId);
                if (!record || record.status !== 'PENDING') continue;

                const now = Date.now();
                const leaseId = crypto.randomUUID();
                const leased: QueueTaskRecord = {
                    ...record,
                    task: { ...record.task, leaseId },
                    status: 'LEASED',
                    attempts: record.attempts + 1,
                    leasedBy: subscriber.id,
                    leaseId,
                    leaseUntil: now + this.visibilityTimeoutMs,
                    updatedAt: now,
                    brokerId: this.brokerId
                };
                await this.stateAdapter.set(this.recordKey(taskId), leased);

                subscriber.active = true;
                setTimeout(() => {
                    Promise.resolve(subscriber.handler(leased.task))
                        .catch(err => {
                            this.retryOrDeadLetter(leased, err.message || String(err)).catch(console.error);
                        })
                        .finally(() => {
                            subscriber.active = false;
                            void this.dispatchAvailableTasks();
                        });
                }, 0);
            }
        } finally {
            this.dispatching = false;
            if (this.redispatchRequested) {
                void this.dispatchAvailableTasks();
            }
        }
    }

    private nextAvailableSubscriber(): TaskSubscriber | null {
        if (this.allTasksSubscribers.length === 0) return null;

        for (let i = 0; i < this.allTasksSubscribers.length; i++) {
            const idx = (this.nextSubscriberIndex + i) % this.allTasksSubscribers.length;
            const subscriber = this.allTasksSubscribers[idx];
            if (!subscriber.active) {
                this.nextSubscriberIndex = (idx + 1) % this.allTasksSubscribers.length;
                return subscriber;
            }
        }

        return null;
    }

    private async popPendingTaskId(): Promise<string | null> {
        let popped: string | null = null;
        await this.stateAdapter.mutate<string[]>(this.pendingKey, current => {
            const queue = [...(current || [])];
            popped = queue.shift() || null;
            return queue;
        });
        return popped;
    }

    private async enqueuePendingTask(taskId: string): Promise<void> {
        await this.stateAdapter.mutate<string[]>(this.pendingKey, current => {
            const queue = current || [];
            return queue.includes(taskId) ? queue : [...queue, taskId];
        });
    }

    private async addKnownTask(taskId: string): Promise<void> {
        await this.stateAdapter.mutate<string[]>(this.knownTasksKey, current => {
            const tasks = current || [];
            return tasks.includes(taskId) ? tasks : [...tasks, taskId];
        });
    }

    private resolveTask(result: TaskResult) {
        const callbacks = this.completionCallbacks.get(result.taskId);
        if (callbacks) {
            callbacks.forEach(callback => callback(result));
            this.completionCallbacks.delete(result.taskId);
        }
    }

    private addCompletionCallback(taskId: string, callback: (result: TaskResult) => void) {
        const callbacks = this.completionCallbacks.get(taskId) || new Set<(result: TaskResult) => void>();
        callbacks.add(callback);
        this.completionCallbacks.set(taskId, callbacks);
    }

    private clearCompletionCallbacks(taskId: string) {
        this.completionCallbacks.delete(taskId);
    }

    private recordKey(taskId: string) {
        return this.key(`task:${taskId}`);
    }

    private key(suffix: string) {
        return `${this.namespace}:${suffix}`;
    }

    private topic(topic: string) {
        return `${this.namespace}:${topic}`;
    }
}

export const globalQueueBroker = new QueueBroker();
