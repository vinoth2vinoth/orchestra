import { globalEscalationManager } from '../governance/EscalationManager.ts';
import { globalToolRegistry } from './ToolRegistry.ts';
import { z } from 'zod';
import { getExecutionContext } from '../core/ExecutionContext.ts';

/**
 * HumanHelpTool (Dimension 08)
 * Allows agents to explicitly ask for user clarification or authorization.
 */
export const registerHumanHelpTool = () => {
    globalToolRegistry.register(
        'request_human_help',
        'Allows the agent to pause execution and ask the user for clarification, additional info, or high-stakes authorization.',
        z.object({
            justification: z.string().describe('Clear reason why human help is needed'),
            description: z.string().describe('Short summary of what is being requested or clarification needed')
        }),
        async (args: any) => {
            const context = getExecutionContext();
            const { threadId, agentId } = context;
            const escalationManager = context.runtime?.escalationManager || globalEscalationManager;

            // Use the escalation manager to suspend and wait
            return await escalationManager.requestApproval(
                threadId, 
                agentId, 
                args.description || "Agent requested help", 
                { requestedToolName: 'request_human_help', ...args }
            );
        },
        { capabilities: ['discovery'] }
    );
};
