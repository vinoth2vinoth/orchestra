import { MemoryEntry, MemoryTier, CoreMemoryState } from '../core/types.ts';
import { globalEventStore } from '../core/EventStore.ts';
import natural from 'natural';

const TfIdf = natural.TfIdf;

interface VectorMemoryEntry extends MemoryEntry {
    // Keep the type for backward compatibility, but we won't use it
    embedding?: number[]; 
    accessCount?: number;
    lastAccessed?: number;
}

/**
 * MemoryMesh implements the 4-tier CoALA-inspired memory architecture (Dimension 07).
 * Now augmented with REAL Vector Search capabilities using TF-IDF (Free & local).
 */
export class MemoryMesh {
    private memories: VectorMemoryEntry[] = [];
    private tfidf = new TfIdf();
    
    // GraphRAG Structures
    private graphEdges: Array<{ source: string, target: string, relation: string, weight: number, tenantId?: string }> = [];
    private graphNodes: Map<string, { label: string, properties: Record<string, any>, tenantId?: string }> = new Map();

    // MemGPT-style Core Memory Integration
    private coreMemories: Map<string, CoreMemoryState> = new Map();

    public getCoreMemory(contextId: string): CoreMemoryState {
        if (!this.coreMemories.has(contextId)) {
            // Initialize with default empty blocks
            this.coreMemories.set(contextId, {
                persona: "I am an advanced AI agent operating within the Orchestra framework. I utilize a MemGPT-style explicit memory system.",
                human: "No specific human details have been committed to core memory yet."
            });
        }
        return this.coreMemories.get(contextId)!;
    }

    public updateCoreMemory(contextId: string, block: 'persona' | 'human', content: string, append: boolean = false) {
        const state = this.getCoreMemory(contextId);
        if (append) {
            state[block] += '\n' + content;
        } else {
            state[block] = content;
        }
        globalEventStore.append({
            type: 'MEMORY_STORED',
            sourceAgentId: 'SYSTEM_MEMORY_MESH',
            threadId: contextId,
            payload: { action: 'CORE_MEMORY_UPDATE', block, content, append }
        });
    }

    // 1. Working Memory (Short-term context, sliding window)
    public async addWorkingMemory(threadId: string, agentId: string, content: any, tenantId?: string) {
        await this.store('WORKING', content, { threadId, agentId }, false, tenantId);
        this.checkConsolidation(threadId);
        this.garbageCollect();
    }

    // 2. Episodic Memory (Historical runs, event sequences)
    public async addEpisodicMemory(agentId: string, eventSequence: any, tenantId?: string) {
        await this.store('EPISODIC', eventSequence, { agentId }, false, tenantId);
        this.garbageCollect();
    }

    // 3. Semantic Memory (Factual knowledge, Vector/Graph capabilities in prod)
    public async addSemanticMemory(fact: string, entities: string[], tenantId?: string) {
        await this.store('SEMANTIC', fact, { entities }, true, tenantId);
        this.garbageCollect();
    }

    // 4. Procedural Memory (Instructions, learned rules, SOPs)
    public async addProceduralMemory(rule: string, skill: string, tenantId?: string, importance: number = 1) {
        // Check for existing rules that might be similar to avoid redundancy
        const existingResults = await this.searchSimilarMemories(rule, 1, tenantId);
        const existingRule = existingResults.find(m => m.tier === 'PROCEDURAL');

        if (existingRule && typeof existingRule.content === 'string') {
            // If the rule is nearly identical, boost importance rather than duplicating
            if (natural.DiceCoefficient(existingRule.content, rule) > 0.8) {
                existingRule.accessCount = (existingRule.accessCount || 1) + importance;
                return;
            }
        }

        await this.store('PROCEDURAL', rule, { skill, importance }, true, tenantId);
        this.garbageCollect();
    }

    private async store(tier: MemoryTier, content: any, metadata: Record<string, any>, vectorize = false, tenantId?: string) {
        const now = Date.now();
        this.memories.push({
            id: crypto.randomUUID(),
            tier,
            content,
            timestamp: now,
            metadata,
            tenantId,
            accessCount: 1,
            lastAccessed: now
        });

        if (vectorize && typeof content === 'string') {
            this.tfidf.addDocument(content);
        } else {
            // Add a placeholder to keep indices aligned
            this.tfidf.addDocument("");
        }
    }

    /**
     * Search across Semantic and Procedural memories (Local TF-IDF Integration)
     */
    public async searchSimilarMemories(query: string, topK: number = 3, tenantId?: string): Promise<VectorMemoryEntry[]> {
        const scoredEntries: { memory: VectorMemoryEntry; score: number }[] = [];
        const now = Date.now();
        
        this.tfidf.tfidfs(query, (i, measure) => {
            const memory = this.memories[i];
            if (measure > 0 && memory) {
                // Multi-tenant isolation check before proceeding
                if (tenantId && memory.tenantId && memory.tenantId !== tenantId) {
                    return;
                }
                
                // Ensure we only return appropriate memories (like vectorize = true above)
                if (memory.tier === 'SEMANTIC' || memory.tier === 'PROCEDURAL') {
                    const memoryStrength = Math.max(1, memory.accessCount || 1);
                    const daysSinceLastAccess = Math.max(0, (now - (memory.lastAccessed || memory.timestamp)) / (1000 * 60 * 60 * 24));
                    const retention = Math.exp(-daysSinceLastAccess / memoryStrength);
                    const decayedScore = measure * retention;

                    scoredEntries.push({
                        memory: memory,
                        score: decayedScore
                    });
                }
            }
        });

        // Sort descending by score and pick top K
        scoredEntries.sort((a, b) => b.score - a.score);
        const topResults = scoredEntries.slice(0, topK).map(res => res.memory);
        
        // Update access count and lastAccessed timestamp
        for (const memory of topResults) {
            memory.accessCount = (memory.accessCount || 1) + 1;
            memory.lastAccessed = now;
        }

        return topResults;
    }

    /**
     * Garbage Collection (Decay un-referenced Semantic memories)
     */
    public garbageCollect() {
        const now = Date.now();
        const DECAY_THRESHOLD = 0.1; // Garbage collect memories that drop below 10% retention

        let needsRebuild = false;

        for (let i = 0; i < this.memories.length; i++) {
            const m = this.memories[i];
            if (m && m.tier === 'SEMANTIC') {
                const memoryStrength = Math.max(1, m.accessCount || 1);
                const daysSinceLastAccess = Math.max(0, (now - (m.lastAccessed || m.timestamp)) / (1000 * 60 * 60 * 24));
                const retention = Math.exp(-daysSinceLastAccess / memoryStrength);

                if (retention < DECAY_THRESHOLD) {
                    globalEventStore.append({
                        type: 'MEMORY_STORED',
                        sourceAgentId: 'SYSTEM_MEMORY_MESH',
                        threadId: 'GLOBAL',
                        payload: { action: 'GARBAGE_COLLECT', memoryId: m.id, retention }
                    });
                    
                    this.memories[i] = null as any; // Tombstone
                    needsRebuild = true;
                }
            }
        }

        if (needsRebuild) {
            this.rebuildVectorIndex();
        }
    }

    /**
     * Enterprise GraphRAG: Insert nodes and edges into the Knowledge Graph
     */
    public addGraphTriplets(triplets: Array<{ source: string, target: string, relation: string, sourceMeta?: any, targetMeta?: any }>, tenantId?: string) {
        for (const t of triplets) {
            // Upsert source node
            if (!this.graphNodes.has(t.source)) {
                this.graphNodes.set(t.source, { label: t.source, properties: t.sourceMeta || {}, tenantId });
            }
            // Upsert target node
            if (!this.graphNodes.has(t.target)) {
                this.graphNodes.set(t.target, { label: t.target, properties: t.targetMeta || {}, tenantId });
            }
            // Add directed edge
            this.graphEdges.push({
                source: t.source,
                target: t.target,
                relation: t.relation,
                weight: 1.0,
                tenantId
            });
        }
    }

    /**
     * Enterprise GraphRAG: Sub-graph retrieval for context augmentation
     */
    public retrieveGraphContext(startNodes: string[], maxDepth: number = 2, tenantId?: string): string {
        const visited = new Set<string>();
        const resultTriplets: string[] = [];

        const traverse = (node: string, currentDepth: number) => {
            if (currentDepth > maxDepth) return;
            if (visited.has(node)) return;
            visited.add(node);

            // Find all outgoing edges
            const edges = this.graphEdges.filter(e => e.source === node && (!tenantId || e.tenantId === tenantId));
            for (const edge of edges) {
                resultTriplets.push(`[${edge.source}] --(${edge.relation})--> [${edge.target}]`);
                traverse(edge.target, currentDepth + 1);
            }
        };

        for (const node of startNodes) {
            traverse(node, 0);
        }

        return resultTriplets.join('\n');
    }

    private rebuildVectorIndex() {
        this.memories = this.memories.filter(m => m !== null);
        
        this.tfidf = new TfIdf();
        for (const m of this.memories) {
            if ((m.tier === 'SEMANTIC' || m.tier === 'PROCEDURAL') && typeof m.content === 'string') {
                this.tfidf.addDocument(m.content);
            } else {
                this.tfidf.addDocument("");
            }
        }
    }

    /**
     * Memory Consolidation (Moving highly-referenced Working memory into Episodic/Semantic)
     */
    private checkConsolidation(threadId: string) {
        const working = this.memories.filter(m => m.tier === 'WORKING' && m.metadata.threadId === threadId);
        
        // Simple heuristic: if we have more than 5 working memories for a thread, compress them
        if (working.length > 5) {
            const summary = `Compressed episode of ${working.length} events. Core theme: Sub-task progression.`;
            
            // Consolidate into Episodic
            this.addEpisodicMemory('SYSTEM', { originThread: threadId, summary });

            // Purge old working memory
            this.memories = this.memories.filter(m => !(m.tier === 'WORKING' && m.metadata.threadId === threadId));
            
            // Rebuild index to maintain alignment
            this.rebuildVectorIndex();

            globalEventStore.append({
                type: 'MEMORY_STORED',
                sourceAgentId: 'SYSTEM_MEMORY_MESH',
                threadId,
                payload: { action: 'CONSOLIDATION', oldLimit: working.length, newSummary: summary }
            });
        }
    }

    public retrieveContext(tier: MemoryTier, queryMetadata: Record<string, any>): MemoryEntry[] {
        // Naive implementation for now. Production uses RAG / Embeddings / Graph Traversal.
        return this.memories.filter(m => {
            if (m.tier !== tier) return false;
            for (const key in queryMetadata) {
                if (m.metadata[key] !== queryMetadata[key]) return false;
            }
            return true;
        });
    }
}
