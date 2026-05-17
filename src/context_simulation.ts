
import { ProviderRegistry } from './framework/llm/ProviderRegistry.ts';
import { ContextOptimizer } from './framework/llm/ContextOptimizer.ts';
import { globalSummarizer } from './framework/memory/SummarizerAgent.ts';

async function runContextSimulation() {
    console.log("🚀 Starting Context Compression Simulation...");
    
    // 1. Mock a long conversational history (25 turns)
    const history = [];
    for (let i = 1; i <= 25; i++) {
        history.push({ 
            role: i % 2 === 0 ? 'assistant' : 'user', 
            content: `Interaction turn ${i}: Discussing technical component ${Math.random().toString(36).substring(7)}.`
        });
    }

    console.log(`\n📊 Initial History Size: ${history.length} messages.`);
    console.log("🛠️ Triggering Context Optimization (Threshold: 20 messages)...");

    // 2. Run the optimizer directly to inspect the result
    const start = Date.now();
    const optimized = await ContextOptimizer.optimizeMessages(
        history, 
        { summarizeAfterCount: 20 },
        (h) => globalSummarizer.execute(h)
    );
    const duration = Date.now() - start;

    console.log(`\n✅ Optimization Complete in ${duration}ms`);
    console.log(`📉 Optimized History Size: ${optimized.length} messages.`);
    
    // 3. Inspect the injected summary
    const summaryMsg = optimized.find(m => m.content.includes('[LONG_TERM_MEMORY_SUMMARY]'));
    
    if (summaryMsg) {
        console.log("\n✨ CONTEXT COMPRESSOR OUTPUT:");
        console.log("--------------------------------------------------");
        console.log(summaryMsg.content);
        console.log("--------------------------------------------------");
    } else {
        console.log("\n❌ Error: Summary injection failed.");
    }

    // 4. Verify that the most recent messages are intact
    const lastInteraction = optimized[optimized.length - 1];
    console.log(`\n🎯 Latest Interaction Preserved: "${lastInteraction.content}"`);
}

runContextSimulation().catch(console.error);
