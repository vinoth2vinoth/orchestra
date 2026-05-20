import { globalEventStore } from '../core/EventStore.ts';
import { Orchestrator, WorkflowConfig } from './Orchestrator.ts';
import { WorkerAgent } from '../agents/WorkerAgent.ts';
import { MemoryMesh } from '../memory/MemoryMesh.ts';
import { globalRegistry } from '../agents/AgentRegistry.ts';
import { mutateProjectBoard } from '../tools/ProjectBoardStore.ts';
import * as crypto from 'crypto';

interface DaemonLease {
    runId: string;
    startedAt: number;
    lastHeartbeatAt: number;
    expiresAt: number;
}

interface AutonomousDaemonOptions {
    staleTaskMs?: number;
    maxTaskRuntimeMs?: number;
    heartbeatIntervalMs?: number;
    maxAttempts?: number;
    now?: () => number;
}

interface ActiveDaemonTask {
    runId: string;
    timeout: NodeJS.Timeout;
    heartbeat: NodeJS.Timeout;
}

export class AutonomousDaemon {
    private isRunning = false;
    private pollIntervalMs: number;
    private timer: NodeJS.Timeout | null = null;
    private memory = new MemoryMesh();
    private activeTasks = new Map<string, ActiveDaemonTask>();
    private readonly staleTaskMs: number;
    private readonly maxTaskRuntimeMs: number;
    private readonly heartbeatIntervalMs: number;
    private readonly maxAttempts: number;
    private readonly now: () => number;

    constructor(pollIntervalMs = 15000, options: AutonomousDaemonOptions = {}) {
        this.pollIntervalMs = pollIntervalMs;
        this.staleTaskMs = options.staleTaskMs ?? this.parsePositiveNumber(process.env.ORCHESTRA_DAEMON_STALE_TASK_MS, 10 * 60 * 1000);
        this.maxTaskRuntimeMs = options.maxTaskRuntimeMs ?? this.parsePositiveNumber(process.env.ORCHESTRA_DAEMON_MAX_TASK_RUNTIME_MS, this.staleTaskMs);
        this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? this.parsePositiveNumber(process.env.ORCHESTRA_DAEMON_HEARTBEAT_INTERVAL_MS, Math.max(1000, Math.floor(this.staleTaskMs / 3)));
        this.maxAttempts = options.maxAttempts ?? this.parsePositiveNumber(process.env.ORCHESTRA_DAEMON_MAX_ATTEMPTS, 3);
        this.now = options.now || Date.now;
    }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        console.log(`[AutonomousDaemon] Starting background monitoring loop (${this.pollIntervalMs}ms)`);
        this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
        
        // Execute first tick immediately
        this.tick();
    }

    public stop() {
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        for (const key of this.activeTasks.keys()) {
            this.clearActiveTask(key);
        }
        console.log(`[AutonomousDaemon] Stopped background monitoring`);
    }

    public async runOnce() {
        await this.processProjectsQueue();
    }

    private async tick() {
        try {
            await this.processProjectsQueue();
        } catch (err: any) {
            console.error('[AutonomousDaemon] Tick failed:', err);
        }
    }

    private async processProjectsQueue() {
        const tasksToStart: Array<{ project: any; task: any; lease: DaemonLease }> = [];
        const now = this.now();

        await mutateProjectBoard((root) => {
            const projects = root.projects || [];

            for (const project of projects) {
                for (const task of project.tasks || []) {
                    if (!this.isDaemonTask(task)) continue;

                    const key = this.taskKey(project.id, task.id);
                    const lease = task.daemonLease as DaemonLease | undefined;
                    const expiredRunId = lease?.runId || 'legacy-unleased-run';
                    const hasExpiredLease = lease && lease.expiresAt <= now;
                    const isLegacyUnleasedTask = task.status === 'IN_PROGRESS' && !lease;
                    if (task.status === 'IN_PROGRESS' && (hasExpiredLease || isLegacyUnleasedTask) && !this.activeTasks.has(key)) {
                        task.daemonAttempts = Number(task.daemonAttempts || 0);
                        if (task.daemonAttempts >= this.maxAttempts) {
                            task.status = 'BLOCKED';
                            task.description = this.appendDaemonNote(task.description, `Previous background run ${expiredRunId} expired. Max retry count reached.`);
                            delete task.daemonLease;
                            globalEventStore.append({
                                type: 'SYSTEM_HOOK',
                                sourceAgentId: 'AUTONOMOUS_DAEMON',
                                threadId: 'SYSTEM',
                                payload: { action: 'BACKGROUND_TASK_BLOCKED', projectId: project.id, taskId: task.id, runId: expiredRunId }
                            });
                            continue;
                        }

                        task.status = 'TODO';
                        task.description = this.appendDaemonNote(task.description, `Previous background run ${expiredRunId} expired and was returned to TODO for retry.`);
                        delete task.daemonLease;
                        globalEventStore.append({
                            type: 'SYSTEM_HOOK',
                            sourceAgentId: 'AUTONOMOUS_DAEMON',
                            threadId: 'SYSTEM',
                            payload: { action: 'BACKGROUND_TASK_REQUEUED', projectId: project.id, taskId: task.id, expiredRunId }
                        });
                    }

                    if (task.status === 'TODO' && !this.activeTasks.has(key)) {
                        const nextLease = this.createLease();
                        task.status = 'IN_PROGRESS';
                        task.daemonAttempts = Number(task.daemonAttempts || 0) + 1;
                        task.daemonLease = nextLease;
                        tasksToStart.push({
                            project: this.clone(project),
                            task: this.clone(task),
                            lease: nextLease
                        });
                    }
                }
            }

            return root;
        });

        for (const { project, task, lease } of tasksToStart) {
            this.launchBackgroundTask(project, task, lease);
        }
    }

    protected async executeSwarmTask(project: any, task: any) {
        const orchestrator = new Orchestrator();
        const threadId = crypto.randomUUID();

        // Dynamically instantiate a temporary local agent for this exact daemon process
        const worker1 = new WorkerAgent(
            'DaemonWorker-Alfa',
            'You are an autonomous background worker. Analyze the project task and perform actions using your file system tools.',
            'WORKER',
            this.memory,
            { modelName: 'gemini-2.5-flash', apiKey: process.env.GEMINI_API_KEY || '' },
            ['fileSystemRead', 'fileSystemWrite']
        );
        
        globalRegistry.register(worker1);

        const config: WorkflowConfig = {
            paradigm: 'SWARM',
            agents: [worker1],
            useDistributedQueue: false
        };

        const prompt = `Autonomous Background Task detected.\nProject: ${project.name}\nTask: ${task.title}\nDescription: ${task.description || 'None'}\n\nPlease take action. Update any files necessary to complete this task. Respond with a summary of what you did.`;

        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'AUTONOMOUS_DAEMON',
            threadId,
            payload: { action: 'BACKGROUND_TASK_STARTED', taskId: task.id, title: task.title }
        });

        try {
            return await orchestrator.executeWorkflow(prompt, config, threadId);
        } finally {
            globalRegistry.unregister(worker1.card.id);
        }
    }

    protected async finalizeTask(projectId: string, taskId: string, runId: string, daemonConclusion: any, isError = false) {
        let finalized = false;
        let ignoredAsStale = false;

        await mutateProjectBoard((root) => {
            const conclusionStr = typeof daemonConclusion === 'string' ? daemonConclusion : JSON.stringify(daemonConclusion);

            for (const project of root.projects || []) {
                if (project.id === projectId) {
                    for (const t of project.tasks || []) {
                        if (t.id === taskId) {
                            if (t.daemonLease?.runId !== runId) {
                                ignoredAsStale = true;
                                globalEventStore.append({
                                    type: 'SYSTEM_HOOK',
                                    sourceAgentId: 'AUTONOMOUS_DAEMON',
                                    threadId: 'SYSTEM',
                                    payload: { action: 'BACKGROUND_TASK_STALE_FINALIZE_IGNORED', projectId, taskId, runId }
                                });
                                return root;
                            }

                            const attempts = Number(t.daemonAttempts || 0);
                            t.status = isError ? (attempts >= this.maxAttempts ? 'BLOCKED' : 'TODO') : 'DONE';
                            delete t.daemonLease;
                            t.description = this.appendDaemonNote(t.description, `${isError ? 'Failed' : 'Completed'} run ${runId}:\n${conclusionStr.substring(0, 500)}`);
                            finalized = true;
                        }
                    }
                }
            }

            return root;
        });

        if (finalized) {
            console.log(`[AutonomousDaemon] Finalized task ${taskId}`);
        } else if (ignoredAsStale) {
            console.log(`[AutonomousDaemon] Ignored stale finalize for task ${taskId}`);
        }
    }

    private launchBackgroundTask(project: any, task: any, lease: DaemonLease) {
        const key = this.taskKey(project.id, task.id);
        console.log(`[AutonomousDaemon] Picking up background task: ${task.title}`);

        const timeout = setTimeout(() => {
            this.timeoutActiveTask(project.id, task.id, lease.runId).catch(err => {
                console.error(`[AutonomousDaemon] Failed to timeout task ${task.id}:`, err);
            });
        }, this.maxTaskRuntimeMs);

        const heartbeat = setInterval(() => {
            this.heartbeatTask(project.id, task.id, lease.runId).catch(err => {
                console.error(`[AutonomousDaemon] Failed to heartbeat task ${task.id}:`, err);
            });
        }, this.heartbeatIntervalMs);

        if (timeout.unref) timeout.unref();
        if (heartbeat.unref) heartbeat.unref();
        this.activeTasks.set(key, { runId: lease.runId, timeout, heartbeat });

        this.executeSwarmTask(project, task).then(async (result) => {
            this.clearActiveTask(key, lease.runId);
            await this.finalizeTask(project.id, task.id, lease.runId, result);
        }).catch(async (err) => {
            this.clearActiveTask(key, lease.runId);
            console.error(`[AutonomousDaemon] Background execution failed for ${task.id}:`, err);
            await this.finalizeTask(project.id, task.id, lease.runId, `Failed: ${err.message}`, true);
        }).finally(() => {
            this.clearActiveTask(key, lease.runId);
        });
    }

    private async heartbeatTask(projectId: string, taskId: string, runId: string) {
        await mutateProjectBoard((root) => {
            const now = this.now();
            for (const project of root.projects || []) {
                if (project.id !== projectId) continue;
                for (const task of project.tasks || []) {
                    if (task.id !== taskId || task.daemonLease?.runId !== runId) continue;
                    task.daemonLease.lastHeartbeatAt = now;
                    task.daemonLease.expiresAt = now + this.staleTaskMs;
                    globalEventStore.append({
                        type: 'SYSTEM_HOOK',
                        sourceAgentId: 'AUTONOMOUS_DAEMON',
                        threadId: 'SYSTEM',
                        payload: { action: 'BACKGROUND_TASK_HEARTBEAT', projectId, taskId, runId }
                    });
                }
            }
            return root;
        });
    }

    private async timeoutActiveTask(projectId: string, taskId: string, runId: string) {
        const key = this.taskKey(projectId, taskId);
        const active = this.activeTasks.get(key);
        if (!active || active.runId !== runId) return;

        this.clearActiveTask(key, runId);
        console.warn(`[AutonomousDaemon] Background task ${taskId} timed out after ${this.maxTaskRuntimeMs}ms`);
        await this.finalizeTask(projectId, taskId, runId, `Timed out after ${this.maxTaskRuntimeMs}ms`, true);
        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'AUTONOMOUS_DAEMON',
            threadId: 'SYSTEM',
            payload: { action: 'BACKGROUND_TASK_TIMED_OUT', projectId, taskId, runId, maxTaskRuntimeMs: this.maxTaskRuntimeMs }
        });
    }

    private clearActiveTask(key: string, runId?: string) {
        const active = this.activeTasks.get(key);
        if (!active || (runId && active.runId !== runId)) return;
        clearTimeout(active.timeout);
        clearInterval(active.heartbeat);
        this.activeTasks.delete(key);
    }

    private isDaemonTask(task: any): boolean {
        return task.status !== 'DONE' &&
            task.status !== 'BLOCKED' &&
            task.assignee &&
            (task.assignee.toLowerCase().includes('swarm') || task.assignee.toLowerCase().includes('bot') || task.assignee.toLowerCase().includes('ai'));
    }

    private createLease(): DaemonLease {
        const startedAt = this.now();
        return {
            runId: crypto.randomUUID(),
            startedAt,
            lastHeartbeatAt: startedAt,
            expiresAt: startedAt + this.staleTaskMs
        };
    }

    private taskKey(projectId: string, taskId: string): string {
        return `${projectId}:${taskId}`;
    }

    private clone<T>(value: T): T {
        return JSON.parse(JSON.stringify(value));
    }

    private appendDaemonNote(description: string | undefined, note: string): string {
        return `${description ? `${description}\n\n` : ''}[Bot Output]:\n${note}`;
    }

    private parsePositiveNumber(value: string | undefined, fallback: number): number {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }
}
