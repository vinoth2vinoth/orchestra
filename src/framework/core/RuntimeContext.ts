import { PluginRegistry, globalPluginRegistry } from './PluginRegistry.ts';
import { WorkerPool, globalWorkerPool } from './WorkerPool.ts';
import { globalCircuitBreakers, CircuitBreakerRegistry } from '../resilience/CircuitBreaker.ts';
import { QueueBroker, globalQueueBroker } from '../orchestration/QueueBroker.ts';
import { PolicyEngine, globalPolicyEngine } from '../governance/PolicyEngine.ts';
import { AuditLog, globalAuditLog } from '../governance/AuditLog.ts';
import { StateAdapter, globalStateAdapter } from './StateAdapter.ts';
import { AgentRegistry, globalRegistry } from '../agents/AgentRegistry.ts';
import { EventStore, globalEventStore } from './EventStore.ts';
import { WorkflowCheckpointer, globalCheckpointer } from '../orchestration/Checkpointer.ts';
import { StateStore, globalStateStore } from '../orchestration/StateStore.ts';
import { EscalationManager, globalEscalationManager } from '../governance/EscalationManager.ts';
import { GenealogyTracker, globalGenealogy } from '../governance/GenealogyTracker.ts';
import { ToolRegistry, globalToolRegistry } from '../tools/ToolRegistry.ts';

export interface RuntimeServices {
    tenantId: string;
    stateAdapter: StateAdapter;
    pluginRegistry: PluginRegistry;
    circuitBreakers: CircuitBreakerRegistry;
    queueBroker: QueueBroker;
    workerPool: WorkerPool;
    policyEngine: PolicyEngine;
    auditLog: AuditLog;
    agentRegistry: AgentRegistry;
    eventStore: EventStore;
    checkpointer: WorkflowCheckpointer;
    stateStore: StateStore;
    escalationManager: EscalationManager;
    genealogy: GenealogyTracker;
    toolRegistry: ToolRegistry;
}

export type RuntimeContextOptions = Partial<RuntimeServices> & {
    tenantId?: string;
};

export function createRuntimeContext(options: RuntimeContextOptions = {}): RuntimeServices {
    const eventStore = options.eventStore || globalEventStore;
    const toolRegistry = options.toolRegistry || globalToolRegistry;
    const auditLog = options.auditLog || globalAuditLog;
    const needsScopedRegistry = Boolean(
        options.tenantId ||
        options.stateAdapter ||
        options.pluginRegistry ||
        options.circuitBreakers ||
        options.queueBroker ||
        options.workerPool ||
        options.policyEngine ||
        options.auditLog ||
        options.eventStore ||
        options.checkpointer ||
        options.stateStore ||
        options.toolRegistry ||
        options.escalationManager ||
        options.genealogy
    );
    const escalationManager = options.escalationManager || (
        options.eventStore || options.auditLog
            ? new EscalationManager(eventStore, auditLog)
            : globalEscalationManager
    );
    const genealogy = options.genealogy || (
        options.eventStore ? new GenealogyTracker(eventStore) : globalGenealogy
    );
    const circuitBreakers = options.circuitBreakers || (
        options.eventStore ? new CircuitBreakerRegistry(eventStore) : globalCircuitBreakers
    );
    const policyEngine = options.policyEngine || (
        options.eventStore ? new PolicyEngine(eventStore) : globalPolicyEngine
    );
    const agentRegistry = options.agentRegistry || (
        needsScopedRegistry
            ? new AgentRegistry({ eventStore, toolRegistry })
            : globalRegistry
    );

    return {
        tenantId: options.tenantId || 'GLOBAL',
        stateAdapter: options.stateAdapter || globalStateAdapter,
        pluginRegistry: options.pluginRegistry || globalPluginRegistry,
        circuitBreakers,
        queueBroker: options.queueBroker || globalQueueBroker,
        workerPool: options.workerPool || globalWorkerPool,
        policyEngine,
        auditLog,
        agentRegistry,
        eventStore,
        checkpointer: options.checkpointer || globalCheckpointer,
        stateStore: options.stateStore || globalStateStore,
        escalationManager,
        genealogy,
        toolRegistry
    };
}

export const globalRuntimeContext = createRuntimeContext();
