import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { globalStateAdapter } from '../core/StateAdapter.ts';

export interface ProjectBoard {
    projects: any[];
}

export interface VersionedProjectBoard extends ProjectBoard {
    version: string;
}

const workspaceRoot = path.resolve(process.cwd(), 'workspace');
const projectsFile = path.join(workspaceRoot, 'projects.json');
const lockKey = 'project_board_projects_json';

function normalizeBoard(data: any): ProjectBoard {
    if (Array.isArray(data)) return { projects: data };
    if (data && Array.isArray(data.projects)) return { projects: data.projects };
    return { projects: [] };
}

function versionFor(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

async function withProjectBoardLock<T>(operation: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 5000;
    while (!(await globalStateAdapter.acquireLock(lockKey, 5000))) {
        if (Date.now() > deadline) {
            throw new Error('Timed out acquiring project board lock.');
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }

    try {
        return await operation();
    } finally {
        await globalStateAdapter.releaseLock(lockKey);
    }
}

export async function readProjectBoard(): Promise<VersionedProjectBoard> {
    if (!fs.existsSync(projectsFile)) {
        return { projects: [], version: versionFor(JSON.stringify({ projects: [] })) };
    }

    const content = fs.readFileSync(projectsFile, 'utf8');
    const parsed = content.trim() ? JSON.parse(content) : { projects: [] };
    return {
        ...normalizeBoard(parsed),
        version: versionFor(content)
    };
}

export async function writeProjectBoard(board: ProjectBoard): Promise<VersionedProjectBoard> {
    return withProjectBoardLock(async () => {
        const normalized = normalizeBoard(board);
        fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
        const payload = `${JSON.stringify(normalized, null, 2)}\n`;
        const tempPath = `${projectsFile}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tempPath, payload, 'utf8');
        fs.renameSync(tempPath, projectsFile);
        return {
            ...normalized,
            version: versionFor(payload)
        };
    });
}

export async function compareAndWriteProjectBoard(board: ProjectBoard, expectedVersion?: string): Promise<VersionedProjectBoard> {
    return withProjectBoardLock(async () => {
        const current = await readProjectBoard();
        if (expectedVersion && current.version !== expectedVersion) {
            const error = new Error('Project board was updated by another writer. Refresh and retry.');
            (error as any).code = 'VERSION_CONFLICT';
            (error as any).currentVersion = current.version;
            throw error;
        }

        const normalized = normalizeBoard(board);
        fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
        const payload = `${JSON.stringify(normalized, null, 2)}\n`;
        const tempPath = `${projectsFile}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tempPath, payload, 'utf8');
        fs.renameSync(tempPath, projectsFile);
        return {
            ...normalized,
            version: versionFor(payload)
        };
    });
}

export async function mutateProjectBoard(mutator: (board: ProjectBoard) => ProjectBoard | Promise<ProjectBoard>): Promise<VersionedProjectBoard> {
    return withProjectBoardLock(async () => {
        const current = await readProjectBoard();
        const next = await mutator({ projects: current.projects });
        const normalized = normalizeBoard(next);
        fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
        const payload = `${JSON.stringify(normalized, null, 2)}\n`;
        const tempPath = `${projectsFile}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tempPath, payload, 'utf8');
        fs.renameSync(tempPath, projectsFile);
        return {
            ...normalized,
            version: versionFor(payload)
        };
    });
}
