import { AsyncLocalStorage } from 'async_hooks';

export interface ExecutionContext {
    tenantId: string;
    agentId: string;
    threadId: string;
    capabilities: string[];
}

export const executionAsyncStorage = new AsyncLocalStorage<ExecutionContext>();

/**
 * Gets the current execution context. Throws if not currently within an execution context.
 */
export function getExecutionContext(): ExecutionContext {
    const ctx = executionAsyncStorage.getStore();
    if (!ctx) {
        throw new Error('Called getExecutionContext() outside of an execution context');
    }
    return ctx;
}

/**
 * Runs a function within the provided execution context.
 */
export function runWithContext<T>(context: ExecutionContext, fn: () => T): T {
    return executionAsyncStorage.run(context, fn);
}
