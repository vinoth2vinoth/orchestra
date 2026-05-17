import Redis from 'ioredis';
import { IMessageBus } from './MessageBus.ts';

/**
 * Distributed MessageBus implementation using Redis Pub/Sub.
 */
export class RedisMessageBus implements IMessageBus {
    private pub: Redis;
    private sub: Redis;
    private handlers: Map<string, Array<(message: any) => void>> = new Map();

    constructor(url: string = process.env.REDIS_URL || 'redis://localhost:6379') {
        this.pub = new Redis(url);
        this.sub = new Redis(url);

        this.sub.on('message', (channel, message) => {
            const topicHandlers = this.handlers.get(channel) || [];
            try {
                const data = JSON.parse(message);
                topicHandlers.forEach(h => h(data));
            } catch {
                topicHandlers.forEach(h => h(message));
            }
        });
    }

    async publish(topic: string, message: any): Promise<void> {
        // Enforce traceId propagation for distributed debugging (M2 fix)
        const envelope = typeof message === 'object' ? {
            ...message,
            traceId: message.traceId || `trace_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`
        } : {
            payload: message,
            traceId: `trace_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`
        };
        await this.pub.publish(topic, JSON.stringify(envelope));
    }

    async subscribe(topic: string, handler: (message: any) => void): Promise<() => void> {
        if (!this.handlers.has(topic)) {
            this.handlers.set(topic, []);
            await this.sub.subscribe(topic);
        }
        this.handlers.get(topic)!.push(handler);
        
        return () => {
            const list = this.handlers.get(topic) || [];
            this.handlers.set(topic, list.filter(h => h !== handler));
            if (this.handlers.get(topic)?.length === 0) {
                this.sub.unsubscribe(topic);
            }
        };
    }
}
