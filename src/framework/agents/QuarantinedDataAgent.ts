import { BaseAgent } from './BaseAgent.ts';
import { MemoryMesh } from '../memory/MemoryMesh.ts';
import { LLMConfig } from '../llm/ProviderRegistry.ts';
import { CaMeLSandbox } from '../security/CaMeLSandbox.ts';
import { globalEventStore } from '../core/EventStore.ts';

export class QuarantinedDataAgent extends BaseAgent {
    private sandbox: CaMeLSandbox;
    private systemInstruction: string;

    constructor(
        name: string,
        systemInstruction: string,
        memory: MemoryMesh,
        privilegedConfig: LLMConfig,
        quarantinedConfig: LLMConfig
    ) {
        super(name, systemInstruction, 'WORKER', memory, privilegedConfig);
        this.systemInstruction = systemInstruction;
        this.sandbox = new CaMeLSandbox(privilegedConfig, quarantinedConfig);
        this.card.capabilities = []; // Q-LLM has NO TOOLS explicitly.
    }

    public async execute(untrustedData: any, threadId: string): Promise<any> {
         globalEventStore.append({
            type: 'LLM_GENERATION_STARTED',
            sourceAgentId: this.card.id,
            threadId,
            payload: { task: "Evaluating untrusted data in sandbox" }
         });

         const sterileData = await this.sandbox.evaluateDataFlow(
            threadId, 
            String(untrustedData), 
            this.systemInstruction
         );

         globalEventStore.append({
            type: 'LLM_GENERATION_COMPLETED',
            sourceAgentId: this.card.id,
            threadId,
            payload: { result: "Sterilized data extracted" }
         });

         return sterileData;
    }
}
