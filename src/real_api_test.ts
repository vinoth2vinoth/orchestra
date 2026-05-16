
import { Orchestrator } from './framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './framework/agents/WorkerAgent.ts';
import { ManagerAgent } from './framework/agents/ManagerAgent.ts';
import { PlannerAgent } from './framework/agents/PlannerAgent.ts';
import { CriticAgent } from './framework/agents/CriticAgent.ts';
import { MemoryMesh } from './framework/memory/MemoryMesh.ts';
import { globalRegistry } from './framework/agents/AgentRegistry.ts';
import { ProviderRegistry } from './framework/llm/ProviderRegistry.ts';

async function runRealApiValidation() {
    console.log("=== RUNNING REAL API VALIDATION (GEMINI) ===");
    
    // Ensure we are using the real provider
    const config = { 
        provider: 'google', 
        apiKey: process.env.GEMINI_API_KEY,
        modelName: 'gemini-flash-latest'
    } as any;

    if (!config.apiKey) {
        console.error("❌ Error: GEMINI_API_KEY not found in environment.");
        process.exit(1);
    }

    const testPersonas = [
        {
            role: "CTO of a Sustainable Energy Startup",
            requirement: "Draft a high-level technical architecture for a decentralized power grid management system using blockchain.",
            paradigm: 'HIERARCHICAL' as const
        }
    ];

    const orchestrator = new Orchestrator();
    const memory = new MemoryMesh();

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (const p of testPersonas) {
        console.log(`\n--- Testing Persona: ${p.role} ---`);
        console.log(`Requirement: ${p.requirement}`);
        console.log(`Paradigm: ${p.paradigm}`);

        globalRegistry.clear();
        const manager = new ManagerAgent("Manager", p.role, "MANAGER", memory, config, ['ALL']);
        const worker = new WorkerAgent("Worker", "Expert Specialist", "WORKER", memory, config);
        const planner = new PlannerAgent("Planner", "Structural Architect", "PLANNER", memory, config);
        const critic = new CriticAgent("Critic", "Quality Gatekeeper", "CRITIC", memory, config);

        [manager, worker, planner, critic].forEach(a => globalRegistry.register(a));
        manager.setSubordinates([worker, planner, critic]);

        try {
            // Wait 5 seconds before each persona to cooldown
            console.log("Cooling down API (5s)...");
            await sleep(5000);
            
            const result = await orchestrator.executeWorkflow(p.requirement, {
                paradigm: p.paradigm,
                agents: [manager, worker, planner, critic],
                maxIterations: 1 // Keep it swift for validation
            }, `REAL_VAL_${Date.now()}`);

            console.log("✅ SUCCESS. Real AI Response Sample:");
            console.log(result.slice(0, 200) + "...");
        } catch (e: any) {
            console.error("❌ REAL API CALL FAILED:", e.message);
        }
    }
}

runRealApiValidation().catch(console.error);
