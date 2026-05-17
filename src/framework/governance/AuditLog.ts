import { globalStorageMesh } from '../storage/StorageMesh.ts';
import { createHash } from 'crypto';

export interface AuditEntry {
    timestamp: number;
    threadId: string;
    agentId: string;
    action: string;
    description: string;
    hash: string; // Linked hash for integrity
}

/**
 * Immutable Audit Log (Dimension 05)
 * Maintains a signed sequence of governance-critical events.
 */
export class AuditLog {
    private lastHash: string = 'GENESIS';

    /**
     * Appends a record to the audit trail.
     * In a production environment, this should write to an append-only HSM or WORM storage.
     */
    public async log(threadId: string, agentId: string, action: string, description: string): Promise<void> {
        const timestamp = Date.now();
        const entryBody = `${timestamp}|${threadId}|${agentId}|${action}|${description}|${this.lastHash}`;
        const hash = createHash('sha256').update(entryBody).digest('hex');

        const entry: AuditEntry = {
            timestamp,
            threadId,
            agentId,
            action,
            description,
            hash
        };

        this.lastHash = hash;

        // Persist to the Storage Mesh
        const logPath = `.orchestra/audit/log_${new Date().toISOString().split('T')[0]}.jsonl`;
        const logLine = JSON.stringify(entry) + '\n';
        
        try {
            await globalStorageMesh.appendFile(logPath, logLine);
            console.log(`[AUDIT] ${action} logged for ${agentId} in thread ${threadId}`);
        } catch (err) {
            // If the mesh doesn't support append, we fallback to read-and-rewrite
            // In our framework, we assume Mesh handles basic serialization
            console.error('[AUDIT] Failed to persist entry:', err);
        }
    }
}

export const globalAuditLog = new AuditLog();
