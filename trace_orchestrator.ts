import { globalCircuitBreaker } from './src/framework/resilience/CircuitBreaker.js';
import { ManagerAgent } from './src/framework/agents/ManagerAgent.js';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.js';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.js';
import { Orchestrator } from './src/framework/orchestration/Orchestrator.js';

import * as dotenv from 'dotenv';
dotenv.config();
console.log("GEMINI_API_KEY is defined:", !!process.env.GEMINI_API_KEY);

async function run() {
    try {
        const mem = new MemoryMesh();
        const llmConfig = { apiKey: process.env.DEEPSEEK_API_KEY!, modelName: "deepseek-chat" };
        const mgr = new ManagerAgent('Manager', 'You are manager', 'MANAGER', mem, llmConfig);
        const wkr = new WorkerAgent('Worker', 'You are worker', 'WORKER', mem, llmConfig);
        mgr.setSubordinates([wkr]);
        
        const orchestrator = new Orchestrator();
        const res = await orchestrator.executeWorkflow('Design a system', {
            paradigm: 'HIERARCHICAL',
            agents: [mgr, wkr],
            edges: [],
            blackboard: { startTime: Date.now().toString(), initialTask: 'Design a system' }
        }, 'test-123');
        console.log("RES:", res);
    } catch(e) {
        console.error("FAIL:", e);
    }
}
run();
