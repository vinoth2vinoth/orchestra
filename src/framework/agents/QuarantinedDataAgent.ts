import { BaseAgent } from './BaseAgent.ts';
import { MemoryMesh } from '../memory/MemoryMesh.ts';
import { LLMConfig } from '../llm/ProviderRegistry.ts';
import { CaMeLSandbox } from '../security/CaMeLSandbox.ts';
import { RuntimeContextOptions, RuntimeServices } from '../core/RuntimeContext.ts';

export class QuarantinedDataAgent extends BaseAgent {
    private sandbox: CaMeLSandbox;
    private systemInstruction: string;

    constructor(
        name: string,
        systemInstruction: string,
        memory: MemoryMesh,
        privilegedConfig: LLMConfig,
        quarantinedConfig: LLMConfig,
        runtime?: RuntimeContextOptions
    ) {
        super(name, systemInstruction, 'WORKER', memory, privilegedConfig, [], undefined, undefined, undefined, undefined, runtime);
        this.systemInstruction = systemInstruction;
        this.sandbox = new CaMeLSandbox(privilegedConfig, quarantinedConfig, this.runtime.eventStore);
        this.card.capabilities = []; // Q-LLM has NO TOOLS explicitly.
    }

    public override setRuntimeContext(runtime: RuntimeServices | RuntimeContextOptions) {
        super.setRuntimeContext(runtime);
        this.sandbox.setEventStore(this.runtime.eventStore);
    }

    public async execute(untrustedData: any, threadId: string): Promise<any> {
         this.runtime.eventStore.append({
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

         this.runtime.eventStore.append({
            type: 'LLM_GENERATION_COMPLETED',
            sourceAgentId: this.card.id,
            threadId,
            payload: { result: "Sterilized data extracted" }
         });

         return sterileData;
    }
}
