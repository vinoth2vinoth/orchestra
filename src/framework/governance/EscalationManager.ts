import { globalEventStore } from '../core/EventStore.ts';
import { WorkflowSuspendedError } from '../orchestration/WorkflowSuspendedError.ts';
import { globalAuditLog } from './AuditLog.ts';

type ApprovalResolution = 'APPROVED' | 'REJECTED' | 'MODIFIED';

export enum EscalationTier {
    TIER_1_RETRY = 'RETRY',
    TIER_2_ADJUDICATION = 'ADJUDICATION',
    TIER_3_HUMAN_INTERVENTION = 'HUMAN_INTERVENTION',
    TIER_4_EMERGENCY_STOP = 'EMERGENCY_STOP'
}

interface PendingApproval {
    threadId: string;
    agentId: string;
    context: any;
    resolve?: (result: { resolution: ApprovalResolution; feedback?: string }) => void;
    reject?: (error: Error) => void;
}

export class EscalationManager {
    private pendingApprovals = new Map<string, PendingApproval>();
    private failureCounts: Map<string, number> = new Map();

    /**
     * Records a failure and determines the next escalation tier.
     */
    public async recordFailure(threadId: string, agentId: string, error: Error): Promise<EscalationTier> {
        const key = `${threadId}:${agentId}`;
        const count = (this.failureCounts.get(key) || 0) + 1;
        this.failureCounts.set(key, count);

        let tier = EscalationTier.TIER_1_RETRY;

        if (count >= 5) {
            tier = EscalationTier.TIER_4_EMERGENCY_STOP;
        } else if (count >= 3) {
            tier = EscalationTier.TIER_3_HUMAN_INTERVENTION;
        } else if (count >= 2) {
            tier = EscalationTier.TIER_2_ADJUDICATION;
        }

        await globalAuditLog.log(threadId, agentId, 'ESCALATION_TRIGGERED', `Tier: ${tier} triggered due to ${count} consecutive failures. Error: ${error.message}`);
        
        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'GOVERNANCE',
            threadId,
            payload: { 
                action: 'ESCALATION', 
                tier, 
                agentId, 
                count,
                error: error.message 
            }
        });

        return tier;
    }

    /**
     * Suspends execution and emits an event asking for human intervention.
     */
    public async requestApproval(
        threadId: string, 
        agentId: string, 
        actionDescription: string, 
        context: any
    ): Promise<{ resolution: ApprovalResolution; feedback?: string }> {
        const approvalId = crypto.randomUUID();

        await globalAuditLog.log(threadId, agentId, 'HUMAN_INTERVENTION_REQUESTED', actionDescription);

        globalEventStore.append({
            type: 'HUMAN_INTERVENTION_REQUIRED',
            sourceAgentId: agentId,
            threadId,
            payload: { actionDescription, context, approvalId }
        });

        this.pendingApprovals.set(approvalId, { threadId, agentId, context });

        // Throwing error to suspend execution durability
        throw new WorkflowSuspendedError(approvalId, context);
    }

    public getPendingApproval(approvalId: string): PendingApproval | undefined {
        return this.pendingApprovals.get(approvalId);
    }

    public async resolveApproval(approvalId: string, resolution: ApprovalResolution, feedback?: string) {
        const pending = this.pendingApprovals.get(approvalId);
        if (pending) {
            this.pendingApprovals.delete(approvalId);
            this.failureCounts.delete(`${pending.threadId}:${pending.agentId}`);

            await globalAuditLog.log(pending.threadId, pending.agentId, 'HUMAN_INTERVENTION_RESOLVED', `Resolution: ${resolution}. Feedback: ${feedback || 'None'}`);

            globalEventStore.append({
                type: 'MEMORY_STORED', 
                sourceAgentId: 'SYSTEM',
                threadId: pending.threadId,
                payload: { 
                    aspect: 'HUMAN_FEEDBACK', 
                    content: feedback || resolution,
                    approvalId, 
                    resolution 
                }
            });
        }
    }
}

export const globalEscalationManager = new EscalationManager();
