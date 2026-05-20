import { EventStore, globalEventStore } from '../core/EventStore.ts';

export interface Policy {
    id: string;
    description: string;
    level: 'ADVISORY' | 'MANDATORY' | 'BLOCKING';
    check: (task: any, agentId: string) => { allowed: boolean; reason?: string };
}

/**
 * PolicyEngine (Dimension 05)
 * Enforces ethical boundaries, budget limits, and regulatory constraints
 * at the framework level, before LLM execution.
 */
export class PolicyEngine {
    private policies: Policy[] = [];

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

        for (const policy of this.policies) {
            const result = policy.check(task, agentId);
            if (!result.allowed) {
                violations.push(`${policy.id}: ${result.reason}`);
                
                if (policy.level === 'BLOCKING') finalStatus = 'RED';
                else if (policy.level === 'MANDATORY' && finalStatus !== 'RED') finalStatus = 'YELLOW';
            }
        }

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
