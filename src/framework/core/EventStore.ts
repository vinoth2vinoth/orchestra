import { FrameworkEvent } from './types.ts';
import { globalMessageBus } from './MessageBus.ts';
import { globalStateAdapter } from './StateAdapter.ts';

/**
 * EventStore manages the append-only event log for the entire system.
 * Now refactored to support distributed persistence via StateAdapter.
 */
export class EventStore {
    private events: FrameworkEvent[] = [];
    private threadIndex: Map<string, FrameworkEvent[]> = new Map();
    private listeners: ((event: FrameworkEvent) => void)[] = [];

    constructor() {
        // Subscribe to global event stream to keep local cache in sync across nodes
        globalMessageBus.subscribe('FRAMEWORK_EVENTS', (event: FrameworkEvent) => {
            this.internalAppend(event);
        });
        
        // Seed history from shared state
        this.loadHistory();
    }

    private async loadHistory() {
        try {
            const history = await globalStateAdapter.getRange('framework_events', 0, -1);
            history.forEach(event => this.internalAppend(event));
        } catch (err) {
            console.error('Failed to load event history from StateAdapter:', err);
        }
    }

    public subscribe(listener: (event: FrameworkEvent) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private internalAppend(event: FrameworkEvent) {
        // Prevent duplicate local appending
        if (this.events.some(e => e.id === event.id)) return;

        this.events.push(event);
        
        // Update thread index
        if (!this.threadIndex.has(event.threadId)) {
            this.threadIndex.set(event.threadId, []);
        }
        this.threadIndex.get(event.threadId)!.push(event);
        
        // Pruning (Keep memory usage bounded)
        if (this.events.length > 50000) {
            this.events = this.events.slice(-25000);
            this.rebuildIndexes();
        }

        // Dispatch to local UI/SSE listeners
        this.listeners.forEach(l => l(event));
    }

    public append(event: Omit<FrameworkEvent, 'id' | 'timestamp'>): FrameworkEvent {
        const fullEvent: FrameworkEvent = {
            ...event,
            id: crypto.randomUUID(),
            timestamp: Date.now()
        };
        
        // 1. Persist to shared state
        globalStateAdapter.pushToList('framework_events', fullEvent);

        // 2. Publish to distributed bus - this will trigger internalAppend globally
        globalMessageBus.publish('FRAMEWORK_EVENTS', fullEvent);
        
        return fullEvent;
    }

    public clear() {
        this.events = [];
        this.threadIndex.clear();
    }

    public getEventsByThread(threadId: string): FrameworkEvent[] {
        return [...(this.threadIndex.get(threadId) || [])].map(e => Object.freeze({ ...e }));
    }

    public getLogs(): FrameworkEvent[] {
        return [...this.events].map(e => Object.freeze({ ...e }));
    }

    public getSnapshotAtTimestamp(threadId: string, timestamp: number): FrameworkEvent[] {
        const threadEvents = this.threadIndex.get(threadId) || [];
        return threadEvents.filter(e => e.timestamp <= timestamp);
    }

    private rebuildIndexes() {
        this.threadIndex.clear();
        for (const event of this.events) {
            if (!this.threadIndex.has(event.threadId)) {
                this.threadIndex.set(event.threadId, []);
            }
            this.threadIndex.get(event.threadId)!.push(event);
        }
    }
}

export const globalEventStore = new EventStore();
