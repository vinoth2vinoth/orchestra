import { EventStore, globalEventStore } from './EventStore.ts';

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * WorkerPool manages execution slots to prevent resource exhaustion (Dimension 04).
 * It uses a semaphore pattern to throttle concurrent LLM/Tool heavy operations.
 */
export class WorkerPool {
    private maxConcurrency: number;
    private activeCount: number = 0;
    private queue: Array<() => void> = [];
    private slotTimeoutMs: number;

    constructor(
        maxConcurrency: number = 10,
        slotTimeoutMs: number = parsePositiveInt(process.env.ORCHESTRA_WORKER_SLOT_TIMEOUT_MS, 120000),
        private eventStore: EventStore = globalEventStore
    ) {
        this.maxConcurrency = maxConcurrency;
        this.slotTimeoutMs = slotTimeoutMs;
    }

    /**
     * Executes a task with a guaranteed slot in the pool.
     */
    public async run<T>(task: () => Promise<T>, agentId: string, threadId: string): Promise<T> {
        await this.acquireSlot(this.slotTimeoutMs, agentId, threadId);
        
        try {
            return await task();
        } finally {
            this.releaseSlot();
        }
    }

    private async acquireSlot(timeoutMs: number, agentId: string, threadId: string): Promise<void> {
        if (this.activeCount < this.maxConcurrency) {
            this.activeCount++;
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            let releaseQueuedSlot!: () => void;
            const timer = setTimeout(() => {
                const idx = this.queue.indexOf(releaseQueuedSlot);
                if (idx !== -1) this.queue.splice(idx, 1);
                this.eventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'WORKER_POOL',
                    threadId,
                    payload: { action: 'SLOT_TIMEOUT', agentId, timeoutMs }
                });
                reject(new Error(`WorkerPool slot timed out after ${timeoutMs}ms for agent ${agentId}`));
            }, timeoutMs);

            releaseQueuedSlot = () => {
                clearTimeout(timer);
                resolve();
            };

            this.queue.push(releaseQueuedSlot);
        });
    }

    private releaseSlot(): void {
        this.activeCount--;
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                this.activeCount++;
                next();
            }
        }
    }

    public getStatus() {
        return {
            active: this.activeCount,
            queued: this.queue.length,
            limit: this.maxConcurrency
        };
    }
}

export const globalWorkerPool = new WorkerPool(process.env.MAX_CONCURRENCY ? parseInt(process.env.MAX_CONCURRENCY) : 8);
