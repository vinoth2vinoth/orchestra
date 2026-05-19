import { RedisStateAdapter } from './RedisStateAdapter.ts';

/**
 * StateAdapter provides an interface for distributed state management.
 * This allows the framework to scale horizontally by offloading local memory
 * to shared providers like Redis.
 */
export interface StateAdapter {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    mutate<T>(key: string, updater: (current: T | null) => T | Promise<T>, ttlSeconds?: number): Promise<T>;
    increment(key: string, delta?: number, ttlSeconds?: number): Promise<number>;
    compareAndSwap<T>(key: string, expected: T | null, next: T, ttlSeconds?: number): Promise<boolean>;
    
    // List operations for Event Stores and Message Histories
    pushToList(key: string, value: any): Promise<number>;
    getRange(key: string, start: number, end: number): Promise<any[]>;
    
    // Distributed locking for multi-instance operations
    acquireLock(key: string, ttlMs: number): Promise<boolean>;
    releaseLock(key: string): Promise<void>;
}

/**
 * Default implementation using local memory.
 * Suitable for development or single-instance deployments.
 */
export class MemoryStateAdapter implements StateAdapter {
    private storage = new Map<string, any>();
    private lists = new Map<string, any[]>();
    private locks = new Set<string>();
    private mutationQueues = new Map<string, Promise<any>>();

    public async get<T>(key: string): Promise<T | null> {
        return this.storage.get(key) ?? null;
    }

    public async set<T>(key: string, value: T, _ttl?: number): Promise<void> {
        this.storage.set(key, value);
    }

    public async delete(key: string): Promise<void> {
        this.storage.delete(key);
    }

    private async runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.mutationQueues.get(key) || Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        this.mutationQueues.set(key, previous.then(() => current, () => current));

        await previous.catch(() => undefined);
        try {
            return await operation();
        } finally {
            release();
            if (this.mutationQueues.get(key) === current) {
                this.mutationQueues.delete(key);
            }
        }
    }

    public async mutate<T>(key: string, updater: (current: T | null) => T | Promise<T>, ttlSeconds?: number): Promise<T> {
        return this.runExclusive(key, async () => {
            const current = await this.get<T>(key);
            const next = await updater(current);
            await this.set(key, next, ttlSeconds);
            return next;
        });
    }

    public async increment(key: string, delta: number = 1, ttlSeconds?: number): Promise<number> {
        return this.mutate<number>(key, current => (current || 0) + delta, ttlSeconds);
    }

    public async compareAndSwap<T>(key: string, expected: T | null, next: T, ttlSeconds?: number): Promise<boolean> {
        return this.runExclusive(key, async () => {
            const current = await this.get<T>(key);
            if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
            await this.set(key, next, ttlSeconds);
            return true;
        });
    }

    public async pushToList(key: string, value: any): Promise<number> {
        if (!this.lists.has(key)) this.lists.set(key, []);
        const list = this.lists.get(key)!;
        list.push(value);
        return list.length;
    }

    public async getRange(key: string, start: number, end: number): Promise<any[]> {
        const list = this.lists.get(key) || [];
        // Redis lrange end is inclusive, let's match that behavior
        const actualEnd = end === -1 ? list.length : end + 1;
        return list.slice(start, actualEnd);
    }

    public async acquireLock(key: string, _ttlMs: number): Promise<boolean> {
        if (this.locks.has(key)) return false;
        this.locks.add(key);
        return true;
    }

    public async releaseLock(key: string): Promise<void> {
        this.locks.delete(key);
    }
}

export function createStateAdapter(): StateAdapter {
    const requested = (process.env.ORCHESTRA_STATE_ADAPTER || '').toLowerCase();
    if (requested === 'redis' || (!requested && process.env.REDIS_URL && process.env.NODE_ENV === 'production')) {
        if (!process.env.REDIS_URL) {
            throw new Error('ORCHESTRA_STATE_ADAPTER=redis requires REDIS_URL.');
        }
        return new RedisStateAdapter(process.env.REDIS_URL);
    }

    if (process.env.NODE_ENV === 'production' && requested !== 'memory') {
        console.warn('[StateAdapter] Production is using in-memory state. Set ORCHESTRA_STATE_ADAPTER=redis and REDIS_URL for durable distributed execution.');
    }

    return new MemoryStateAdapter();
}

// Global default adapter
export const globalStateAdapter: StateAdapter = createStateAdapter();
