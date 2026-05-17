/**
 * StateAdapter provides an interface for distributed state management.
 * This allows the framework to scale horizontally by offloading local memory
 * to shared providers like Redis.
 */
export interface StateAdapter {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    
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

    public async get<T>(key: string): Promise<T | null> {
        return this.storage.get(key) ?? null;
    }

    public async set<T>(key: string, value: T, _ttl?: number): Promise<void> {
        this.storage.set(key, value);
    }

    public async delete(key: string): Promise<void> {
        this.storage.delete(key);
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

// Global default adapter
export const globalStateAdapter: StateAdapter = new MemoryStateAdapter();
