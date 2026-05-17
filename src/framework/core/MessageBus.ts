import { FrameworkEvent } from './types.ts';

export interface IMessageBus {
    publish(topic: string, message: any): Promise<void>;
    subscribe(topic: string, handler: (message: any) => void): Promise<() => void>;
}

/**
 * Local implementation of the MessageBus for in-process communication.
 */
export class LocalMessageBus implements IMessageBus {
    private handlers: Map<string, Array<(message: any) => void>> = new Map();
    private eventCount = 0;
    private lastReset = Date.now();
    private isTripped = false;
    private readonly RATE_LIMIT = 1000; // Max events per second
    private readonly WINDOW_MS = 1000;

    async publish(topic: string, message: any): Promise<void> {
        if (this.isTripped) {
            console.error(`[MessageBus] CIRCUIT BREAKER ACTIVE. Dropping message on topic: ${topic}`);
            return;
        }

        const now = Date.now();
        if (now - this.lastReset > this.WINDOW_MS) {
            this.eventCount = 0;
            this.lastReset = now;
        }

        this.eventCount++;

        if (this.eventCount > this.RATE_LIMIT) {
            this.isTripped = true;
            console.error(`[MessageBus] EVENT STORM DETECTED! Rate limit ${this.RATE_LIMIT} exceeded. Circuit breaker tripped.`);
            
            // Auto-reset after 10 seconds
            setTimeout(() => {
                this.isTripped = false;
                this.eventCount = 0;
                this.lastReset = Date.now();
                console.log(`[MessageBus] Circuit breaker reset.`);
            }, 10000);

            return;
        }

        const topicHandlers = this.handlers.get(topic) || [];
        // Use setImmediate/setTimeout to simulate async distributed nature
        topicHandlers.forEach(h => setTimeout(() => h(message), 0));
    }

    async subscribe(topic: string, handler: (message: any) => void): Promise<() => void> {
        if (!this.handlers.has(topic)) {
            this.handlers.set(topic, []);
        }
        this.handlers.get(topic)!.push(handler);
        return () => {
            const list = this.handlers.get(topic) || [];
            this.handlers.set(topic, list.filter(h => h !== handler));
        };
    }
}

export const globalMessageBus: IMessageBus = new LocalMessageBus();
