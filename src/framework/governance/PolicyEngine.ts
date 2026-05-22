import { EventStore, globalEventStore } from '../core/EventStore.ts';

export interface Policy {
    id: string;
    description: string;
    level: 'ADVISORY' | 'MANDATORY' | 'BLOCKING';
    check: (task: any, agentId: string, threadId?: string) => { allowed: boolean; reason?: string };
}

/**
 * PolicyEngine (Dimension 05)
 * Enforces ethical boundaries, budget limits, and regulatory constraints
 * at the framework level, before LLM execution.
 */
export class PolicyEngine {
    private policies: Policy[] = [];
    private recentTaskFingerprints: Map<string, string[]> = new Map();
    private readonly MAX_FINGERPRINT_KEYS = 10000;
    private readonly FINGERPRINT_EVICTION_BATCH = 1000;

    constructor(private eventStore: EventStore = globalEventStore) {
        this.loadDefaultPolicies();
    }

    public registerPolicy(policy: Policy) {
        this.policies.push(policy);
    }

    /**
     * Evaluates a task against all registered policies.
     * Throws if a BLOCKING policy is violated.
     */
    public evaluate(task: any, agentId: string, threadId: string): { status: 'GREEN' | 'YELLOW' | 'RED'; violations: string[] } {
        const violations: string[] = [];
        let finalStatus: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
        const fingerprint = this.fingerprintTask(task);
        const loopKey = `${threadId}:${agentId}`;
        const recent = this.recentTaskFingerprints.get(loopKey) || [];

        if (recent.filter(item => item === fingerprint).length >= 2) {
            violations.push('ANTI_LOOPS: Identical task repeated 3+ times in recent thread history');
            finalStatus = 'RED';
        }

        for (const policy of this.policies) {
            const result = policy.check(task, agentId, threadId);
            if (!result.allowed) {
                violations.push(`${policy.id}: ${result.reason}`);
                
                if (policy.level === 'BLOCKING') finalStatus = 'RED';
                else if (policy.level === 'MANDATORY' && finalStatus !== 'RED') finalStatus = 'YELLOW';
            }
        }

        this.recentTaskFingerprints.set(loopKey, [...recent.slice(-9), fingerprint]);
        this.evictFingerprintKeysIfNeeded();

        if (violations.length > 0) {
            this.eventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'GOVERNANCE',
                threadId,
                payload: { action: 'POLICY_EVALUATION', status: finalStatus, violations }
            });
        }

        return { status: finalStatus, violations };
    }

    private fingerprintTask(task: any): string {
        const taskStr = typeof task === 'string'
            ? task
            : JSON.stringify(this.stripBlackboardFromTask(task));
        return taskStr
            .replace(/<GLOBAL_BLACKBOARD_UNTRUSTED_CONTENT>[\s\S]*?<\/GLOBAL_BLACKBOARD_UNTRUSTED_CONTENT>/gi, '')
            .replace(/\[GLOBAL BLACKBOARD CONTEXT[^\]]*\][\s\S]*?(?=\n\n|\r\n\r\n|$)/gi, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    private stripBlackboardFromTask(task: any): any {
        if (!task || typeof task !== 'object') return task;
        if (Array.isArray(task)) return task.map(item => this.stripBlackboardFromTask(item));

        const stripped: Record<string, any> = {};
        for (const [key, value] of Object.entries(task)) {
            if (key === 'blackboard') continue;
            stripped[key] = this.stripBlackboardFromTask(value);
        }
        return stripped;
    }

    private evictFingerprintKeysIfNeeded() {
        if (this.recentTaskFingerprints.size <= this.MAX_FINGERPRINT_KEYS) return;

        let deleted = 0;
        for (const key of this.recentTaskFingerprints.keys()) {
            this.recentTaskFingerprints.delete(key);
            deleted++;
            if (deleted >= this.FINGERPRINT_EVICTION_BATCH) break;
        }
    }

    private loadDefaultPolicies() {
        // 1. Anti-Recursive Loop Policy
        this.registerPolicy({
            id: 'ANTI_LOOPS',
            description: 'Prevents obvious infinite re-delegation loops.',
            level: 'BLOCKING',
            check: (task) => {
                const taskStr = JSON.stringify(task);
                if (taskStr.length > 200000) return { allowed: false, reason: 'Task payload size exceeds safety threshold' };
                return { allowed: true };
            }
        });

        // 2. Secret Leakage Policy (pre-LLM)
        this.registerPolicy({
            id: 'DATA_EXFILTRATION',
            description: 'Detects clear attempts to leak system configuration to agents.',
            level: 'MANDATORY',
            check: (task) => {
                const forbidden = ['ORCHESTRA_ENCRYPTION_KEY', 'process.env', '.env'];
                const taskStr = JSON.stringify(task);
                for (const term of forbidden) {
                    if (taskStr.includes(term)) return { allowed: false, reason: `Task contains sensitive reference: ${term}` };
                }
                return { allowed: true };
            }
        });
    }
}

export const globalPolicyEngine = new PolicyEngine();
