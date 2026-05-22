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
    private static writeQueues: Map<string, Promise<void>> = new Map();
    private static tailHashes: Map<string, string> = new Map();
    private static initializedPaths: Set<string> = new Set();
    private lastHash: string = 'GENESIS';
    private readonly lockWaitMs = this.parsePositiveNumber(process.env.ORCHESTRA_AUDIT_LOCK_WAIT_MS, 30000);
    private readonly reloadTailEachWrite = process.env.ORCHESTRA_AUDIT_RELOAD_TAIL_EACH_WRITE === 'true' || process.env.NODE_ENV === 'production';

    private getLogPath(date: Date = new Date()) {
        return `.orchestra/audit/log_${date.toISOString().split('T')[0]}.jsonl`;
    }

    private async initializeFromTail(logPath: string = this.getLogPath(), force = false) {
        if (AuditLog.initializedPaths.has(logPath) && !force) {
            this.lastHash = AuditLog.tailHashes.get(logPath) || 'GENESIS';
            return;
        }
        AuditLog.initializedPaths.add(logPath);
        this.lastHash = 'GENESIS';

        try {
            const logData = await globalStorageMesh.readFile(logPath);
            const lines = logData.toString().split('\n').filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const entry = JSON.parse(lines[i]) as AuditEntry;
                    if (entry.hash) {
                        this.lastHash = entry.hash;
                        AuditLog.tailHashes.set(logPath, entry.hash);
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
        AuditLog.tailHashes.set(logPath, this.lastHash);
    }

    /**
     * Appends a record to the audit trail.
     * In a production environment, this should write to an append-only HSM or WORM storage.
     */
    public async log(threadId: string, agentId: string, action: string, description: string): Promise<void> {
        const logPath = this.getLogPath();
        await this.enqueueWrite(logPath, async () => this.withAuditLock(logPath, async () => {
            await this.initializeFromTail(logPath, this.reloadTailEachWrite);
            const timestamp = Date.now();
            const previousHash = AuditLog.tailHashes.get(logPath) || this.lastHash;
            const entryBody = `${timestamp}|${threadId}|${agentId}|${action}|${description}|${previousHash}`;
            const hash = createHash('sha256').update(entryBody).digest('hex');

            const entry: AuditEntry = {
                timestamp,
                threadId,
                agentId,
                action,
                description,
                previousHash,
                hash
            };

            // Persist to the Storage Mesh
            const logLine = JSON.stringify(entry) + '\n';
            
            try {
                await globalStorageMesh.appendFile(logPath, logLine, { idempotencyKey: hash });
                this.lastHash = hash;
                AuditLog.tailHashes.set(logPath, hash);
                console.log(`[AUDIT] ${action} logged for ${agentId} in thread ${threadId}`);
            } catch (err: any) {
                console.error('[AUDIT] Failed to persist entry:', err);
                throw err;
            }
        }));
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

    public async verifyChain(date: Date = new Date()): Promise<{ valid: boolean; entries: number; errors: string[] }> {
        return this.verify(date);
    }

    public async readEntries(
        date: Date = new Date(),
        options: { fromTimestamp?: number; threadId?: string } = {}
    ): Promise<AuditEntry[]> {
        try {
            const logData = await globalStorageMesh.readFile(this.getLogPath(date));
            return logData.toString()
                .split('\n')
                .filter(Boolean)
                .map(line => JSON.parse(line) as AuditEntry)
                .filter(entry => !options.fromTimestamp || entry.timestamp >= options.fromTimestamp)
                .filter(entry => !options.threadId || entry.threadId === options.threadId);
        } catch (err: any) {
            if (err.message?.includes('ENOENT') || err.message?.includes('File not found')) {
                return [];
            }
            throw err;
        }
    }

    private async withAuditLock<T>(logPath: string, operation: () => Promise<T>): Promise<T> {
        const lockKey = `audit:${logPath}`;
        const deadline = Date.now() + this.lockWaitMs;
        while (!(await globalStateAdapter.acquireLock(lockKey, 5000))) {
            if (Date.now() > deadline) throw new Error(`Timed out acquiring audit log lock after ${this.lockWaitMs}ms`);
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        try {
            return await operation();
        } finally {
            await globalStateAdapter.releaseLock(lockKey);
        }
    }

    private async enqueueWrite<T>(logPath: string, operation: () => Promise<T>): Promise<T> {
        const previous = AuditLog.writeQueues.get(logPath) || Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        AuditLog.writeQueues.set(logPath, previous.then(() => current, () => current));

        await previous.catch(() => undefined);
        try {
            return await operation();
        } finally {
            release();
            if (AuditLog.writeQueues.get(logPath) === current) {
                AuditLog.writeQueues.delete(logPath);
            }
        }
    }

    private parsePositiveNumber(value: string | undefined, fallback: number): number {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }
}

export const globalAuditLog = new AuditLog();
