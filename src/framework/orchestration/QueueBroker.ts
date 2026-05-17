import { BaseAgent } from '../agents/BaseAgent.ts';
import { globalMessageBus } from '../core/MessageBus.ts';

export interface TaskPayload {
    taskId: string;
    threadId: string;
    agentId: string;
    agentConfig: any;
    payload: any;
    blackboard: any;
}

export interface TaskResult {
    taskId: string;
    status: 'success' | 'error';
    result?: any;
    error?: string;
}

/**
 * QueueBroker facilitates distributed task execution across the swarm.
 * Refactored to use MessageBus for decentralized, multi-node capability.
 */
export class QueueBroker {
    private completionCallbacks: Map<string, (result: TaskResult) => void> = new Map();
    private activeTasks: Map<string, { startTime: number; task: TaskPayload }> = new Map();
    
    // Simple state for round-robin dispatch among workers
    private taskQueue: TaskPayload[] = [];
    private allTasksSubscribers: Array<(task: TaskPayload) => void> = [];
    private nextSubscriberIndex = 0;

    constructor() {
        // Listen for task completion results globally
        globalMessageBus.subscribe('TASK_RESULTS', (result: TaskResult) => {
            const callback = this.completionCallbacks.get(result.taskId);
            if (callback) {
                callback(result);
                this.completionCallbacks.delete(result.taskId);
                this.activeTasks.delete(result.taskId);
            }
        });

        // Periodic cleanup for orphaned tasks (H2 Remediation)
        const interval = setInterval(() => {
            const now = Date.now();
            this.activeTasks.forEach((entry, taskId) => {
                if (now - entry.startTime > 300000) { // 300s timeout for heavy tasks
                    console.warn(`[QueueBroker] Task ${taskId} timed out after 300s. Orphaning detected.`);
                    const callback = this.completionCallbacks.get(taskId);
                    if (callback) {
                        callback({
                            taskId,
                            status: 'error',
                            error: 'Task execution timed out (Worker likely crashed or hung).'
                        });
                        this.completionCallbacks.delete(taskId);
                    }
                    this.activeTasks.delete(taskId);
                }
            });
        }, 5000);
        if (interval.unref) interval.unref();
    }

    /**
     * Publishes a task to the swarm. Returns a promise that resolves when a worker completes it.
     */
    public async publish(task: TaskPayload): Promise<TaskResult> {
        return new Promise((resolve) => {
            this.completionCallbacks.set(task.taskId, resolve);
            this.activeTasks.set(task.taskId, { startTime: Date.now(), task });
            
            // Distributed locking / Point-to-Point substitution
            // Instead of broadcasting to all workers, dispatch round-robin
            if (this.allTasksSubscribers.length > 0) {
                const handler = this.allTasksSubscribers[this.nextSubscriberIndex];
                this.nextSubscriberIndex = (this.nextSubscriberIndex + 1) % this.allTasksSubscribers.length;
                setTimeout(() => handler(task), 0);
            } else {
                this.taskQueue.push(task);
            }
        });
    }

    /**
     * Used by Workers to subscribe to their specific task feed.
     */
    public subscribe(agentId: string, handler: (task: TaskPayload) => void) {
        globalMessageBus.subscribe(`TASKS:${agentId}`, handler);
    }

    /**
     * Used by Workers to subscribe to any agent task in the system (Wildcard subscriber).
     */
    public subscribeToAllTasks(handler: (task: TaskPayload) => void) {
        this.allTasksSubscribers.push(handler);
        // Process any backlog
        while (this.taskQueue.length > 0) {
            const task = this.taskQueue.shift();
            if (task) {
                const consumer = this.allTasksSubscribers[this.nextSubscriberIndex];
                this.nextSubscriberIndex = (this.nextSubscriberIndex + 1) % this.allTasksSubscribers.length;
                setTimeout(() => consumer(task), 0);
            }
        }
    }

    /**
     * Used by Workers to broadcast their completion.
     */
    public async publishResult(result: TaskResult) {
        await globalMessageBus.publish('TASK_RESULTS', result);
    }
}

export const globalQueueBroker = new QueueBroker();
