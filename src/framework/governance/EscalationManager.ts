import { globalEventStore } from '../core/EventStore.ts';
import { WorkflowSuspendedError } from '../orchestration/WorkflowSuspendedError.ts';

type ApprovalResolution = 'APPROVED' | 'REJECTED' | 'MODIFIED';

interface PendingApproval {
    threadId: string;
    agentId: string;
    context: any;
    resolve?: (result: { resolution: ApprovalResolution; feedback?: string }) => void;
    reject?: (error: Error) => void;
}

export class EscalationManager {
    private pendingApprovals = new Map<string, PendingApproval>();

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

    public resolveApproval(approvalId: string, resolution: ApprovalResolution, feedback?: string) {
        const pending = this.pendingApprovals.get(approvalId);
        if (pending) {
            this.pendingApprovals.delete(approvalId);

            globalEventStore.append({
                type: 'MEMORY_STORED', 
                sourceAgentId: 'SYSTEM',
                threadId: 'SYSTEM',
                payload: { context: 'Human Intervention Resolved', approvalId, resolution, feedback }
            });
            // Real rehydration would trigger an event bus or wake up the orchestrator here
        }
    }
}

export const globalEscalationManager = new EscalationManager();
