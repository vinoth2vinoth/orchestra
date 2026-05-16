import { BaseAgent } from './BaseAgent.ts';
import { z } from 'zod';

export class PlannerAgent extends BaseAgent {
    public async execute(task: any, threadId: string): Promise<any> {
        const taskStr = typeof task === 'string' ? task : JSON.stringify(task);

        const messages: any[] = [
            { role: 'user', content: taskStr }
        ];

        // The exact DAG schema
        const dagSchema = z.object({
            subtasks: z.array(z.object({
                id: z.string().describe("Unique identifier for the subtask"),
                description: z.string().describe("Detailed prompt or instructions for the subtask"),
                dependencies: z.array(z.string()).describe("List of subtask IDs that must complete before this one can start")
            })).describe("The DAG of subtasks")
        });

        const draftResponse = await this.generateStructuredResponse(
            this.card.description + '\nDecompose the objective into a Directed Acyclic Graph (DAG) of sub-tasks. Output JSON matching the schema.',
            messages,
            dagSchema,
            threadId
        );

        let finalDag = draftResponse.object;

        if (!finalDag || !Array.isArray(finalDag.subtasks)) {
             console.warn("Draft DAG invalid, using default emergency plan");
             finalDag = { subtasks: [{ id: '1', description: taskStr, dependencies: [] }] };
        }

        // Pass 2: Self-Critique and Refinement
        try {
            const critiqueMessages = [
                ...messages,
                { role: 'assistant', content: JSON.stringify(finalDag) },
                { role: 'user', content: "CRITICAL_PLAN_REVIEW: Analyze your DAG. Are any subtasks redundant? Are dependencies missing? Is the goal fully addressed? Re-generate an optimized, final DAG if necessary, or return the same if perfect." }
            ];

            const refinedResponse = await this.generateStructuredResponse(
                "You are an Expert Project Architect and DAG Auditor. Ensure the output strictly follows the subtasks schema.",
                critiqueMessages,
                dagSchema,
                threadId
            );
            
            if (refinedResponse.object && Array.isArray(refinedResponse.object.subtasks)) {
                finalDag = refinedResponse.object;
            }
        } catch (e) {
            console.warn("Planner reflection failed or returned invalid object, proceeding with draft DAG", e);
        }

        return finalDag;
    }
}
