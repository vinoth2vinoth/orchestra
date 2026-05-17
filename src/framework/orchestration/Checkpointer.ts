import { globalStorageMesh } from '../storage/StorageMesh.ts';

export interface CheckpointData {
    threadId: string;
    stepId: string;
    state: any;
    timestamp: number;
}

/**
 * LangGraph/Temporal-style state checkpointer.
 * Serializes the Orchestrator's internal state to a DB (Virtual File System) at each step.
 * Allows resuming the workflow from exact step where it failed.
 */
export class StateCheckpointer {
    /**
     * Saves a snapshot of the orchestrator state.
     */
    public async saveCheckpoint(threadId: string, stepId: string, state: any): Promise<void> {
        const checkpoint: CheckpointData = {
            threadId,
            stepId,
            state: JSON.parse(JSON.stringify(state)), // Deep clone to serialize
            timestamp: Date.now()
        };
        
        await globalStorageMesh.writeFile(`.orchestra/checkpoints/${threadId}.json`, JSON.stringify(checkpoint, null, 2));
    }

    /**
     * Loads the latest snapshot of the orchestrator state to resume.
     */
    public async getLatestCheckpoint(threadId: string): Promise<CheckpointData | null> {
        try {
            const data = await globalStorageMesh.readFile(`.orchestra/checkpoints/${threadId}.json`);
            return JSON.parse(data.toString()) as CheckpointData;
        } catch (err: any) {
            if (err.message.includes('ENOENT') || err.message.includes('not found')) {
                return null;
            }
            console.error(`[Checkpointer] Failed to load checkpoint for ${threadId}:`, err);
            return null;
        }
    }

    /**
     * Clears a checkpoint once the workflow is definitively complete to free up space.
     */
    public async clearCheckpoint(threadId: string): Promise<void> {
        try {
            // Write empty or "COMPLETED" state to clear it out, or ideally delete file.
            // Since our StorageMesh doesn't have delete, we just overwrite it.
            await globalStorageMesh.writeFile(`.orchestra/checkpoints/${threadId}.json`, JSON.stringify({ status: 'COMPLETED' }));
        } catch (err) {
            // Ignore if file doesn't exist
        }
    }
}

export const globalCheckpointer = new StateCheckpointer();
