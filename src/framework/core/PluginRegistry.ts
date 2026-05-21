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
    failureMode?: 'fail-open' | 'fail-closed';
    
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

export class PluginRegistry {
    private plugins: AgenticPlugin[] = [];

    private shouldRethrow(plugin: AgenticPlugin, error: any): boolean {
        return error instanceof CacheHitException ||
            error instanceof HumanApprovalRequiredException ||
            plugin.failureMode === 'fail-closed';
    }

    private logPluginError(plugin: AgenticPlugin, hook: string, error: any) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[PluginRegistry] ${plugin.name}.${hook} failed: ${message}`);
    }

    private hasSameTaskShape(original: any, candidate: any): boolean {
        if (candidate === undefined) return true;
        if (original === null || candidate === null) return original === candidate;
        if (Array.isArray(original) || Array.isArray(candidate)) {
            return Array.isArray(original) && Array.isArray(candidate);
        }
        if (typeof original !== typeof candidate) return false;
        if (typeof original === 'object') {
            return !this.hasUnsafeObjectKey(candidate, new WeakSet<object>());
        }
        return true;
    }

    private hasUnsafeObjectKey(value: any, seen: WeakSet<object>): boolean {
        if (!value || typeof value !== 'object') return false;
        if (seen.has(value)) return false;
        seen.add(value);
        for (const key of Object.keys(value)) {
            if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
                return true;
            }
            if (this.hasUnsafeObjectKey(value[key], seen)) {
                return true;
            }
        }
        return false;
    }

    public register(plugin: AgenticPlugin) {
        if (this.plugins.some(existing => existing.name === plugin.name)) {
            return;
        }
        this.plugins.push(plugin);
        console.log(`[PluginRegistry] Registered Plugin: ${plugin.name} v${plugin.version}`);
    }

    public listPlugins(): Array<{ name: string; version: string }> {
        return this.plugins.map(plugin => ({ name: plugin.name, version: plugin.version }));
    }

    public async emitBeforeAgentExecute(agentId: string, task: any, threadId: string): Promise<any> {
        let currentTask = task;
        for (const plugin of this.plugins) {
            if (plugin.beforeAgentExecute) {
                try {
                    const modifiedTask = await plugin.beforeAgentExecute(agentId, currentTask, threadId);
                    if (modifiedTask !== undefined) {
                        if (!this.hasSameTaskShape(currentTask, modifiedTask)) {
                            this.logPluginError(plugin, 'beforeAgentExecute', new Error(`Rejected task shape change from ${typeof currentTask} to ${typeof modifiedTask}`));
                            continue;
                        }
                        currentTask = modifiedTask;
                    }
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'beforeAgentExecute', err);
                }
            }
        }
        return currentTask;
    }

    public async emitAfterAgentExecute(agentId: string, task: any, result: any, threadId: string): Promise<any> {
        let currentResult = result;
        for (const plugin of this.plugins) {
            if (plugin.afterAgentExecute) {
                try {
                    const modifiedResult = await plugin.afterAgentExecute(agentId, task, currentResult, threadId);
                    if (modifiedResult !== undefined) {
                        currentResult = modifiedResult;
                    }
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'afterAgentExecute', err);
                }
            }
        }
        return currentResult;
    }

    public async emitBeforeToolInvoke(agentId: string, toolName: string, args: any, threadId: string): Promise<{ toolName: string, args: any }> {
        let currentToolInfo = { toolName, args };
        for (const plugin of this.plugins) {
            if (plugin.beforeToolInvoke) {
                try {
                    const modifier = await plugin.beforeToolInvoke(agentId, currentToolInfo.toolName, currentToolInfo.args, threadId);
                    if (modifier) {
                        if (modifier.toolName) currentToolInfo.toolName = modifier.toolName;
                        if (modifier.args) currentToolInfo.args = modifier.args;
                    }
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'beforeToolInvoke', err);
                }
            }
        }
        return currentToolInfo;
    }

    public async emitOnToolCalled(agentId: string, toolName: string, args: any, threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onToolCalled) {
                try {
                    await plugin.onToolCalled(agentId, toolName, args, threadId);
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'onToolCalled', err);
                }
            }
        }
    }

    public async emitAfterToolInvoke(agentId: string, toolName: string, args: any, result: any, threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.afterToolInvoke) {
                try {
                    await plugin.afterToolInvoke(agentId, toolName, args, result, threadId);
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'afterToolInvoke', err);
                }
            }
        }
    }

    public async emitOnToolFault(agentId: string, toolName: string, args: any, error: any, threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onToolFault) {
                try {
                    await plugin.onToolFault(agentId, toolName, args, error, threadId);
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'onToolFault', err);
                }
            }
        }
    }

    public async emitOnWorkflowSleep(threadId: string, state: any): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onWorkflowSleep) {
                try {
                    await plugin.onWorkflowSleep(threadId, state);
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'onWorkflowSleep', err);
                }
            }
        }
    }

    public async emitOnWorkflowResume(threadId: string, state: any): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onWorkflowResume) {
                try {
                    await plugin.onWorkflowResume(threadId, state);
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'onWorkflowResume', err);
                }
            }
        }
    }

    public async emitOnAgentFault(agentId: string, error: any, task: any, threadId: string): Promise<{ recovered: boolean, result?: any } | undefined> {
        for (const plugin of this.plugins) {
            if (plugin.onAgentFault) {
                try {
                    const recovery = await plugin.onAgentFault(agentId, error, task, threadId);
                    if (recovery && recovery.recovered) {
                        return recovery;
                    }
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'onAgentFault', err);
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
                try {
                    const modifier = await plugin.beforeLLMCall(agentId, currentConfig, currentMessages, threadId);
                    if (modifier) {
                        if (modifier.llmConfig) currentConfig = modifier.llmConfig;
                        if (modifier.messages) currentMessages = modifier.messages;
                    }
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'beforeLLMCall', err);
                }
            }
        }
        return { llmConfig: currentConfig, messages: currentMessages };
    }

    public async emitOnLLMCall(agentId: string, messages: any[], threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onLLMCall) {
                try {
                    await plugin.onLLMCall(agentId, messages, threadId);
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'onLLMCall', err);
                }
            }
        }
    }

    public async emitOnLLMResponse(agentId: string, response: any, usage: any, threadId: string): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onLLMResponse) {
                try {
                    await plugin.onLLMResponse(agentId, response, usage, threadId);
                } catch (err) {
                    if (this.shouldRethrow(plugin, err)) throw err;
                    this.logPluginError(plugin, 'onLLMResponse', err);
                }
            }
        }
    }
}

export const globalPluginRegistry = new PluginRegistry();
