import { config } from 'dotenv';
config();

import { globalToolRegistry } from './src/framework/tools/ToolRegistry.ts';
import { globalSecretVault } from './src/framework/security/SecretVault.ts';
import { globalIAMInterceptor } from './src/framework/security/IAMInterceptor.ts';
import { globalRegistry } from './src/framework/agents/AgentRegistry.ts';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.ts';
import { Orchestrator } from './src/framework/orchestration/Orchestrator.ts';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.ts';
import { z } from 'zod';

const globalMemory = new MemoryMesh();

async function testSecurity() {
    // 1. Setup Tenant and Secrets
    const tenantId = 'TENANT_A';
    globalSecretVault.setSecret(tenantId, 'STRIPE_API_KEY', 'sk_test_123456789');

    // 2. Setup RBAC Policy
    globalIAMInterceptor.registerPolicy({
        tenantId,
        allowedTools: ['chargeCreditCard'],
        requiredSecrets: {
            'chargeCreditCard': ['STRIPE_API_KEY']
        }
    });

    // 3. Register Tool that expects the injected secret
    globalToolRegistry.register(
        'chargeCreditCard',
        'Charge a credit card using Stripe',
        z.object({
            amount: z.number().describe('The amount to charge'),
            currency: z.string().describe('The currency (e.g. USD)'),
            _secrets: z.any().optional().describe('Injected secrets')
        }),
        async ({ amount, currency, _secrets }) => {
            const apiKey = _secrets?.STRIPE_API_KEY;
            if (!apiKey) {
                return '[Tool Error] Missing STRIPE_API_KEY!';
            }
            return `SUCCESS: Charged ${amount} ${currency} using API key ${apiKey.substring(0, 7)}...`;
        },
        { capabilities: ['billing'] }
    );

    // 4. Create an Agent that has the capability to bill
    const worker = new WorkerAgent(
        'BillingSpecialist',
        'You handle billing requests. You MUST use the chargeCreditCard tool.',
        'WORKER', // the missing role
        globalMemory,
        { apiKey: 'mock', modelName: 'claude-3-haiku-20240307', temperature: 0 },
        ['billing']
    );
    globalRegistry.register(worker);

    // 5. Run it
    const orchestrator = new Orchestrator();
    
    console.log('Testing Tenant A Request...');
    const result = await orchestrator.executeWorkflow(
        'Charge $50 USD to the user',
        {
            paradigm: 'SWARM',
            agents: [worker],
            blackboard: {
                _tenantId: tenantId
            }
        },
        'TEST_THREAD_1'
    );
    
    console.log(JSON.stringify(result, null, 2));

    // 6. Test Tenant B (No access/secrets)
    const tenantB = 'TENANT_B';
    globalSecretVault.setSecret(tenantB, 'GITHUB_TOKEN', 'ghp_abc');
    globalIAMInterceptor.registerPolicy({
        tenantId: tenantB,
        allowedTools: [],
        requiredSecrets: {}
    });

    console.log('\nTesting Tenant B Request (Should fail)...');
    try {
        const resultB = await orchestrator.executeWorkflow(
            'Charge $50 USD to the user',
            {
                paradigm: 'SWARM',
                agents: [worker],
                blackboard: {
                    _tenantId: tenantB
                }
            },
            'TEST_THREAD_2'
        );
        console.log(JSON.stringify(resultB, null, 2));
    } catch (err: any) {
        console.error('Tenant B correctly failed:', err.message);
    }
}

testSecurity().catch(console.error);
