export class CacheHitException extends Error {
    constructor(public cachedResponse: any) {
        super('CACHE_HIT');
        this.name = 'CacheHitException';
    }
}

export class HumanApprovalRequiredException extends Error {
    constructor(public toolName: string, public args: any, public checkpointId: string) {
        super(`Human Approval Required for tool ${toolName}`);
        this.name = 'HumanApprovalRequiredException';
    }
}

export interface AgenticPlugin {
    name: string;
    version: string;
    
    // Lifecycle Hooks
    beforeAgentExecute?: (agentId: string, task: any, threadId: string) => Promise<any | void>;
    afterAgentExecute?: (agentId: string, task: any, result: any, threadId: string) => Promise<any | void>;
    
    beforeToolInvoke?: (agentId: string, toolName: string, args: any, threadId: string) => Promise<{ toolName?: string, args?: any } | void>;
    onToolCalled?: (agentId: string, toolName: string, args: any, threadId: string) => Promise<void>;
    afterToolInvoke?: (agentId: string, toolName: string, args: any, result: any, threadId: string) => Promise<void>;
    onToolFault?: (agentId: string, toolName: string, args: any, error: any, threadId: string) => Promise<void>;
    
    onWorkflowSleep?: (threadId: string, state: any) => Promise<void>;
    onWorkflowResume?: (threadId: string, state: any) => Promise<void>;
    
    onAgentFault?: (agentId: string, error: any, task: any, threadId: string) => Promise<{ recovered: boolean, result?: any } | void>;
    
    beforeLLMCall?: (agentId: string, llmConfig: any, messages: any[], threadId: string) => Promise<{ llmConfig?: any, messages?: any[] } | void>;
    onLLMCall?: (agentId: string, messages: any[], threadId: string) => Promise<void>;
    onLLMResponse?: (agentId: string, response: any, usage: any, threadId: string) => Promise<void>;
}

class PluginRegistry {
    private plugins: AgenticPlugin[] = [];

    public register(plugin: AgenticPlugin) {
        this.plugins.push(plugin);
        console.log(`[PluginRegistry] Registered Plugin: ${plugin.name} v${plugin.version}`);
    }

    public async emitBeforeAgentExecute(agentId: string, task: any, threadId: string): Promise<any> {
        let currentTask = task;
        for (const plugin of this.plugins) {
            if (plugin.beforeAgentExecute) {
                const modifiedTask = await plugin.beforeAgentExecute(agentId, currentTask, threadId);
                if (modifiedTask !== undefined) {
                    currentTask = modifiedTask;
                }
            }
        }
        return currentTask;
    }

    public async emitAfterAgentExecute(agentId: string, task: any, result: any, threadId: string): Promise<any> {
        let currentResult = result;
        for (const plugin of this.plugins) {
            if (plugin.afterAgentExecute) {
                const modifiedResult = await plugin.afterAgentExecute(agentId, task, currentResult, threadId);
                if (modifiedResult !== undefined) {
                    currentResult = modifiedResult;
                }
            }
        }
        return currentResult;
    }

    public async emitBeforeToolInvoke(agentId: string, toolName: string, args: any, threadId: string): Promise<{ toolName: string, args: any }> {
        let currentToolInfo = { toolName, args };
        for (const plugin of this.plugins) {
            if (plugin.beforeToolInvoke) {
                const modifier = await plugin.beforeToolInvoke(agentId, currentToolInfo.toolName, currentToolInfo.args, threadId);
                if (modifier) {
                    if (modifier.toolName) currentToolInfo.toolName = modifier.toolName;
                    if (modifier.args) currentToolInfo.args = modifier.args;
                }
            }
        }
        return currentToolInfo;
    }

    public async emitOnToolCalled(agentId: string, toolName: string, args: any, threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onToolCalled) {
                await plugin.onToolCalled(agentId, toolName, args, threadId);
            }
        }
    }

    public async emitAfterToolInvoke(agentId: string, toolName: string, args: any, result: any, threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.afterToolInvoke) {
                await plugin.afterToolInvoke(agentId, toolName, args, result, threadId);
            }
        }
    }

    public async emitOnToolFault(agentId: string, toolName: string, args: any, error: any, threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onToolFault) {
                await plugin.onToolFault(agentId, toolName, args, error, threadId);
            }
        }
    }

    public async emitOnWorkflowSleep(threadId: string, state: any): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onWorkflowSleep) {
                await plugin.onWorkflowSleep(threadId, state);
            }
        }
    }

    public async emitOnWorkflowResume(threadId: string, state: any): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onWorkflowResume) {
                await plugin.onWorkflowResume(threadId, state);
            }
        }
    }

    public async emitOnAgentFault(agentId: string, error: any, task: any, threadId: string): Promise<{ recovered: boolean, result?: any } | undefined> {
        for (const plugin of this.plugins) {
            if (plugin.onAgentFault) {
                const recovery = await plugin.onAgentFault(agentId, error, task, threadId);
                if (recovery && recovery.recovered) {
                    return recovery;
                }
            }
        }
        return undefined;
    }

    public async emitBeforeLLMCall(agentId: string, llmConfig: any, messages: any[], threadId: string): Promise<{ llmConfig: any, messages: any[] }> {
        let currentConfig = llmConfig;
        let currentMessages = messages;
        for (const plugin of this.plugins) {
            if (plugin.beforeLLMCall) {
                const modifier = await plugin.beforeLLMCall(agentId, currentConfig, currentMessages, threadId);
                if (modifier) {
                    if (modifier.llmConfig) currentConfig = modifier.llmConfig;
                    if (modifier.messages) currentMessages = modifier.messages;
                }
            }
        }
        return { llmConfig: currentConfig, messages: currentMessages };
    }

    public async emitOnLLMCall(agentId: string, messages: any[], threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onLLMCall) {
                await plugin.onLLMCall(agentId, messages, threadId);
            }
        }
    }

    public async emitOnLLMResponse(agentId: string, response: any, usage: any, threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onLLMResponse) {
                await plugin.onLLMResponse(agentId, response, usage, threadId);
            }
        }
    }
}

export const globalPluginRegistry = new PluginRegistry();
