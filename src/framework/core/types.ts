export type EventType = 
    | 'AGENT_SPAWNED'
    | 'AGENT_TERMINATED'
    | 'TASK_DELEGATED'
    | 'TOOL_CALL_REQUESTED'
    | 'TOOL_CALL_COMPLETED'
    | 'LLM_GENERATION_STARTED'
    | 'LLM_GENERATION_COMPLETED'
    | 'MEMORY_STORED'
    | 'MEMORY_RETRIEVED'
    | 'ERROR_THROWN'
    | 'CONSENSUS_VOTE'
    | 'WORKFLOW_COMPLETED'
    | 'SYSTEM_HOOK'
    | 'HUMAN_INTERVENTION_REQUIRED';

export interface FrameworkEvent {
    id: string;
    timestamp: number;
    type: EventType;
    sourceAgentId: string;
    targetAgentId?: string;
    threadId: string;
    payload: any;
    tenantId?: string;
}

export type MemoryTier = 'CORE' | 'WORKING' | 'EPISODIC' | 'SEMANTIC' | 'PROCEDURAL';

export interface CoreMemoryState {
    persona: string;
    human: string;
}

export interface MemoryEntry {
    id: string;
    tier: MemoryTier;
    content: any;
    timestamp: number;
    metadata: Record<string, any>;
    tenantId?: string;
}

export interface AgentCard {
    id: string;
    name: string;
    description: string;
    capabilities: string[];
    role: 'MANAGER' | 'WORKER' | 'CRITIC' | 'ORCHESTRATOR' | 'PLANNER' | 'JUDGE';
    priority?: number;
    urgency?: number;
    lineage: {
        parentId?: string;
        spawnedAt: number;
    };
}
