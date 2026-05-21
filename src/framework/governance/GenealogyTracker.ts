import { globalEventStore } from '../core/EventStore.ts';
import type { EventStore } from '../core/EventStore.ts';
import { createHash } from 'crypto';

export interface ProvenanceNode {
    id: string;
    agentId: string;
    sourceInput: string;
    outputHash: string;
    timestamp: number;
    parentIds: string[];
}

/**
 * GenealogyTracker (Dimension 04 & 09)
 * Maps the causal chain of outputs to inputs. If an agent hallucinates,
 * we can trace the hallucination cascade through child agents and isolate it.
 */
export class GenealogyTracker {
    private graph: Map<string, ProvenanceNode> = new Map();

    constructor(private eventStore: EventStore = globalEventStore) {}

    public recordLineage(agentId: string, input: string, output: string, parentIds: string[] = []): string {
        const id = crypto.randomUUID();
        const outputHash = this.hashString(output);
        
        const node: ProvenanceNode = {
            id,
            agentId,
            sourceInput: input,
            outputHash,
            timestamp: Date.now(),
            parentIds
        };
        
        this.graph.set(id, node);

        this.eventStore.append({
            type: 'MEMORY_STORED', // Loosely using this as a lineage event
            sourceAgentId: agentId,
            threadId: 'SYSTEM',
            payload: { context: 'Genealogy Tracking', nodeId: id, parentIds }
        });

        return id;
    }

    public traceBlastRadius(nodeId: string, visited: Set<string> = new Set()): string[] {
        if (visited.has(nodeId)) return [];
        visited.add(nodeId);

        const cascade: string[] = [];
        this.graph.forEach((node, id) => {
            if (node.parentIds.includes(nodeId)) {
                cascade.push(id);
                // Recursively trace
                cascade.push(...this.traceBlastRadius(id, visited));
            }
        });
        return Array.from(new Set(cascade));
    }

    private hashString(str: string): string {
        return createHash('sha256').update(str).digest('hex').slice(0, 16);
    }
}

export const globalGenealogy = new GenealogyTracker();
