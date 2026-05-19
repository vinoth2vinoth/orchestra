import { globalStorageMesh } from '../storage/StorageMesh.ts';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

export interface CheckpointData {
    threadId: string;
    stepId: string;
    state: any;
    timestamp: number;
}

/**
 * LangGraph/Temporal-style state checkpointer.
 * Serializes the Orchestrator's internal state to a DB (Virtual File System) at each step.
 * Includes AES-256-GCM hardware-accelerated encryption for data-at-rest protection.
 */
export class StateCheckpointer {
    private readonly ALGORITHM = 'aes-256-gcm';
    private readonly KEY_LENGTH = 32;
    private readonly IV_LENGTH = 12;
    private readonly AUTH_TAG_LENGTH = 16;
    private masterKey: Buffer;

    constructor() {
        // Derive stability key from env or fallback (in prod this must be a secret)
        if (!process.env.ORCHESTRA_ENCRYPTION_KEY) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('FATAL: ORCHESTRA_ENCRYPTION_KEY must be set in production.');
            }
            console.warn('[Checkpointer] WARNING: Using insecure default encryption key. Set ORCHESTRA_ENCRYPTION_KEY for persisted checkpoints.');
        }
        const secret = process.env.ORCHESTRA_ENCRYPTION_KEY || 'default-framework-key-do-not-use-in-prod';
        this.masterKey = createHash('sha256').update(secret).digest();
    }

    private encrypt(text: string): string {
        const iv = randomBytes(this.IV_LENGTH);
        const cipher = createCipheriv(this.ALGORITHM, this.masterKey, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag().toString('hex');
        
        // Format: iv:authTag:encrypted
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    }

    private decrypt(cipherText: string): string {
        const [ivHex, authTagHex, encryptedHex] = cipherText.split(':');
        
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = createDecipheriv(this.ALGORITHM, this.masterKey, iv);
        
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    /**
     * Saves a snapshot of the orchestrator state.
     */
    public async saveCheckpoint(threadId: string, stepId: string, state: any): Promise<void> {
        const checkpoint: CheckpointData = {
            threadId,
            stepId,
            state: JSON.parse(JSON.stringify(state)), 
            timestamp: Date.now()
        };
        
        const rawJson = JSON.stringify(checkpoint);
        const securedData = this.encrypt(rawJson);
        
        await globalStorageMesh.writeFile(`.orchestra/checkpoints/${threadId}.enc`, securedData);
    }

    /**
     * Loads the latest snapshot of the orchestrator state to resume.
     */
    public async getLatestCheckpoint(threadId: string): Promise<CheckpointData | null> {
        try {
            const encryptedData = await globalStorageMesh.readFile(`.orchestra/checkpoints/${threadId}.enc`);
            const decryptedJson = this.decrypt(encryptedData.toString());
            return JSON.parse(decryptedJson) as CheckpointData;
        } catch (err: any) {
            if (err.message.includes('ENOENT') || err.message.includes('not found')) {
                return null;
            }
            console.error(`[Checkpointer] Failed to load/decrypt checkpoint for ${threadId}:`, err);
            return null;
        }
    }

    /**
     * Clears a checkpoint once the workflow is definitively complete to free up space.
     */
    public async clearCheckpoint(threadId: string): Promise<void> {
        try {
            await globalStorageMesh.deleteFile(`.orchestra/checkpoints/${threadId}.enc`);
        } catch (err) {
            // Ignore if file doesn't exist
        }
    }
}

export const globalCheckpointer = new StateCheckpointer();
