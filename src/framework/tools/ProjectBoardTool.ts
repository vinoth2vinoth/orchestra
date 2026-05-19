import { z } from 'zod';
import { globalToolRegistry } from './ToolRegistry.ts';
import { globalEventStore } from '../core/EventStore.ts';
import { mutateProjectBoard, readProjectBoard } from './ProjectBoardStore.ts';

/**
 * ProjectBoardTool
 * High-level semantic interface for agent-driven project management.
 * Uses locked mutations so concurrent UI and agent updates do not overwrite each other.
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

        const data = await readProjectBoard();
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

        const normalizedStatus = newStatus.toUpperCase().replace('-', '_');
        let changedTask: any = null;
        let oldStatus = '';

        await mutateProjectBoard((data) => {
            const project = data.projects.find((p: any) => p.id === projectId);
            if (!project) throw new Error(`[Project Error]: Project ${projectId} not found.`);

            const task = project.tasks.find((t: any) => t.id === taskId);
            if (!task) throw new Error(`[Project Error]: Task ${taskId} not found in project ${projectId}.`);

            oldStatus = task.status;
            task.status = normalizedStatus;
            changedTask = task;
            return data;
        });

        globalEventStore.append({
            type: 'TELEMETRY_EMIT',
            sourceAgentId: 'PROJECT_SERVICE',
            threadId: 'GLOBAL',
            payload: {
                action: 'TASK_STATUS_CHANGED',
                projectId,
                taskId,
                oldStatus,
                newStatus: normalizedStatus,
                text: `[SYSTEM] Task "${changedTask.title}" moved from ${oldStatus} to ${normalizedStatus}.`
            }
        });

        return `Task "${changedTask.title}" successfully moved to ${normalizedStatus}.`;
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

        let newTask: any = null;
        await mutateProjectBoard((data) => {
            const project = data.projects.find((p: any) => p.id === projectId);
            if (!project) throw new Error(`[Project Error]: Project ${projectId} not found.`);

            newTask = {
                id: `t${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                title,
                description,
                status: 'TODO',
                assignee,
                priority: priority.toUpperCase(),
                createdAt: new Date().toISOString()
            };

            project.tasks.push(newTask);
            return data;
        });

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

        return `Task "${title}" created (ID: ${newTask.id}).`;
    }
);
