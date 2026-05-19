import { globalEventStore } from '../core/EventStore.ts';

export class CircuitBreaker {
    private failures = 0;
    private maxFailures = 3;
    private retryDelayMs = 2000;
    private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    private nextAttemptTime = 0;
    
    // Predictive Metrics
    private latencyHistory: number[] = [];
    private readonly MAX_LATENCY_HISTORY = 10;
    private readonly PREDICTIVE_LATENCY_SPIKE_RATIO = 8.0; // Increased for realistic variability in LLM responses
    private readonly PREDICTIVE_ERROR_VELOCITY_WINDOW = 60000; // 1 minute
    private errorTimestampHistory: number[] = [];

    constructor(maxFailures = 3, retryDelayMs = 2000) {
        this.maxFailures = maxFailures;
        this.retryDelayMs = retryDelayMs;
    }

    public reset() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.latencyHistory = [];
        this.errorTimestampHistory = [];
        this.nextAttemptTime = 0;
        globalEventStore.append({ type: 'SYSTEM_HOOK', sourceAgentId: 'CIRCUIT_BREAKER', threadId: 'SYSTEM', payload: { action: 'MANUAL_RESET' } });
    }

    private checkPredictiveAnalytics(): boolean {
        const now = Date.now();
        
        // 1. Error Velocity Analytics
        this.errorTimestampHistory = this.errorTimestampHistory.filter(ts => now - ts < this.PREDICTIVE_ERROR_VELOCITY_WINDOW);
        if (this.errorTimestampHistory.length >= 5) {
            // 5 errors in 1 minute is a predictive cluster
            globalEventStore.append({ type: 'SYSTEM_HOOK', sourceAgentId: 'CIRCUIT_BREAKER', threadId: 'SYSTEM', payload: { action: 'PREDICTIVE_TRIP', reason: 'High error velocity detected' } });
            return true;
        }

        // 2. Latency Anomaly Detection
        if (this.latencyHistory.length >= 5) {
            const avgLatency = this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
            const lastLatency = this.latencyHistory[this.latencyHistory.length - 1];
            
            if (lastLatency > avgLatency * this.PREDICTIVE_LATENCY_SPIKE_RATIO) {
                globalEventStore.append({ type: 'SYSTEM_HOOK', sourceAgentId: 'CIRCUIT_BREAKER', threadId: 'SYSTEM', payload: { action: 'PREDICTIVE_TRIP', reason: `Latency anomaly: ${Math.round(lastLatency)}ms vs avg ${Math.round(avgLatency)}ms` } });
                return true;
            }
        }

        return false;
    }

    public async execute<T>(action: () => Promise<T>, fallback?: () => Promise<T>, timeoutMs?: number): Promise<T> {
        if (this.state === 'OPEN') {
            if (Date.now() > this.nextAttemptTime) {
                this.state = 'HALF_OPEN';
            } else {
                if (fallback) {
                    globalEventStore.append({ type: 'ERROR_THROWN', sourceAgentId: 'CIRCUIT_BREAKER', threadId: 'SYSTEM', payload: { message: 'Circuit open, executing fallback' } });
                    return fallback();
                }
                throw new Error("Circuit is OPEN. Action blocked.");
            }
        }

        // Run Predictive Check
        if (this.state === 'CLOSED' && this.checkPredictiveAnalytics()) {
            this.state = 'OPEN';
            this.nextAttemptTime = Date.now() + this.retryDelayMs;
            if (fallback) return fallback();
            throw new Error("Predictive Circuit Trip: Anomalous behavior detected prior to failure.");
        }

        const start = Date.now();
        try {
            const executeOriginal = () => {
                if (!timeoutMs) return action();
                return new Promise<T>((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error("Execution Timed Out")), timeoutMs);
                    action().then(res => {
                        clearTimeout(timer);
                        resolve(res);
                    }).catch(err => {
                        clearTimeout(timer);
                        reject(err);
                    });
                });
            };

            const result = await executeOriginal();
            
            // Record success metrics
            const latency = Date.now() - start;
            this.latencyHistory.push(latency);
            if (this.latencyHistory.length > this.MAX_LATENCY_HISTORY) this.latencyHistory.shift();

            // Success Transition
            if (this.state === 'HALF_OPEN') {
                this.state = 'CLOSED';
                this.failures = 0;
            }
            return result;
        } catch (error: any) {
            console.error("CircuitBreaker execution failed:", error.message || error);
            this.failures++;
            this.errorTimestampHistory.push(Date.now());
            
            globalEventStore.append({ type: 'ERROR_THROWN', sourceAgentId: 'CIRCUIT_BREAKER', threadId: 'SYSTEM', payload: { message: `Failure ${this.failures}/${this.maxFailures}` } });
            
            if (this.failures >= this.maxFailures) {
                this.state = 'OPEN';
                this.nextAttemptTime = Date.now() + this.retryDelayMs * (this.failures); // Exponential backoff scaling
                globalEventStore.append({ type: 'ERROR_THROWN', sourceAgentId: 'CIRCUIT_BREAKER', threadId: 'SYSTEM', payload: { message: 'Circuit tripped to OPEN' } });
                
                if (fallback) {
                    return fallback();
                }
            }
            throw error;
        }
    }
}

export const globalCircuitBreaker = new CircuitBreaker();

export class CircuitBreakerRegistry {
    private breakers = new Map<string, CircuitBreaker>();

    public get(key: string) {
        const normalizedKey = key || 'default';
        let breaker = this.breakers.get(normalizedKey);
        if (!breaker) {
            breaker = new CircuitBreaker();
            this.breakers.set(normalizedKey, breaker);
        }
        return breaker;
    }

    public async execute<T>(key: string, action: () => Promise<T>, fallback?: () => Promise<T>, timeoutMs?: number): Promise<T> {
        return this.get(key).execute(action, fallback, timeoutMs);
    }

    public reset(key?: string) {
        if (key) {
            this.breakers.get(key)?.reset();
            return;
        }
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
    }
}

export const globalCircuitBreakers = new CircuitBreakerRegistry();
