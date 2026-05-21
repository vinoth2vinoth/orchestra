import { z } from 'zod';
import { tool } from 'ai';
import { globalPluginRegistry } from '../core/PluginRegistry.ts';
import { globalEscalationManager } from '../governance/EscalationManager.ts';
import { getExecutionContext } from '../core/ExecutionContext.ts';
import type { ExecutionContext } from '../core/ExecutionContext.ts';
import { globalEventStore } from '../core/EventStore.ts';
import { globalIAMInterceptor } from '../security/IAMInterceptor.ts';

const summarizeToolArgs = (value: any): any => {
    if (typeof value === 'string') {
        return value.length > 500 ? `${value.slice(0, 500)}... [${value.length} chars]` : value;
    }
    if (Array.isArray(value)) {
        return value.map(item => summarizeToolArgs(item));
    }
    if (value && typeof value === 'object') {
        const summarized: Record<string, any> = {};
        for (const [key, item] of Object.entries(value)) {
            const lowerKey = key.toLowerCase();
            if (lowerKey === '_secrets' || lowerKey.includes('secret') || lowerKey.includes('token') || lowerKey.includes('password')) {
                summarized[key] = '[REDACTED]';
                continue;
            }
            if (['content', 'body', 'code'].includes(lowerKey) && typeof item === 'string') {
                summarized[key] = `[${item.length} chars]`;
                continue;
            }
            summarized[key] = summarizeToolArgs(item);
        }
        return summarized;
    }
    return value;
};

// Simplistic representation of Model Context Protocol / Tool Registry
export class ToolRegistry {
    private toolDefinitions: Map<string, { tool: any; capabilities: string[] }> = new Map();

    public register(
        name: string, 
        description: string, 
        inputSchema: any, 
        execute: (args: any, context: ExecutionContext) => Promise<any>,
        options: { highRisk?: boolean; capabilities?: string[] } = {}
    ) {
        const toolObj = tool({
            description: options.highRisk ? `[HIGH-RISK] ${description}` : description,
            parameters: inputSchema,
            execute: async (args: any) => {
                let context;
                try {
                    context = getExecutionContext();
                } catch (err) {
                    // Fallback or crash, choosing fallback to default for backwards compatibility in un-migrated tests
                    context = { 
                        tenantId: 'GLOBAL', 
                        agentId: 'DYNAMIC_AGENT', 
                        threadId: 'DYNAMIC_THREAD', 
                        capabilities: options.capabilities || [] 
                    };
                }

                const { agentId, threadId, tenantId, capabilities } = context;
                const pluginRegistry = context.runtime?.pluginRegistry || globalPluginRegistry;
                const escalationManager = context.runtime?.escalationManager || globalEscalationManager;
                const eventStore = context.runtime?.eventStore || globalEventStore;
                const iamInterceptor = context.runtime?.iamInterceptor || globalIAMInterceptor;

                // Step 1: Execute High Risk Check
                if (options.highRisk) {
                    const res = await escalationManager.requestApproval(
                        threadId,
                        agentId,
                        `Execution of High-Risk Tool: ${name}`,
                        { toolName: name, args }
                    );
                    if (res.resolution === 'REJECTED') {
                        throw new Error(`Execution of ${name} was REJECTED by human supervisor.`);
                    }
                }

                // Step 2: IAM Validation and Injection (Tenant Isolation boundary)
                const securedArgs = iamInterceptor.interceptAndInject({
                    tenantId,
                    agentId,
                    threadId,
                    capabilities
                }, name, args);

                // Step 3: Emit Hooks
                const modifier = await pluginRegistry.emitBeforeToolInvoke(agentId, name, securedArgs, threadId);
                eventStore.append({
                    type: 'TOOL_CALL_REQUESTED',
                    sourceAgentId: agentId,
                    threadId,
                    payload: { tool: modifier.toolName, args: summarizeToolArgs(modifier.args) }
                });
                await pluginRegistry.emitOnToolCalled(agentId, modifier.toolName, modifier.args, threadId);
                
                // Step 4: Execute using secured arguments
                try {
                    const result = await execute(modifier.args, context);
                    await pluginRegistry.emitAfterToolInvoke(agentId, modifier.toolName, modifier.args, result, threadId);
                    return result;
                } catch (error) {
                    await pluginRegistry.emitOnToolFault(agentId, modifier.toolName, modifier.args, error, threadId);
                    throw error;
                }
            }
        } as any);

        this.toolDefinitions.set(name, {
            tool: toolObj,
            capabilities: options.capabilities || []
        });
    }

    public getToolsForAgent(agentCapabilities: string[]): Record<string, any> {
        const availableTools: Record<string, any> = {};
        for (const [name, def] of this.toolDefinitions.entries()) {
            const hasRequiredCapability = agentCapabilities.includes('ALL') || 
                                         def.capabilities.length === 0 || 
                                         def.capabilities.some(cap => agentCapabilities.includes(cap)) ||
                                         agentCapabilities.includes(`tool:${name}`);
            
            if (hasRequiredCapability) {
                availableTools[name] = def.tool;
            }
        }
        return availableTools;
    }

    public getAllTools(): Record<string, any> {
        const all: Record<string, any> = {};
        for (const [name, def] of this.toolDefinitions.entries()) {
            all[name] = def.tool;
        }
        return all;
    }
}

export const globalToolRegistry = new ToolRegistry();

// Mock tools for demo purposes
globalToolRegistry.register(
    'searchDatabase', 
    'Search the internal knowledge base', 
    z.object({ query: z.string().describe('The search query to look up') }),
    async ({ query }) => {
        return `[Mock Database Result]: Information found for '${query}'. The system is running normally.`;
    },
    { capabilities: ['web_search', 'knowledge_base'] }
);

globalToolRegistry.register(
    'deployToProduction',
    'Deploy the current build to the production environment',
    z.object({ 
        version: z.string().describe('The version tag to deploy'),
        confirm: z.boolean().describe('Set to true to confirm deployment')
    }),
    async ({ version }) => {
        return `SUCCESS: Version ${version} has been deployed to production.`;
    },
    { highRisk: true, capabilities: ['deployment_admin'] }
);

globalToolRegistry.register(
    'deleteUserAccount',
    'Permanently delete a user account and all associated data',
    z.object({ 
        userId: z.string().describe('The ID of the user to delete'),
        reason: z.string().describe('Reason for deletion')
    }),
    async ({ userId }) => {
        return `SUCCESS: User ${userId} has been permanently deleted.`;
    },
    { highRisk: true, capabilities: ['user_management'] }
);

globalToolRegistry.register(
    'analyzeDataset',
    'Perform complex statistical analysis on a provided dataset',
    z.object({ 
        datasetId: z.string().describe('ID of the dataset to analyze'),
        analysisType: z.enum(['regression', 'clustering', 'anomaly_detection']).describe('Type of analysis to perform')
    }),
    async ({ datasetId, analysisType }) => {
        return `SUCCESS: Analysis of type ${analysisType} completed on dataset ${datasetId}. Results: [Normal distribution found].`;
    },
    { capabilities: ['data_analysis'] }
);

globalToolRegistry.register(
    'executeApiCall',
    'Invoke an external API endpoint with specific parameters',
    z.object({ 
        endpoint: z.string().describe('The URL of the API endpoint'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).describe('HTTP method'),
        payload: z.string().optional().describe('Payload for the request. Serialize to string if it is an object.')
    }),
    async ({ endpoint, method }) => {
        return `SUCCESS: External API call ${method} ${endpoint} completed with status 200.`;
    },
    { capabilities: ['api_integration'] }
);

globalToolRegistry.register(
    'performSecurityAudit',
    'Scan a target resource for known security vulnerabilities',
    z.object({ 
        targetId: z.string().describe('The ID of the resource to scan')
    }),
    async ({ targetId }) => {
        return `SUCCESS: Security audit for ${targetId} completed. 0 critical vulnerabilities found. 2 low-risk warnings.`;
    },
    { capabilities: ['security_audit'] }
);

globalToolRegistry.register(
    'generateMarketForecast',
    'Generate a market trend forecast for a specific sector',
    z.object({ 
        sector: z.string().describe('The market sector to forecast (e.g., Tech, Finance)')
    }),
    async ({ sector }) => {
        return `SUCCESS: Forecast for ${sector} generated. Predicted 15% growth over next 12 months.`;
    },
    { capabilities: ['forecasting'] }
);
