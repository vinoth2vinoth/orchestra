import { WorkerNode } from './WorkerNode.ts';
import { globalMessageBus } from '../core/MessageBus.ts';

export class WorkerCluster {
    private workers: WorkerNode[] = [];
    private nodeLastHeartbeat: Map<string, number> = new Map();
    private activeTaskByNode: Map<string, string | null> = new Map();
    private isInitialized: boolean = false;
    private monitorTimer: NodeJS.Timeout | null = null;
    
    public init(count: number = 3) {
        if (this.isInitialized) return;
        
        for (let i = 0; i < count; i++) {
            this.spawnWorker(`node_${i + 1}`);
        }
        console.log(`[WorkerCluster] Initialized ${count} distributed worker simulated nodes.`);
        this.isInitialized = true;
        
        // Listen to heartbeats
        globalMessageBus.subscribe('WORKER_HEARTBEATS', (msg: any) => {
            this.nodeLastHeartbeat.set(msg.nodeId, msg.timestamp);
            this.activeTaskByNode.set(msg.nodeId, msg.activeTaskId);
        });
        
        // Monitor
        this.monitorTimer = setInterval(() => this.checkHealth(), 5000);
    }
    
    private spawnWorker(nodeId: string) {
        const worker = new WorkerNode(nodeId);
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
                const newWorker = new WorkerNode(nodeId);
                newWorker.start();
                this.workers[i] = newWorker;
                this.nodeLastHeartbeat.set(nodeId, now); // reset
                this.activeTaskByNode.set(nodeId, null);
            }
        }
    }
    
    // For test
    public getWorkers() { return this.workers; }
}

export const globalWorkerCluster = new WorkerCluster();
