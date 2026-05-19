import { globalQueueBroker, TaskPayload } from './QueueBroker.ts';
import { globalRegistry } from '../agents/AgentRegistry.ts';
import { AgentCard } from '../core/types.ts';
import { globalEventStore } from '../core/EventStore.ts';

/**
 * Represents an independent worker process/node that pulls tasks from the QueueBroker.
 * In a real distributed system, this would be a separate process or server instance
 * pulling jobs via Redis/BullMQ.
 */
export class WorkerNode {
    private nodeId: string;
    private isRunning: boolean = false;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private activeTaskId: string | null = null;
    
    constructor(nodeId: string) {
        this.nodeId = nodeId;
    }
    
    public get id() { return this.nodeId; }
    
    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`[WorkerNode ${this.nodeId}] Starting to listen for tasks...`);
        
        // Start Heartbeat
        this.heartbeatTimer = setInterval(() => {
            if (!this.isRunning) return;
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: `WORKER_${this.nodeId}`,
                threadId: 'GLOBAL_HEARTBEAT',
                payload: {
                    action: 'HEARTBEAT',
                    nodeId: this.nodeId,
                    activeTaskId: this.activeTaskId,
                    timestamp: Date.now()
                }
            });
            // We also publish to message bus for the health monitor
            import('../core/MessageBus.ts').then(({ globalMessageBus }) => {
                globalMessageBus.publish('WORKER_HEARTBEATS', {
                    nodeId: this.nodeId,
                    activeTaskId: this.activeTaskId,
                    timestamp: Date.now()
                });
            }).catch(console.error);
        }, 2000);
        
        // Use general TASK topic for dynamic agent scaling (H2 fixed)
        globalQueueBroker.subscribeToAllTasks(async (task: TaskPayload) => {
            if (!this.isRunning) return;
            this.activeTaskId = task.taskId;
            console.log(`[WorkerNode ${this.nodeId}] Picked up task ${task.taskId} for agent ${task.agentId}`);
            
            try {
                let agentToExec = globalRegistry.get(task.agentId);
                if (!agentToExec) {
                    // Small delay to allow registry propagation
                    await new Promise(r => setTimeout(r, 500));
                    agentToExec = globalRegistry.get(task.agentId);
                }
                
                if (!agentToExec) throw new Error(`Agent ${task.agentId} not found in registry`);

                // C4 remediation: Reset volatile state before execution
                agentToExec.reset();

                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: `WORKER_${this.nodeId}`,
                    threadId: task.threadId,
                    payload: { message: `Simulated Worker Node ${this.nodeId} assumed identity of agent ${agentToExec.card.name} for execution.` }
                });

                const result = await agentToExec.execute(task.payload, task.threadId);
                
                if (this.isRunning) {
                    await globalQueueBroker.publishResult({
                        taskId: task.taskId,
                        status: 'success',
                        result
                    });
                }
            } catch (err: any) {
                console.error(`[WorkerNode ${this.nodeId}] Failed to process task ${task.taskId}:`, err);
                if (this.isRunning) {
                    await globalQueueBroker.publishResult({
                        taskId: task.taskId,
                        status: 'error',
                        error: err.message
                    });
                }
            } finally {
                if (this.activeTaskId === task.taskId) {
                    this.activeTaskId = null;
                }
            }
        }, this.nodeId);
    }

    public stop() {
        this.isRunning = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        console.log(`[WorkerNode ${this.nodeId}] Stopped.`);
    }
    
    // Simulate a crash for real-time testing
    public crash() {
        console.error(`[WorkerNode ${this.nodeId}] CRASHING (simulated).`);
        this.isRunning = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    }
}
