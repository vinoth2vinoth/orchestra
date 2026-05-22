import { WorkerNode } from './WorkerNode.ts';
import { RuntimeContextOptions, RuntimeServices, createRuntimeContext } from '../core/RuntimeContext.ts';

export class WorkerCluster {
    private workers: WorkerNode[] = [];
    private nodeLastHeartbeat: Map<string, number> = new Map();
    private activeTaskByNode: Map<string, string | null> = new Map();
    private isInitialized: boolean = false;
    private monitorTimer: NodeJS.Timeout | null = null;
    private unsubscribeHeartbeats: (() => void) | null = null;
    private runtime: RuntimeServices;

    constructor(runtime: RuntimeContextOptions = {}) {
        this.runtime = createRuntimeContext(runtime);
    }
    
    public init(count: number = 3) {
        if (this.isInitialized) return;
        
        for (let i = 0; i < count; i++) {
            this.spawnWorker(`node_${i + 1}`);
        }
        console.log(`[WorkerCluster] Initialized ${count} distributed worker simulated nodes.`);
        this.isInitialized = true;
        
        // Listen to heartbeats
        this.runtime.messageBus.subscribe('WORKER_HEARTBEATS', (msg: any) => {
            this.nodeLastHeartbeat.set(msg.nodeId, msg.timestamp);
            this.activeTaskByNode.set(msg.nodeId, msg.activeTaskId);
        }).then(unsubscribe => {
            if (!this.isInitialized) {
                unsubscribe();
                return;
            }
            this.unsubscribeHeartbeats = unsubscribe;
        });
        
        // Monitor
        this.monitorTimer = setInterval(() => this.checkHealth(), 5000);
        if (this.monitorTimer.unref) this.monitorTimer.unref();
    }
    
    private spawnWorker(nodeId: string) {
        const worker = new WorkerNode(nodeId, this.runtime);
        worker.start();
        this.workers.push(worker);
        this.nodeLastHeartbeat.set(nodeId, Date.now());
    }
    
    private checkHealth() {
        const now = Date.now();
        for (let i = 0; i < this.workers.length; i++) {
            const worker = this.workers[i];
            const nodeId = worker.id;
            const lastHb = this.nodeLastHeartbeat.get(nodeId) || now;
            
            if (now - lastHb > 8000) { // 8 seconds without heartbeat
                console.warn(`[WorkerCluster] Detected unresponsive worker: ${nodeId}. Restarting...`);
                
                // Re-enqueue task if one was active
                const activeTaskId = this.activeTaskByNode.get(nodeId);
                if (activeTaskId) {
                    console.error(`[WorkerCluster] Worker ${nodeId} hung on task ${activeTaskId}. Node will be restarted.`);
                    import('./QueueBroker.ts').then(({ globalQueueBroker }) => {
                        // The broker's orphan cleanup will eventually error out the task.
                        // Or we could explicitly orphan it here. For simplicity we let QueueBroker timeout handle it.
                    }).catch(console.error);
                }
                
                worker.stop(); // Safe guard
                
                // Replace in array
                const newWorker = new WorkerNode(nodeId, this.runtime);
                newWorker.start();
                this.workers[i] = newWorker;
                this.nodeLastHeartbeat.set(nodeId, now); // reset
                this.activeTaskByNode.set(nodeId, null);
            }
        }
    }
    
    // For test
    public getWorkers() { return this.workers; }

    public stop() {
        for (const worker of this.workers) {
            worker.stop();
        }

        this.workers = [];
        this.nodeLastHeartbeat.clear();
        this.activeTaskByNode.clear();
        this.isInitialized = false;

        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
        }

        this.unsubscribeHeartbeats?.();
        this.unsubscribeHeartbeats = null;
    }
}

export const globalWorkerCluster = new WorkerCluster();
