import type { BaseAgent } from './BaseAgent.ts';
import { globalToolRegistry } from '../tools/ToolRegistry.ts';
import { globalEventStore } from '../core/EventStore.ts';
import type { ToolRegistry } from '../tools/ToolRegistry.ts';
import type { EventStore } from '../core/EventStore.ts';

/**
 * Dynamic Agent Registry (Dimension 02)
 * Allows the system to search for, retrieve, or dynamically instantiate agents 
 * based on their listed capabilities and roles instead of static dependency injection.
 */
export class AgentRegistry {
    private agents: Map<string, BaseAgent> = new Map();
    private toolRegistry: ToolRegistry;
    private eventStore: EventStore;
    
    // Default capability mappings per role
    private roleDefaults: Record<string, string[]> = {
        'WORKER': ['web_search', 'code_interpreter', 'knowledge_base', 'core_logic', 'data_analysis', 'api_integration'],
        'MANAGER': ['knowledge_base', 'core_logic', 'planning', 'strategic', 'resource_management', 'governance'],
        'CRITIC': ['code_interpreter', 'core_logic', 'validation', 'security_audit', 'quality_assurance'],
        'PLANNER': ['planning', 'core_logic', 'knowledge_base', 'strategic', 'market_analysis', 'forecasting']
    };

    constructor(options: { toolRegistry?: ToolRegistry; eventStore?: EventStore } = {}) {
        this.toolRegistry = options.toolRegistry || globalToolRegistry;
        this.eventStore = options.eventStore || globalEventStore;
    }

    public register(agent: BaseAgent) {
        this.agents.set(agent.card.id, agent);
    }

    public unregister(agentId: string) {
        this.agents.delete(agentId);
    }

    public get(agentId: string): BaseAgent | undefined {
        return this.agents.get(agentId);
    }

    public findAgentsByRole(role: string): BaseAgent[] {
        return Array.from(this.agents.values()).filter(a => a.card.role === role);
    }

    public findAgentsByCapabilities(requiredCapabilities: string[]): BaseAgent[] {
        return Array.from(this.agents.values()).filter(agent => {
            return requiredCapabilities.every(req => agent.card.capabilities.includes(req));
        });
    }

    /**
     * Dynamically selects tools for an agent based on its internal capabilities 
     * or its role-based defaults.
     */
    public getToolsForAgent(agentId: string): Record<string, any> {
        const agent = this.agents.get(agentId);
        if (!agent) return {};

        // All agents implicitly have 'core_logic' and 'discovery' to ensure they never lose 
        // access to basic system functionality.
        const baseCapabilities = ['core_logic', 'discovery'];

        const effectiveCapabilities = [
            ...baseCapabilities,
            ...(agent.card.capabilities.length > 0 
                ? agent.card.capabilities 
                : (this.roleDefaults[agent.card.role] || []))
        ];

        // Unique set of effective capabilities
        const uniqueCapabilities = Array.from(new Set(effectiveCapabilities));

        return this.toolRegistry.getToolsForAgent(uniqueCapabilities);
    }

    public getAllAgents(): BaseAgent[] {
        return Array.from(this.agents.values());
    }

    public getAll(): BaseAgent[] {
        return this.getAllAgents();
    }

    /**
     * Runtime privilege escalation: grants a new capability to an existing agent.
     */
    public grantCapability(agentId: string, capability: string) {
        const agent = this.agents.get(agentId);
        if (agent) {
            if (!agent.card.capabilities.includes(capability)) {
                agent.card.capabilities.push(capability);
                
                this.eventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'SYSTEM',
                    targetAgentId: agentId,
                    threadId: 'GLOBAL',
                    payload: { action: 'CAPABILITY_GRANTED', capability }
                });
            }
        }
    }

    /**
     * Specific tool grant: allows an agent to use a specific tool by name.
     */
    public grantTool(agentId: string, toolName: string) {
        this.grantCapability(agentId, `tool:${toolName}`);
    }

    public clear() {
        this.agents.clear();
    }
}

export const globalRegistry = new AgentRegistry();
