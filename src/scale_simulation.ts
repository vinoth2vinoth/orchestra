
import { Orchestrator } from './framework/orchestration/Orchestrator.ts';
import { WorkerAgent } from './framework/agents/WorkerAgent.ts';
import { ManagerAgent } from './framework/agents/ManagerAgent.ts';
import { PlannerAgent } from './framework/agents/PlannerAgent.ts';
import { CriticAgent } from './framework/agents/CriticAgent.ts';
import { MemoryMesh } from './framework/memory/MemoryMesh.ts';
import { globalRegistry } from './framework/agents/AgentRegistry.ts';
import { SimulationManager } from './framework/core/SimulationManager.ts';

async function runScaleSimulation(personaCount: number) {
    console.log(`\n🚀 STARTING ORCHESTRA SCALE SIMULATION (${personaCount} PERSONAS)`);
    SimulationManager.enable();

    const orchestrator = new Orchestrator();
    const memory = new MemoryMesh();

    // Generate personas
    const domains = ["FinTech", "HealthTech", "Logistics", "EdTech", "InsurTech", "CyberSecurity", "SpaceTech", "BioTech"];
    const requirements = [
        "Design a high-frequency trading algorithm with risk management.",
        "Architect a HIPAA-compliant data pipeline for patient records.",
        "Optimize a global supply chain using real-time IoT telemetry.",
        "Build a personalized learning platform with adaptive testing.",
        "Create an automated claims processing system using vision AI.",
        "Develop a zero-trust network boundary with proactive threat hunting.",
        "Model a debris removal satellite constellation trajectory.",
        "Simulate protein folding using distributed GPU clusters."
    ];

    const personas = Array.from({ length: personaCount }).map((_, i) => ({
        id: `P-${i}`,
        role: `CEO of ${domains[i % domains.length]} Organization ${i}`,
        requirement: requirements[i % requirements.length],
        paradigm: (i % 3 === 0 ? 'HIERARCHICAL' : (i % 3 === 1 ? 'SWARM' : 'MOA')) as any
    }));

    console.log(`Personas generated. Launching asynchronous swarm...`);
    const startTime = Date.now();

    // Execute in batches of 20 to avoid massive CPU spike in one tick, but still very fast
    const batchSize = 20;
    const results = [];

    for (let i = 0; i < personas.length; i += batchSize) {
        const batch = personas.slice(i, i + batchSize);
        console.log(`Processing Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(personaCount/batchSize)}...`);
        
        const batchPromises = batch.map(async (p) => {
            // Each persona gets its own sub-swarm
            const manager = new ManagerAgent(`Manager-${p.id}`, p.role, "MANAGER", memory, {} as any);
            const worker = new WorkerAgent(`Worker-${p.id}`, "Specialist", "WORKER", memory, {} as any);
            const planner = new PlannerAgent(`Planner-${p.id}`, "Architect", "PLANNER", memory, {} as any);
            
            // Note: In real app we'd register them, but for simulation we just pass them to orchestrator
            try {
                const result = await orchestrator.executeWorkflow(p.requirement, {
                    paradigm: p.paradigm,
                    agents: [manager, worker, planner],
                    maxIterations: 1
                }, `THREAD_${p.id}`);
                return { id: p.id, status: 'SUCCESS' };
            } catch (err) {
                return { id: p.id, status: 'FAILED', error: err.message };
            }
        });

        results.push(...(await Promise.all(batchPromises)));
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.status === 'SUCCESS').length;

    console.log(`\n=== SCALE TEST COMPLETE ===`);
    console.log(`Total Personas: ${personaCount}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${personaCount - successCount}`);
    console.log(`Total Time: ${(duration/1000).toFixed(2)}s`);
    console.log(`Throughput: ${(personaCount / (duration/1000)).toFixed(2)} req/sec`);
    
    if (results.some(r => r.status === 'FAILED')) {
        console.log("\nSample Failures:");
        console.log(results.filter(r => r.status === 'FAILED').slice(0, 3));
    }

    SimulationManager.disable();
}

const args = process.argv.slice(2);
const count = parseInt(args[0]) || 100;

runScaleSimulation(count).catch(console.error);
