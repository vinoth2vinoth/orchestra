import { globalMessageBus } from '../core/MessageBus.ts';
import { globalStateAdapter } from '../core/StateAdapter.ts';

export interface TaskPayload {
    taskId: string;
    threadId: string;
    agentId: string;
    agentConfig: any;
    payload: any;
    blackboard: any;
    maxAttempts?: number;
}

export interface TaskResult {
    taskId: string;
    status: 'success' | 'error';
    result?: any;
    error?: string;
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
    lastError?: string;
    result?: any;
    brokerId?: string;
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
 * stored through StateAdapter so Redis deployments can recover pending/leased work.
 */
export class QueueBroker {
    private completionCallbacks: Map<string, (result: TaskResult) => void> = new Map();
    private allTasksSubscribers: TaskSubscriber[] = [];
    private nextSubscriberIndex = 0;
    private dispatching = false;
    private redispatchRequested = false;
    private readonly pendingKey = 'queue:pending';
    private readonly knownTasksKey = 'queue:known_tasks';
    private readonly dlqKey = 'queue:dead_letter';
    private readonly visibilityTimeoutMs: number;
    private readonly defaultMaxAttempts: number;
    private readonly brokerId = crypto.randomUUID();
    private readonly recoveryTimer: NodeJS.Timeout;
    private resultUnsubscribe?: () => void;

    constructor(options: { visibilityTimeoutMs?: number; defaultMaxAttempts?: number } = {}) {
        this.visibilityTimeoutMs = options.visibilityTimeoutMs ?? Number(process.env.ORCHESTRA_QUEUE_VISIBILITY_TIMEOUT_MS || 30000);
        this.defaultMaxAttempts = options.defaultMaxAttempts ?? Number(process.env.ORCHESTRA_QUEUE_MAX_ATTEMPTS || 3);

        globalMessageBus.subscribe('TASK_RESULTS', (result: TaskResult) => {
            this.handleTaskResult(result).catch(err => {
                console.error(`[QueueBroker] Failed to handle task result for ${result.taskId}:`, err);
            });
        }).then(unsubscribe => {
            this.resultUnsubscribe = unsubscribe;
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
            this.completionCallbacks.set(task.taskId, resolve);
            globalStateAdapter.set(this.recordKey(task.taskId), record)
                .then(() => this.addKnownTask(task.taskId))
                .then(() => globalStateAdapter.mutate<string[]>(this.pendingKey, current => {
                    const queue = current || [];
                    return queue.includes(task.taskId) ? queue : [...queue, task.taskId];
                }))
                .then(() => this.dispatchAvailableTasks())
                .catch(err => {
                    this.completionCallbacks.delete(task.taskId);
                    resolve({
                        taskId: task.taskId,
                        status: 'error',
                        error: err.message || String(err)
                    });
                });
        });
    }

    public subscribe(agentId: string, handler: (task: TaskPayload) => Promise<void> | void) {
        globalMessageBus.subscribe(`TASKS:${agentId}`, handler);
    }

    public subscribeToAllTasks(handler: (task: TaskPayload) => Promise<void> | void, subscriberId: string = crypto.randomUUID()) {
        if (this.allTasksSubscribers.some(s => s.id === subscriberId)) return;
        this.allTasksSubscribers.push({ id: subscriberId, handler, active: false });
        void this.dispatchAvailableTasks();
    }

    public async publishResult(result: TaskResult) {
        await globalMessageBus.publish('TASK_RESULTS', result);
    }

    public dispose() {
        clearInterval(this.recoveryTimer);
        this.resultUnsubscribe?.();
        this.completionCallbacks.clear();
        this.allTasksSubscribers = [];
    }

    public async ackTask(taskId: string, result: any): Promise<void> {
        await this.handleTaskResult({ taskId, status: 'success', result });
    }

    public async nackTask(taskId: string, error: string): Promise<void> {
        await this.handleTaskResult({ taskId, status: 'error', error });
    }

    public async getTaskRecord(taskId: string): Promise<QueueTaskRecord | null> {
        return globalStateAdapter.get<QueueTaskRecord>(this.recordKey(taskId));
    }

    public async getDeadLetterQueue(): Promise<string[]> {
        return (await globalStateAdapter.get<string[]>(this.dlqKey)) || [];
    }

    public async resetForTests(): Promise<void> {
        const knownTasks = (await globalStateAdapter.get<string[]>(this.knownTasksKey)) || [];
        await Promise.all(knownTasks.map(taskId => globalStateAdapter.delete(this.recordKey(taskId))));
        await globalStateAdapter.set(this.knownTasksKey, []);
        await globalStateAdapter.set(this.pendingKey, []);
        await globalStateAdapter.set(this.dlqKey, []);
        this.completionCallbacks.clear();
        this.allTasksSubscribers = [];
        this.nextSubscriberIndex = 0;
        this.dispatching = false;
    }

    private async handleTaskResult(result: TaskResult) {
        const record = await this.getTaskRecord(result.taskId);
        if (!record || record.status === 'SUCCEEDED' || record.status === 'DEAD_LETTER') return;
        if (record.brokerId && record.brokerId !== this.brokerId) return;

        if (result.status === 'success') {
            const nextRecord: QueueTaskRecord = {
                ...record,
                status: 'SUCCEEDED',
                result: result.result,
                leaseUntil: undefined,
                leasedBy: undefined,
                updatedAt: Date.now()
            };
            await globalStateAdapter.set(this.recordKey(result.taskId), nextRecord);
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
            updatedAt: Date.now()
        };

        await globalStateAdapter.set(this.recordKey(record.task.taskId), nextRecord);

        if (nextRecord.status === 'DEAD_LETTER') {
            await globalStateAdapter.mutate<string[]>(this.dlqKey, current => {
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

        await globalStateAdapter.mutate<string[]>(this.pendingKey, current => {
            const queue = current || [];
            return queue.includes(record.task.taskId) ? queue : [...queue, record.task.taskId];
        });
        void this.dispatchAvailableTasks();
    }

    private async recoverExpiredLeases() {
        const pending = await globalStateAdapter.get<string[]>(this.pendingKey);
        await globalStateAdapter.mutate<string[]>(this.pendingKey, current => current || []);

        const queue = pending || [];
        const now = Date.now();
        const taskIds = new Set(queue);

        const knownTasks = (await globalStateAdapter.get<string[]>(this.knownTasksKey)) || [];
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
                const leased: QueueTaskRecord = {
                    ...record,
                    status: 'LEASED',
                    attempts: record.attempts + 1,
                    leasedBy: subscriber.id,
                    leaseUntil: now + this.visibilityTimeoutMs,
                    updatedAt: now
                };
                await globalStateAdapter.set(this.recordKey(taskId), leased);

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
        await globalStateAdapter.mutate<string[]>(this.pendingKey, current => {
            const queue = [...(current || [])];
            popped = queue.shift() || null;
            return queue;
        });
        return popped;
    }

    private async enqueuePendingTask(taskId: string): Promise<void> {
        await globalStateAdapter.mutate<string[]>(this.pendingKey, current => {
            const queue = current || [];
            return queue.includes(taskId) ? queue : [...queue, taskId];
        });
    }

    private async addKnownTask(taskId: string): Promise<void> {
        await globalStateAdapter.mutate<string[]>(this.knownTasksKey, current => {
            const tasks = current || [];
            return tasks.includes(taskId) ? tasks : [...tasks, taskId];
        });
    }

    private resolveTask(result: TaskResult) {
        const callback = this.completionCallbacks.get(result.taskId);
        if (callback) {
            callback(result);
            this.completionCallbacks.delete(result.taskId);
        }
    }

    private recordKey(taskId: string) {
        return `queue:task:${taskId}`;
    }
}

export const globalQueueBroker = new QueueBroker();
