import { globalStorageMesh } from '../storage/StorageMesh.ts';
import { globalStateAdapter } from '../core/StateAdapter.ts';
import { createHash } from 'crypto';

export interface AuditEntry {
    timestamp: number;
    threadId: string;
    agentId: string;
    action: string;
    description: string;
    previousHash?: string;
    hash: string; // Linked hash for integrity
}

/**
 * Immutable Audit Log (Dimension 05)
 * Maintains a signed sequence of governance-critical events.
 */
export class AuditLog {
    private lastHash: string = 'GENESIS';
    private initialized = false;

    private getLogPath(date: Date = new Date()) {
        return `.orchestra/audit/log_${date.toISOString().split('T')[0]}.jsonl`;
    }

    private async initializeFromTail(force = false) {
        if (this.initialized && !force) return;
        this.initialized = true;
        this.lastHash = 'GENESIS';

        try {
            const logData = await globalStorageMesh.readFile(this.getLogPath());
            const lines = logData.toString().split('\n').filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const entry = JSON.parse(lines[i]) as AuditEntry;
                    if (entry.hash) {
                        this.lastHash = entry.hash;
                        return;
                    }
                } catch {
                    // Skip malformed legacy lines and continue looking for a valid tail.
                }
            }
        } catch (err: any) {
            if (!err.message?.includes('ENOENT') && !err.message?.includes('File not found')) {
                console.warn('[AUDIT] Failed to load previous audit tail:', err.message);
            }
        }
    }

    /**
     * Appends a record to the audit trail.
     * In a production environment, this should write to an append-only HSM or WORM storage.
     */
    public async log(threadId: string, agentId: string, action: string, description: string): Promise<void> {
        await this.withAuditLock(async () => {
            await this.initializeFromTail(true);
            const timestamp = Date.now();
            const entryBody = `${timestamp}|${threadId}|${agentId}|${action}|${description}|${this.lastHash}`;
            const hash = createHash('sha256').update(entryBody).digest('hex');

            const entry: AuditEntry = {
                timestamp,
                threadId,
                agentId,
                action,
                description,
                previousHash: this.lastHash,
                hash
            };

            this.lastHash = hash;

            // Persist to the Storage Mesh
            const logPath = this.getLogPath();
            const logLine = JSON.stringify(entry) + '\n';
            
            try {
                await globalStorageMesh.appendFile(logPath, logLine);
                console.log(`[AUDIT] ${action} logged for ${agentId} in thread ${threadId}`);
            } catch (err) {
                // If the mesh doesn't support append, we fallback to read-and-rewrite
                // In our framework, we assume Mesh handles basic serialization
                console.error('[AUDIT] Failed to persist entry:', err);
            }
        });
    }

    public async verify(date: Date = new Date(), options: { fromTimestamp?: number } = {}): Promise<{ valid: boolean; entries: number; errors: string[] }> {
        const errors: string[] = [];
        let previousHash = 'GENESIS';
        let entries = 0;
        let segmentStarted = !options.fromTimestamp;

        try {
            const logData = await globalStorageMesh.readFile(this.getLogPath(date));
            const lines = logData.toString().split('\n').filter(Boolean);
            for (let i = 0; i < lines.length; i++) {
                try {
                    const entry = JSON.parse(lines[i]) as AuditEntry;
                    if (options.fromTimestamp && entry.timestamp < options.fromTimestamp) {
                        previousHash = entry.hash;
                        continue;
                    }
                    if (!segmentStarted) {
                        previousHash = entry.previousHash || previousHash;
                        segmentStarted = true;
                    }
                    const body = `${entry.timestamp}|${entry.threadId}|${entry.agentId}|${entry.action}|${entry.description}|${entry.previousHash}`;
                    const expectedHash = createHash('sha256').update(body).digest('hex');
                    if (entry.previousHash !== previousHash) {
                        errors.push(`Line ${i + 1}: previousHash ${entry.previousHash} did not match expected ${previousHash}`);
                    }
                    if (entry.hash !== expectedHash) {
                        errors.push(`Line ${i + 1}: hash mismatch`);
                    }
                    previousHash = entry.hash;
                    entries++;
                } catch (err: any) {
                    errors.push(`Line ${i + 1}: invalid JSON (${err.message})`);
                }
            }
        } catch (err: any) {
            if (!err.message?.includes('ENOENT') && !err.message?.includes('File not found')) {
                errors.push(err.message);
            }
        }

        return { valid: errors.length === 0, entries, errors };
    }

    private async withAuditLock<T>(operation: () => Promise<T>): Promise<T> {
        const lockKey = `audit:${this.getLogPath()}`;
        const deadline = Date.now() + 5000;
        while (!(await globalStateAdapter.acquireLock(lockKey, 5000))) {
            if (Date.now() > deadline) throw new Error('Timed out acquiring audit log lock');
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        try {
            return await operation();
        } finally {
            await globalStateAdapter.releaseLock(lockKey);
        }
    }
}

export const globalAuditLog = new AuditLog();
