import { WorkflowConfig } from './Orchestrator.ts';

/**
 * Interface for pluggable state storage (e.g. Redis, Firestore, S3).
 * This removes the "Monolithic God Object" memory dependency.
 */
export interface IStateProvider {
    save(id: string, state: any): Promise<void>;
    load(id: string): Promise<any | undefined>;
    delete(id: string): Promise<void>;
    list(): Promise<[string, any][]>;
}

export class MemoryStateProvider implements IStateProvider {
    private store = new Map<string, any>();
    async save(id: string, state: any) { this.store.set(id, state); }
    async load(id: string) { return this.store.get(id); }
    async delete(id: string) { this.store.delete(id); }
    async list() { return Array.from(this.store.entries()); }
}

export interface WorkflowState {
    threadId: string;
    approvalId: string;
    task: any;
    config: any;
    history: any[];
    agentDefinitions?: any[];
    resumeAgentId?: string;
    step?: number;
}

export class StateStore {
    private provider: IStateProvider;

    constructor(provider: IStateProvider = new MemoryStateProvider()) {
        this.provider = provider;
    }

    public async saveState(approvalId: string, state: WorkflowState) {
        await this.provider.save(approvalId, state);
    }

    public async getState(approvalId: string): Promise<WorkflowState | undefined> {
        return await this.provider.load(approvalId);
    }

    public async deleteState(approvalId: string) {
        await this.provider.delete(approvalId);
    }

    public async getAllStates() {
        return await this.provider.list();
    }
}

export const globalStateStore = new StateStore();
