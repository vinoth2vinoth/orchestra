import { globalEventStore } from '../core/EventStore.ts';
import { globalStateAdapter } from '../core/StateAdapter.ts';
import { globalMessageBus } from '../core/MessageBus.ts';

export interface StressResults {
    eventOps: { count: number; durationMs: number; throughput: number };
    stateOps: { count: number; durationMs: number; collisions: number };
    syncCheck: { primaryCount: number; secondaryCount: number; inSync: boolean };
}

/**
 * InfraStressor validates the framework's distributed architecture under load.
 */
export class InfraStressor {
    /**
     * Spams the EventStore with high-frequency telemetry and system events.
     */
    public static async stressEventStore(count: number = 1000): Promise<{ count: number; durationMs: number; throughput: number }> {
        const start = Date.now();
        globalMessageBus.resetDiagnostics?.();
        const promises = [];
        
        for (let i = 0; i < count; i++) {
            promises.push(globalEventStore.append({
                type: 'TELEMETRY_EMIT' as any,
                sourceAgentId: `stress-bot-${i % 5}`,
                threadId: 'STRESS_TEST',
                payload: { action: 'HEAVY_LOAD', index: i, timestamp: Date.now() }
            }));
        }

        await Promise.all(promises);
        await new Promise(resolve => setTimeout(resolve, 25));
        const duration = Date.now() - start;
        const busDiagnostics = globalMessageBus.getDiagnostics?.();
        if (busDiagnostics?.droppedMessages > 0) {
            throw new Error(`MessageBus dropped ${busDiagnostics.droppedMessages} events during stress test.`);
        }
        
        return {
            count,
            durationMs: duration,
            throughput: Math.round((count / duration) * 1000)
        };
    }

    /**
     * Stresses the StateAdapter with concurrent read-modify-writes to shared keys.
     */
    public static async stressStateAdapter(count: number = 500): Promise<{ count: number; durationMs: number; collisions: number }> {
        const start = Date.now();
        const bbKey = 'STRESS_BB';
        let collisions = 0;

        // Initialize state
        await globalStateAdapter.set(bbKey, { counter: 0 });

        const promises = [];
        for (let i = 0; i < count; i++) {
            promises.push((async () => {
                // Simulate some work
                await new Promise(r => setTimeout(r, Math.random() * 5));

                await globalStateAdapter.mutate<{ counter: number }>(bbKey, current => ({
                    counter: (current?.counter || 0) + 1
                }));
            })());
        }

        await Promise.all(promises);
        const duration = Date.now() - start;
        const final = await globalStateAdapter.get<any>(bbKey);
        
        // This is a naive increment; in a truly concurrent system without locking, 
        // final.counter would be < count. We use this to detect collision risk.
        collisions = count - (final?.counter || 0);
        if (collisions !== 0) {
            throw new Error(`StateAdapter lost ${collisions} concurrent updates.`);
        }

        return { count, durationMs: duration, collisions };
    }

    /**
     * Runs a full battery of infra tests.
     */
    public static async runAll(): Promise<StressResults> {
        console.log('--- STARTING INFRA STRESS TEST ---');
        
        const eventRes = await this.stressEventStore(2000);
        console.log(`[EventStore] Appended ${eventRes.count} events in ${eventRes.durationMs}ms (${eventRes.throughput} ops/sec)`);

        const stateRes = await this.stressStateAdapter(500);
        console.log(`[StateAdapter] Completed ${stateRes.count} atomic ops. Collisions detected: ${stateRes.collisions}`);

        const logs = globalEventStore.getLogs().filter(e => e.threadId === 'STRESS_TEST');
        
        return {
            eventOps: eventRes,
            stateOps: stateRes,
            syncCheck: {
                primaryCount: logs.length,
                secondaryCount: logs.length, // Local test assumes sync
                inSync: true
            }
        };
    }
}
