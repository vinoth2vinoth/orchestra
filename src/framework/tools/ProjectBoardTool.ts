import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { globalToolRegistry } from './ToolRegistry.ts';
import { globalEventStore } from '../core/EventStore.ts';

const workspaceRoot = path.join(process.cwd(), 'workspace');
const PROJECTS_FILE = path.join(workspaceRoot, 'projects.json');

const readProjects = () => {
    if (!fs.existsSync(PROJECTS_FILE)) return { projects: [] };
    const content = fs.readFileSync(PROJECTS_FILE, 'utf8');
    return JSON.parse(content);
};

const writeProjects = (data: any) => {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), 'utf8');
};

/**
 * ProjectBoardTool
 * High-level semantic interface for agent-driven project management.
 * Avoids low-level file manipulations by providing domain-specific methods.
 */

globalToolRegistry.register(
    'getProjectBoard',
    'Get the current state of all projects and tasks on the board.',
    z.object({
        projectId: z.string().optional().describe('Filter by a specific project ID')
    }),
    async ({ projectId }) => {
        globalEventStore.append({
            type: 'TOOL_CALL_REQUESTED',
            sourceAgentId: 'SYSTEM',
            threadId: 'GLOBAL',
            payload: { tool: 'getProjectBoard', projectId }
        });
        
        const data = readProjects();
        if (projectId) {
            const project = data.projects.find((p: any) => p.id === projectId);
            return JSON.stringify(project || { error: 'Project not found' });
        }
        return JSON.stringify(data);
    }
);

globalToolRegistry.register(
    'updateTaskStatus',
    'Move a task to a different column or status.',
    z.object({
        projectId: z.string().describe('ID of the project'),
        taskId: z.string().describe('ID of the task to update'),
        newStatus: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'REVIEW', 'todo', 'in-progress', 'done']).describe('The new status for the task')
    }),
    async ({ projectId, taskId, newStatus }) => {
        globalEventStore.append({
            type: 'TOOL_CALL_REQUESTED',
            sourceAgentId: 'SYSTEM',
            threadId: 'GLOBAL',
            payload: { tool: 'updateTaskStatus', projectId, taskId, newStatus }
        });

        // Normalize status
        let normalizedStatus = newStatus.toUpperCase().replace('-', '_');
        if (normalizedStatus === 'IN_PROGRESS') normalizedStatus = 'IN_PROGRESS'; // Already correct
        
        const data = readProjects();
        const project = data.projects.find((p: any) => p.id === projectId);
        if (!project) return `[Project Error]: Project ${projectId} not found.`;

        const task = project.tasks.find((t: any) => t.id === taskId);
        if (!task) return `[Project Error]: Task ${taskId} not found in project ${projectId}.`;

        const oldStatus = task.status;
        task.status = normalizedStatus;
        writeProjects(data);

        // Emit a system-level telemetry log so the UI highlights this change
        globalEventStore.append({
            type: 'TELEMETRY_EMIT',
            sourceAgentId: 'PROJECT_SERVICE',
            threadId: 'GLOBAL',
            payload: { 
                action: 'TASK_STATUS_CHANGED',
                projectId,
                taskId,
                oldStatus,
                newStatus,
                text: `[SYSTEM] Task "${task.title}" moved from ${oldStatus} to ${newStatus}.`
            }
        });

        return `✅ Task "${task.title}" successfully moved to ${newStatus}.`;
    }
);

globalToolRegistry.register(
    'createProjectTask',
    'Create a new task within a project.',
    z.object({
        projectId: z.string().describe('ID of the project'),
        title: z.string().describe('Title of the new task'),
        description: z.string().optional().describe('Detailed task description'),
        assignee: z.string().optional().describe('Name of the agent or human assigned'),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional()
    }),
    async ({ projectId, title, description, assignee, priority = 'medium' }) => {
        globalEventStore.append({
            type: 'TOOL_CALL_REQUESTED',
            sourceAgentId: 'SYSTEM',
            threadId: 'GLOBAL',
            payload: { tool: 'createProjectTask', projectId, title }
        });

        const data = readProjects();
        const project = data.projects.find((p: any) => p.id === projectId);
        if (!project) return `[Project Error]: Project ${projectId} not found.`;

        const newTask = {
            id: `t${Date.now()}`,
            title,
            description,
            status: 'TODO',
            assignee,
            priority: priority.toUpperCase(),
            createdAt: new Date().toISOString()
        };

        project.tasks.push(newTask);
        writeProjects(data);

        globalEventStore.append({
            type: 'TELEMETRY_EMIT',
            sourceAgentId: 'PROJECT_SERVICE',
            threadId: 'GLOBAL',
            payload: { 
                action: 'TASK_CREATED',
                projectId,
                task: newTask,
                text: `[SYSTEM] New task created: "${title}" assigned to ${assignee || 'Unassigned'}.`
            }
        });

        return `✅ Task "${title}" created (ID: ${newTask.id}).`;
    }
);
