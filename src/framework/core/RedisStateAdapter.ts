import Redis from 'ioredis';
import { StateAdapter } from './StateAdapter.ts';

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
}
