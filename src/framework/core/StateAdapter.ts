import { KeyValueStateAdapter, getKeyValueStateUrl } from './KeyValueStateAdapter.ts';

/**
 * StateAdapter provides an interface for distributed state management.
 * This allows the framework to scale horizontally by offloading local memory
 * to shared providers such as Valkey or another Redis-compatible key-value backend.
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
    private locks = new Map<string, number>();
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
        // Redis-compatible lrange end is inclusive, so match that behavior.
        const actualEnd = end === -1 ? list.length : end + 1;
        return list.slice(start, actualEnd);
    }

    public async acquireLock(key: string, ttlMs: number): Promise<boolean> {
        const now = Date.now();
        const expiresAt = this.locks.get(key);
        if (expiresAt && expiresAt > now) return false;
        this.locks.set(key, now + Math.max(1, ttlMs));
        return true;
    }

    public async releaseLock(key: string): Promise<void> {
        this.locks.delete(key);
    }
}

export function createStateAdapter(): StateAdapter {
    const requested = (process.env.ORCHESTRA_STATE_ADAPTER || '').toLowerCase();
    const keyValueAliases = ['keyvalue', 'key-value', 'valkey', 'redis-compatible', 'redis'];
    const stateUrl = getKeyValueStateUrl();

    if (keyValueAliases.includes(requested) || (!requested && stateUrl && process.env.NODE_ENV === 'production')) {
        if (!stateUrl) {
            throw new Error('ORCHESTRA_STATE_ADAPTER=keyvalue requires ORCHESTRA_STATE_URL, VALKEY_URL, or legacy REDIS_URL.');
        }
        return new KeyValueStateAdapter(stateUrl);
    }

    if (process.env.NODE_ENV === 'production' && requested !== 'memory') {
        console.warn('[StateAdapter] Production is using in-memory state. Set ORCHESTRA_STATE_ADAPTER=keyvalue and ORCHESTRA_STATE_URL for durable distributed execution.');
    }

    return new MemoryStateAdapter();
}

// Global default adapter
export const globalStateAdapter: StateAdapter = createStateAdapter();
