import Redis from 'ioredis';
import type { StateAdapter } from './StateAdapter.ts';

/**
 * Redis implementation of StateAdapter.
 * Used for horizontal scaling in multi-container environments.
 */
export class RedisStateAdapter implements StateAdapter {
    private client: Redis;

    constructor(url: string = process.env.REDIS_URL || 'redis://localhost:6379') {
        this.client = new Redis(url, {
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            maxRetriesPerRequest: 3
        });

        this.client.on('error', (err) => {
            console.error('Redis StateAdapter Error:', err.message);
        });
    }

    public async get<T>(key: string): Promise<T | null> {
        const data = await this.client.get(key);
        if (!data) return null;
        try {
            return JSON.parse(data) as T;
        } catch {
            return data as any as T;
        }
    }

    public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const payload = JSON.stringify(value);
        if (ttlSeconds) {
            await this.client.set(key, payload, 'EX', ttlSeconds);
        } else {
            await this.client.set(key, payload);
        }
    }

    public async delete(key: string): Promise<void> {
        await this.client.del(key);
    }

    public async mutate<T>(key: string, updater: (current: T | null) => T | Promise<T>, ttlSeconds?: number): Promise<T> {
        const lockKey = `mutate:${key}`;
        const lockTtlMs = 5000;
        const deadline = Date.now() + lockTtlMs;

        while (!(await this.acquireLock(lockKey, lockTtlMs))) {
            if (Date.now() > deadline) throw new Error(`Timed out acquiring mutation lock for ${key}`);
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        try {
            const current = await this.get<T>(key);
            const next = await updater(current);
            await this.set(key, next, ttlSeconds);
            return next;
        } finally {
            await this.releaseLock(lockKey);
        }
    }

    public async increment(key: string, delta: number = 1, ttlSeconds?: number): Promise<number> {
        if (delta === 1 && !ttlSeconds) {
            return await this.client.incr(key);
        }
        return this.mutate<number>(key, current => (current || 0) + delta, ttlSeconds);
    }

    public async compareAndSwap<T>(key: string, expected: T | null, next: T, ttlSeconds?: number): Promise<boolean> {
        const lockKey = `cas:${key}`;
        const lockTtlMs = 5000;
        const deadline = Date.now() + lockTtlMs;

        while (!(await this.acquireLock(lockKey, lockTtlMs))) {
            if (Date.now() > deadline) throw new Error(`Timed out acquiring compare-and-swap lock for ${key}`);
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        try {
            const current = await this.get<T>(key);
            if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
            await this.set(key, next, ttlSeconds);
            return true;
        } finally {
            await this.releaseLock(lockKey);
        }
    }

    public async pushToList(key: string, value: any): Promise<number> {
        return await this.client.rpush(key, JSON.stringify(value));
    }

    public async getRange(key: string, start: number, end: number): Promise<any[]> {
        const data = await this.client.lrange(key, start, end);
        return data.map(item => {
            try {
                return JSON.parse(item);
            } catch {
                return item;
            }
        });
    }

    public async acquireLock(key: string, ttlMs: number): Promise<boolean> {
        const result = await this.client.set(`lock:${key}`, 'LOCKED', 'PX', ttlMs, 'NX');
        return result === 'OK';
    }

    public async releaseLock(key: string): Promise<void> {
        await this.client.del(`lock:${key}`);
    }

    public disconnect(): void {
        this.client.disconnect();
    }
}
