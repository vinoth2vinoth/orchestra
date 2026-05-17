import { config } from 'dotenv';
config();

import { globalPluginRegistry } from './src/framework/core/PluginRegistry.ts';
import { globalRegistry, AgentRegistry } from './src/framework/agents/AgentRegistry.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { ToolRegistry, globalToolRegistry } from './src/framework/tools/ToolRegistry.ts';
import { globalSecretVault } from './src/framework/security/SecretVault.ts';
import { z } from 'zod';

import { registerEnterpriseFeatures } from './src/framework/plugins/EnterpriseFeatures.ts';
registerEnterpriseFeatures();

const globalMemory = new MemoryMesh();

globalToolRegistry.register(
    'fail_tool',
    'A tool that fails',
    z.object({}),
    async () => {
        throw new Error('This tool is designed to fail for metrics testing');
    }
);

async function testTelemetry() {
    const worker = new WorkerAgent(
        'TelemetryTestAgent',
        'You are an agent that uses a failing tool.',
        'WORKER',
        globalMemory,
        { apiKey: 'mock', modelName: 'mock-model' },
        []
    );
    globalRegistry.register(worker);

    const orchestrator = new Orchestrator();
    
    console.log('Testing Swarm to trigger OTel Spans...');
    try {
        await orchestrator.executeWorkflow(
            'Use the fail_tool',
            {
                paradigm: 'SWARM',
                agents: [worker]
            },
            'THREAD_OTEL_TEST_1'
        );
    } catch (e) {
        console.log('Execution finished with (expected) error:', e.message);
    }

    setTimeout(() => {
        console.log('[Test] Flushing traces and exiting...');
        process.exit(0);
    }, 2000); // give OTel time to flush
}

testTelemetry();
