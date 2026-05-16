import { WorkflowConfig } from './Orchestrator.ts';

export interface WorkflowState {
    threadId: string;
    approvalId: string;
    task: any;
    config: any; // We just store serializable parts or references
    history: any[];
    agentDefinitions?: any[]; // Save simple config objects to rehydrate agents
    resumeAgentId?: string;
    step?: number;
}

export class StateStore {
    private store = new Map<string, WorkflowState>();

    public saveState(approvalId: string, state: WorkflowState) {
        this.store.set(approvalId, state);
    }

    public getState(approvalId: string): WorkflowState | undefined {
        return this.store.get(approvalId);
    }

    public deleteState(approvalId: string) {
        this.store.delete(approvalId);
    }

    public getAllStates() {
        return Array.from(this.store.entries());
    }
}

export const globalStateStore = new StateStore();
