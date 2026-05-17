
import { BaseAgent } from './framework/agents/BaseAgent.ts';
import { globalMemoryMesh } from './framework/memory/MemoryMesh.ts';
import { LLMConfig } from './framework/llm/ProviderRegistry.ts';
import { tool } from 'ai';
import { z } from 'zod';

/**
 * A concrete implementation of an agent that leverages Autonomous Logic
 */
class LogicTestAgent extends BaseAgent {
    constructor() {
        const config: LLMConfig = {
            modelName: 'gemini-2.5-flash',
            temperature: 0.2
        };
        super(
            'Strategy Analyzer',
            'Expert in logistical planning and optimization.',
            'WORKER',
            globalMemoryMesh,
            config,
            ['logic'],
            'SYSTEM',
            10,
            1
        );

        // Host a dummy tool to see if the plan includes it correctly
        this.hostTool('optimize_logistics', {
            description: 'Calculates the optimal route for cargo.',
            parameters: z.object({
                origin: z.string(),
                destination: z.string(),
                priority: z.enum(['low', 'high'])
            }),
            execute: async (args) => {
                console.log(`[TOOL_LOG]: Optimizing route from ${args.origin} to ${args.destination}...`);
                return `Optimized Route FOUND: via Central Hub A (Estimated Time: 4h).`;
            }
        });
    }

    public async execute(task: string, threadId: string = 'GLOBAL'): Promise<any> {
        console.log(`\n🤖 [${this.card.name}] Starting Task: ${task}`);
        
        const systemPrompt = `You are a high-level coordination agent. Your goal is to solve the user's problem with maximum efficiency.`;
        const messages = [{ role: 'user', content: task }];

        // Trigger the NEW Reasoning Loop
        const result = await this.executeWithReasoning(systemPrompt, messages, threadId);

        console.log(`\n✨ FINAL RESPONSE:`);
        console.log("--------------------------------------------------");
        console.log(result.text);
        console.log("--------------------------------------------------");
        
        return result;
    }
}

async function runAutonomousSimulation() {
    console.log("🚀 Initializing Autonomous Logic Simulation...");
    const agent = new LogicTestAgent();

    const task = "I need to move 500 units of medical supplies from Berlin to Paris with critical priority. Analyze the best approach and execute the optimization.";
    
    await agent.execute(task);
}

runAutonomousSimulation().catch(console.error);
