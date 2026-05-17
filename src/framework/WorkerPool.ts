import { WorkerNode } from './orchestration/WorkerNode.ts';

export class WorkerPool {
    private workers: WorkerNode[] = [];
    private isInitialized: boolean = false;
    
    public init(count: number = 3) {
        if (this.isInitialized) return;
        
        for (let i = 0; i < count; i++) {
            const worker = new WorkerNode(`node_${i + 1}`);
            worker.start();
            this.workers.push(worker);
        }
        console.log(`[WorkerPool] Initialized ${count} distributed worker simulated nodes.`);
        this.isInitialized = true;
    }
}

export const globalWorkerPool = new WorkerPool();
