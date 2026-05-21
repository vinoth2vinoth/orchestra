import { PluginRegistry, globalPluginRegistry } from './PluginRegistry.ts';
import { WorkerPool, globalWorkerPool } from './WorkerPool.ts';
import { globalCircuitBreakers, CircuitBreakerRegistry } from '../resilience/CircuitBreaker.ts';
import { QueueBroker, globalQueueBroker } from '../orchestration/QueueBroker.ts';
import { PolicyEngine, globalPolicyEngine } from '../governance/PolicyEngine.ts';
import { AuditLog, globalAuditLog } from '../governance/AuditLog.ts';
import { StateAdapter, globalStateAdapter } from './StateAdapter.ts';
import { AgentRegistry, globalRegistry } from '../agents/AgentRegistry.ts';
import { EventStore, globalEventStore } from './EventStore.ts';
import { createMessageBus } from './MessageBusFactory.ts';
import { WorkflowCheckpointer, globalCheckpointer } from '../orchestration/Checkpointer.ts';
import { StateStore, globalStateStore } from '../orchestration/StateStore.ts';
import { EscalationManager, globalEscalationManager } from '../governance/EscalationManager.ts';
import { GenealogyTracker, globalGenealogy } from '../governance/GenealogyTracker.ts';
import { ToolRegistry, globalToolRegistry } from '../tools/ToolRegistry.ts';
import { IAMInterceptor, globalIAMInterceptor } from '../security/IAMInterceptor.ts';

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
    iamInterceptor: IAMInterceptor;
}

export type RuntimeContextOptions = Partial<RuntimeServices> & {
    tenantId?: string;
};

function scopedKey(base: string, tenantId: string): string {
    return tenantId === 'GLOBAL' ? base : `${base}:${tenantId}`;
}

export function createRuntimeContext(options: RuntimeContextOptions = {}): RuntimeServices {
    const tenantId = options.tenantId || 'GLOBAL';
    const stateAdapter = options.stateAdapter || globalStateAdapter;
    const messageBus = options.stateAdapter && (!options.eventStore || !options.queueBroker)
        ? createMessageBus()
        : undefined;
    const eventStore = options.eventStore || (
        options.stateAdapter
            ? new EventStore({
                stateAdapter,
                messageBus,
                historyKey: scopedKey('framework_events', tenantId),
                topic: scopedKey('FRAMEWORK_EVENTS', tenantId)
            })
            : globalEventStore
    );
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
        options.iamInterceptor ||
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
        tenantId,
        stateAdapter,
        pluginRegistry: options.pluginRegistry || globalPluginRegistry,
        circuitBreakers,
        queueBroker: options.queueBroker || (
            options.stateAdapter
                ? new QueueBroker({
                    stateAdapter,
                    messageBus,
                    namespace: scopedKey('queue', tenantId)
                })
                : globalQueueBroker
        ),
        workerPool: options.workerPool || globalWorkerPool,
        policyEngine,
        auditLog,
        agentRegistry,
        eventStore,
        checkpointer: options.checkpointer || globalCheckpointer,
        stateStore: options.stateStore || globalStateStore,
        escalationManager,
        genealogy,
        toolRegistry,
        iamInterceptor: options.iamInterceptor || globalIAMInterceptor
    };
}

export const globalRuntimeContext = createRuntimeContext();
