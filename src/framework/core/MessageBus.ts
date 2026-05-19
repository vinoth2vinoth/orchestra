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
    private readonly RATE_LIMIT = 1000; // Max events per second
    private readonly WINDOW_MS = 1000;
    private droppedMessages = 0;
    private throttledMessages = 0;

    async publish(topic: string, message: any): Promise<void> {
        let now = Date.now();
        if (now - this.lastReset > this.WINDOW_MS) {
            this.eventCount = 0;
            this.lastReset = now;
        }

        if (this.eventCount > this.RATE_LIMIT) {
            this.throttledMessages++;
            const waitMs = Math.max(1, this.WINDOW_MS - (now - this.lastReset));
            await new Promise(resolve => setTimeout(resolve, waitMs));
            this.eventCount = 0;
            this.lastReset = Date.now();
        }

        this.eventCount++;
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

    public getDiagnostics() {
        return {
            droppedMessages: this.droppedMessages,
            throttledMessages: this.throttledMessages,
            eventCount: this.eventCount
        };
    }

    public resetDiagnostics() {
        this.droppedMessages = 0;
        this.throttledMessages = 0;
    }
}

export const globalMessageBus = new LocalMessageBus();
