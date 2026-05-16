import { FrameworkEvent } from './types.ts';

/**
 * EventStore manages the append-only event log for the entire system.
 * This is the foundation for Deterministic Replay and Time-Travel Debugging (Dimension 09).
 */
export class EventStore {
    private events: FrameworkEvent[] = [];
    private threadIndex: Map<string, FrameworkEvent[]> = new Map();

    private listeners: ((event: FrameworkEvent) => void)[] = [];

    public subscribe(listener: (event: FrameworkEvent) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    public append(event: Omit<FrameworkEvent, 'id' | 'timestamp'>): FrameworkEvent {
        const fullEvent: FrameworkEvent = {
            ...event,
            id: crypto.randomUUID(),
            timestamp: Date.now()
        };
        this.events.push(fullEvent);
        
        // Update thread index
        if (!this.threadIndex.has(fullEvent.threadId)) {
            this.threadIndex.set(fullEvent.threadId, []);
        }
        this.threadIndex.get(fullEvent.threadId)!.push(fullEvent);
        
        // Pruning for memory protection in long-running sessions
        if (this.events.length > 50000) {
            this.events = this.events.slice(-25000);
            this.rebuildIndexes();
        }

        // Dispatch to SSE listeners
        this.listeners.forEach(l => l(fullEvent));
        
        return fullEvent;
    }

    public clear() {
        this.events = [];
        this.threadIndex.clear();
    }

    public getEventsByThread(threadId: string): FrameworkEvent[] {
        return this.threadIndex.get(threadId) || [];
    }

    public getLogs(): FrameworkEvent[] {
        return this.events;
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
