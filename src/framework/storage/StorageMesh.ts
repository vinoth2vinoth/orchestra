import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';

export interface FileSnapshot {
    versionId: string;
    hash: string;
    content: Buffer | string;
    timestamp: number;
    isProtected: boolean;
}

export interface StorageOptions {
    autoBackup?: boolean;
    storageStrategy?: 'LOCAL' | 'S3_MOCK' | 'MEMORY';
    ignorePatterns?: RegExp[];
}

export interface AppendFileOptions {
    idempotencyKey?: string;
}

/**
 * StorageMesh acts as a Virtual File System (VFS) for the framework.
 * It provides 100% availability through redundant backups, integrity checks, and self-healing.
 */
export class StorageMesh {
    private baseDir: string;
    private fileManifest: Map<string, FileSnapshot> = new Map();
    private strategy: 'LOCAL' | 'S3_MOCK' | 'MEMORY';
    private watchers: Map<string, fs.FSWatcher> = new Map();
    private activeWrites: Set<string> = new Set();
    private activeWriteCounts: Map<string, number> = new Map();
    private activeWriteCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
    private inFlightWrites: Set<Promise<void>> = new Set();
    private activeHeals: Map<string, number> = new Map(); // relativePath -> attempt count
    private healBackoffTimers: Map<string, NodeJS.Timeout> = new Map();
    private ignorePatterns: RegExp[];

    constructor(baseDir: string = './orchestra_workspace', options: StorageOptions = {}) {
        this.baseDir = path.resolve(baseDir);
        this.strategy = options.storageStrategy || 'LOCAL';
        this.ignorePatterns = options.ignorePatterns || [
            /node_modules/,
            /\.git/,
            /\.DS_Store/,
            /dist/,
            /build/,
            /\.temp$/,
            /\.log$/
        ];

        // Ensure base directory exists if using local storage
        if (this.strategy === 'LOCAL' && !fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    /**
     * Helper to generate SHA-256 hash
     */
    private generateHash(content: string | Buffer): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Resolves safe path to prevent directory traversal
     */
    private getSafePath(relativePath: string): string {
        const safePath = path.resolve(this.baseDir, relativePath);
        const relativeToBase = path.relative(this.baseDir, safePath);
        if (relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
            throw new Error(`Path traversal detected: ${relativePath}`);
        }
        return safePath;
    }

    private isIgnored(filePath: string): boolean {
        return this.ignorePatterns.some(pattern => pattern.test(filePath));
    }

    /**
     * Initializes protection for a specific directory (like src/framework or user project).
     * Creates snapshots for all existing files and starts watching for unauthorized tampering.
     */
    public async protectDirectory(dirPath: string) {
        const safeDirPath = this.getSafePath(dirPath);
        if (!fs.existsSync(safeDirPath)) return;

        await this.indexDirectory(safeDirPath);
        this.watchDirectory(safeDirPath);
        console.log(`[StorageMesh] Directory protected: ${dirPath}`);
    }

    private async indexDirectory(dirPath: string) {
        if (this.isIgnored(dirPath)) return;
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (this.isIgnored(fullPath)) continue;

            if (entry.isDirectory()) {
                await this.indexDirectory(fullPath);
            } else {
                const relativePath = path.relative(this.baseDir, fullPath);
                const content = await fs.promises.readFile(fullPath);
                this.fileManifest.set(relativePath, {
                    versionId: crypto.randomUUID(),
                    hash: this.generateHash(content),
                    content,
                    timestamp: Date.now(),
                    isProtected: true
                });
            }
        }
    }

    private queueHeal(relativePath: string, safePath: string, snapshot: FileSnapshot) {
        if (this.healBackoffTimers.has(relativePath)) return; // Already queued
        
        const count = this.activeHeals.get(relativePath) || 0;
        if (count >= 5) {
            console.error(`[StorageMesh] CRITICAL: Maximum heal attempts reached for ${relativePath}. Possible OS lock conflict or malicious persistence.`);
            return;
        }

        const backoffMs = Math.min(1000 * Math.pow(2, count), 30000); // Exponential backoff up to 30s
        
        this.activeHeals.set(relativePath, count + 1);
        
        const timer = setTimeout(async () => {
            this.healBackoffTimers.delete(relativePath);
            try {
                console.warn(`[StorageMesh] Tampering detected on ${relativePath}. Initiating self-healing (Attempt ${count + 1})...`);
                await this.healFile(relativePath, safePath, snapshot);
                // Reset count on success after a short period of stability
                setTimeout(() => this.activeHeals.delete(relativePath), 10000);
            } catch (err: any) {
                if (err.code === 'EBUSY' || err.code === 'EPERM') {
                    console.error(`[StorageMesh] File locked or permission denied during healing of ${relativePath}: ${err.message}`);
                } else {
                    console.error(`[StorageMesh] Healing failed for ${relativePath}: ${err.message}`);
                }
            }
        }, backoffMs);
        
        this.healBackoffTimers.set(relativePath, timer);
    }

    private watchDirectory(dirPath: string) {
        if (this.watchers.has(dirPath)) return;

        const watcher = fs.watch(dirPath, { recursive: true }, async (eventType, filename) => {
            if (!filename) return;
            
            const fullPath = path.join(dirPath, filename);
            if (this.isIgnored(fullPath)) return;

            const relativePath = path.relative(this.baseDir, fullPath);
            if (this.activeWrites.has(relativePath)) return;
            
            const snapshot = this.fileManifest.get(relativePath);
            if (snapshot && snapshot.isProtected) {
                // Check if file is gone or has wrong hash
                let needsHealing = false;
                if (!fs.existsSync(fullPath)) {
                    needsHealing = true;
                } else {
                    try {
                        const content = await fs.promises.readFile(fullPath);
                        if (this.generateHash(content) !== snapshot.hash) {
                            needsHealing = true;
                        }
                    } catch (e: any) {
                         // File might be locked or deleted during read
                         if (e.code === 'EBUSY' || e.code === 'EPERM') {
                             // Wait for lock to release
                             needsHealing = true;
                         } else {
                             needsHealing = true;
                         }
                    }
                }

                if (needsHealing) {
                    this.queueHeal(relativePath, fullPath, snapshot);
                }
            }
        });

        this.watchers.set(dirPath, watcher);
    }

    public dispose(): void {
        this.closeWatchersAndHealTimers();
        if (this.inFlightWrites.size === 0) {
            this.clearActiveWriteGuards();
        }
    }

    public async disposeAsync(): Promise<void> {
        this.closeWatchersAndHealTimers();
        if (this.inFlightWrites.size > 0) {
            await Promise.allSettled(Array.from(this.inFlightWrites));
        }
        this.clearActiveWriteGuards();
    }

    private closeWatchersAndHealTimers(): void {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();

        for (const timer of this.healBackoffTimers.values()) {
            clearTimeout(timer);
        }
        this.healBackoffTimers.clear();
        this.activeHeals.clear();
    }

    private clearActiveWriteGuards(): void {
        for (const timer of this.activeWriteCleanupTimers.values()) {
            clearTimeout(timer);
        }
        this.activeWriteCleanupTimers.clear();
        this.activeWriteCounts.clear();
        this.activeWrites.clear();
    }

    private beginActiveWrite(relativePath: string): void {
        const pendingTimer = this.activeWriteCleanupTimers.get(relativePath);
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            this.activeWriteCleanupTimers.delete(relativePath);
        }

        this.activeWrites.add(relativePath);
        this.activeWriteCounts.set(relativePath, (this.activeWriteCounts.get(relativePath) || 0) + 1);
    }

    private finishActiveWrite(relativePath: string): void {
        const remaining = Math.max(0, (this.activeWriteCounts.get(relativePath) || 1) - 1);
        if (remaining > 0) {
            this.activeWriteCounts.set(relativePath, remaining);
            return;
        }

        this.activeWriteCounts.delete(relativePath);
        const timer = setTimeout(() => {
            if (!this.activeWriteCounts.has(relativePath)) {
                this.activeWrites.delete(relativePath);
            }
            this.activeWriteCleanupTimers.delete(relativePath);
        }, 1000);
        this.activeWriteCleanupTimers.set(relativePath, timer);
    }

    private async trackWrite(relativePath: string, operation: () => Promise<void>): Promise<void> {
        this.beginActiveWrite(relativePath);

        const writePromise = (async () => {
            try {
                await operation();
            } finally {
                this.finishActiveWrite(relativePath);
            }
        })();

        this.inFlightWrites.add(writePromise);
        try {
            await writePromise;
        } finally {
            this.inFlightWrites.delete(writePromise);
        }
    }

    /**
     * Authorized write: Write file and create a backup snapshot for self-healing.
     * Updates the golden master so file watcher doesn't consider it tampering.
     */
    public async writeFile(relativePath: string, content: string | Buffer): Promise<void> {
        await this.trackWrite(relativePath, async () => {
            const safePath = this.getSafePath(relativePath);
            const hash = this.generateHash(content);

            // 1. Snapshot / Backup Commit (Remote Replica or Memory)
            const existing = this.fileManifest.get(relativePath);
            
            this.fileManifest.set(relativePath, {
                versionId: crypto.randomUUID(),
                hash,
                content,
                timestamp: Date.now(),
                isProtected: existing ? existing.isProtected : true
            });

            // 2. Write to Primary Storage
            if (this.strategy === 'LOCAL') {
                const dir = path.dirname(safePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                await fs.promises.writeFile(safePath, content);
            }
        });
    }

    /**
     * Reads file with automatic Integrity Checks and Self-Healing.
     */
    public async readFile(relativePath: string): Promise<string | Buffer> {
        const safePath = this.getSafePath(relativePath);
        const manifestEntry = this.fileManifest.get(relativePath);

        if (this.strategy === 'LOCAL') {
            try {
                if (!fs.existsSync(safePath)) {
                    throw new Error(`ENOENT: no such file or directory`);
                }

                const content = await fs.promises.readFile(safePath);
                const currentHash = this.generateHash(content);

                // Integrity Check
                if (manifestEntry && currentHash !== manifestEntry.hash) {
                    console.warn(`[StorageMesh] Integrity failure detected on ${relativePath}. Corrupted data.`);
                    return await this.healFile(relativePath, safePath, manifestEntry);
                }

                return content;
            } catch (err: any) {
                // If file is deleted manually or missing, Self-Heal
                if (err.message.includes('ENOENT') && manifestEntry) {
                    console.warn(`[StorageMesh] Missing file detected: ${relativePath}. Initiating self-healing...`);
                    return await this.healFile(relativePath, safePath, manifestEntry);
                }
                throw err;
            }
        }

        // If Memory/Mock strategy, return from manifest
        if (manifestEntry) return manifestEntry.content;
        throw new Error(`File not found: ${relativePath}`);
    }

    public async deleteFile(relativePath: string): Promise<void> {
        await this.trackWrite(relativePath, async () => {
            const safePath = this.getSafePath(relativePath);
            this.fileManifest.delete(relativePath);
            if (this.strategy === 'LOCAL' && fs.existsSync(safePath)) {
                await fs.promises.rm(safePath, { force: true });
            }
        });
    }

    /**
     * Self-heals a missing or corrupted file from the resilient backup.
     */
    private async healFile(relativePath: string, safePath: string, snapshot: FileSnapshot): Promise<string | Buffer> {
        console.log(`[StorageMesh] Restoring ${relativePath} from snapshot ${snapshot.versionId}`);
        if (this.strategy === 'LOCAL') {
            const dir = path.dirname(safePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            await fs.promises.writeFile(safePath, snapshot.content);
        }
        return snapshot.content;
    }

    /**
     * Force checks the integrity of the entire workspace.
     */
    public async runIntegrityCheck(): Promise<{ healed: string[], missing: string[], corrupted: string[] }> {
        const results = { healed: [] as string[], missing: [] as string[], corrupted: [] as string[] };
        
        for (const [relPath, snapshot] of this.fileManifest.entries()) {
            const safePath = this.getSafePath(relPath);
            if (this.strategy === 'LOCAL') {
                if (!fs.existsSync(safePath)) {
                    results.missing.push(relPath);
                    await this.healFile(relPath, safePath, snapshot);
                    results.healed.push(relPath);
                    continue;
                }
                const content = await fs.promises.readFile(safePath);
                if (this.generateHash(content) !== snapshot.hash) {
                    results.corrupted.push(relPath);
                    await this.healFile(relPath, safePath, snapshot);
                    results.healed.push(relPath);
                }
            }
        }
        return results;
    }

    /**
     * Appends content to a file.
     */
    public async appendFile(relativePath: string, content: string | Buffer, options: AppendFileOptions = {}): Promise<void> {
        await this.trackWrite(relativePath, async () => {
            const safePath = this.getSafePath(relativePath);
            
            // 1. Read existing or use empty
            let existingContent: Buffer | string = '';
            const manifestEntry = this.fileManifest.get(relativePath);
            if (manifestEntry) {
                existingContent = manifestEntry.content;
            } else if (this.strategy === 'LOCAL' && fs.existsSync(safePath)) {
                existingContent = await fs.promises.readFile(safePath);
            }

            const existingBuffer = typeof existingContent === 'string' ? Buffer.from(existingContent) : existingContent;
            const appendBuffer = typeof content === 'string' ? Buffer.from(content) : content;

            if (options.idempotencyKey && existingBuffer.includes(appendBuffer)) {
                this.fileManifest.set(relativePath, {
                    versionId: crypto.randomUUID(),
                    hash: this.generateHash(existingBuffer),
                    content: existingBuffer,
                    timestamp: Date.now(),
                    isProtected: manifestEntry ? manifestEntry.isProtected : true
                });
                return;
            }

            // 2. Combine
            const newContent = Buffer.concat([
                existingBuffer,
                appendBuffer
            ]);

            // 3. Authorized append. Avoid rewriting large append-only logs on every entry.
            this.fileManifest.set(relativePath, {
                versionId: crypto.randomUUID(),
                hash: this.generateHash(newContent),
                content: newContent,
                timestamp: Date.now(),
                isProtected: manifestEntry ? manifestEntry.isProtected : true
            });

            if (this.strategy === 'LOCAL') {
                const dir = path.dirname(safePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                await fs.promises.appendFile(safePath, content);
            }
        });
    }
}

export const globalStorageMesh = new StorageMesh('./orchestra_workspace');

// Protect framework source code immediately on startup
setTimeout(() => {
    // const frameworkProtector = new StorageMesh(path.resolve('./src/framework'));
    // frameworkProtector.protectDirectory('.').catch(console.error);
}, 100);
