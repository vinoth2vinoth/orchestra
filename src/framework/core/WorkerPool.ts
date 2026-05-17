import { globalEventStore } from './EventStore.ts';

/**
 * WorkerPool manages execution slots to prevent resource exhaustion (Dimension 04).
 * It uses a semaphore pattern to throttle concurrent LLM/Tool heavy operations.
 */
export class WorkerPool {
    private maxConcurrency: number;
    private activeCount: number = 0;
    private queue: (() => void)[] = [];

    constructor(maxConcurrency: number = 10) {
        this.maxConcurrency = maxConcurrency;
    }

    /**
     * Executes a task with a guaranteed slot in the pool.
     */
    public async run<T>(task: () => Promise<T>, agentId: string, threadId: string): Promise<T> {
        await this.acquireSlot();
        
        try {
            return await task();
        } finally {
            this.releaseSlot();
        }
    }

    private async acquireSlot(): Promise<void> {
        if (this.activeCount < this.maxConcurrency) {
            this.activeCount++;
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this.queue.push(resolve);
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
