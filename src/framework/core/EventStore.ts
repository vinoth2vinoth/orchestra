import { FrameworkEvent } from './types.ts';
import { globalMessageBus } from './MessageBus.ts';
import { globalStateAdapter } from './StateAdapter.ts';
import { Sanitizer } from '../security/Sanitizer.ts';

/**
 * EventStore manages the append-only event log for the entire system.
 * Now refactored to support distributed persistence via StateAdapter.
 */
export class EventStore {
    private events: FrameworkEvent[] = [];
    private eventIds: Set<string> = new Set();
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
        if (this.eventIds.has(event.id)) return;

        this.events.push(event);
        this.eventIds.add(event.id);
        
        // Update thread index
        if (!this.threadIndex.has(event.threadId)) {
            this.threadIndex.set(event.threadId, []);
        }
        const threadTail = this.threadIndex.get(event.threadId)!;
        threadTail.push(event);

        // --- PERFORMANCE: Per-thread Tail Limit (Dimension 04) ---
        // Keep only last 100 events per thread in memory for active context
        if (threadTail.length > 100) {
            this.threadIndex.set(event.threadId, threadTail.slice(-100));
        }
        
        // --- PERFORMANCE: Global Tail Limit (Dimension 04) ---
        // Keep only latest 1000 events in memory overall
        if (this.events.length > 1000) {
            this.events = this.events.slice(-500);
            this.rebuildIndexes();
        }

        // Dispatch to local UI/SSE listeners
        this.listeners.forEach(l => l(event));
    }

    public append(event: Omit<FrameworkEvent, 'id' | 'timestamp'>): FrameworkEvent {
        // --- SECURITY: Log Scrubbing (Dimension 10) ---
        const sanitizedPayload = this.recursiveScrub(event.payload || {});
        
        const fullEvent: FrameworkEvent = {
            ...event,
            payload: sanitizedPayload,
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
        this.eventIds.clear();
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

    private recursiveScrub(obj: any): any {
        if (!obj) return obj;
        if (typeof obj === 'string') return Sanitizer.scrubSecrets(obj);
        if (Array.isArray(obj)) return obj.map(item => this.recursiveScrub(item));
        if (typeof obj === 'object') {
            const scrubbed: any = {};
            for (const key in obj) {
                scrubbed[key] = this.recursiveScrub(obj[key]);
            }
            return scrubbed;
        }
        return obj;
    }

    private rebuildIndexes() {
        this.threadIndex.clear();
        this.eventIds.clear();
        for (const event of this.events) {
            this.eventIds.add(event.id);
            if (!this.threadIndex.has(event.threadId)) {
                this.threadIndex.set(event.threadId, []);
            }
            this.threadIndex.get(event.threadId)!.push(event);
        }
    }
}

export const globalEventStore = new EventStore();
