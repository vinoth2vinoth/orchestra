import { BaseAgent } from '../../agents/BaseAgent.ts';
import { WorkflowConfig } from '../Orchestrator.ts';
import { Span } from '@opentelemetry/api';

export interface ParadigmContext {
    threadId: string;
    blackboard: Record<string, any>;
    executeAgentTask: (agent: BaseAgent, task: any, threadId: string, blackboard?: Record<string, any>, parentSpan?: Span) => Promise<any>;
    parentSpan?: Span;
}

export abstract class ParadigmStrategy {
    abstract run(task: any, agents: BaseAgent[], context: ParadigmContext, config?: WorkflowConfig): Promise<any>;
}
