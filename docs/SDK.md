# Orchestra SDK Guide

This guide describes the public TypeScript surface that examples and downstream projects should use.

The stable entrypoint is:

```typescript
import { Orchestrator, WorkerAgent, MemoryMesh } from '../src/framework/index.ts';
```

Avoid importing from deep framework paths in examples or downstream integrations. Deep modules can change as the runtime evolves; `src/framework/index.ts` is the compatibility boundary.

## Build Your First Workflow

```typescript
import { MemoryMesh, Orchestrator, WorkerAgent, type LLMConfig } from '../src/framework/index.ts';

const memory = new MemoryMesh({ tenantId: 'demo', namespace: 'first-workflow' });
const llmConfig: LLMConfig = {
  apiKey: process.env.GEMINI_API_KEY ?? 'SIMULATION_ONLY',
  modelName: process.env.LLM_MODEL ?? 'gemini-2.5-flash'
};

const researcher = new WorkerAgent(
  'Researcher',
  'Find factual context and summarize it clearly.',
  'WORKER',
  memory,
  llmConfig,
  ['research']
);

const result = await new Orchestrator().executeWorkflow(
  'Summarize the release risks for a new API endpoint.',
  {
    paradigm: 'SWARM',
    agents: [researcher],
    enableLearning: false,
    enableReflection: false
  },
  'demo-thread'
);

console.log(result);
```

## Create A Custom Agent

Extend `BaseAgent` when you need deterministic behavior, a custom tool bridge, or a test double.

```typescript
import { BaseAgent, MemoryMesh, type LLMConfig } from '../src/framework/index.ts';

class DeterministicReviewer extends BaseAgent {
  constructor(memory: MemoryMesh, llmConfig: LLMConfig) {
    super('Reviewer', 'Applies deterministic release policy.', 'WORKER', memory, llmConfig, ['review']);
  }

  async execute(task: { changedFiles: string[] }) {
    return {
      status: task.changedFiles.length > 0 ? 'REVIEW_REQUIRED' : 'APPROVED'
    };
  }
}
```

Use this pattern for tests and reference apps that should not spend provider tokens.

## Add A Tool Safely

Register tools through `ToolRegistry` with a schema and explicit capabilities.

```typescript
import { ToolRegistry } from '../src/framework/index.ts';
import { z } from 'zod';

const tools = new ToolRegistry();

tools.register(
  'lookupTicket',
  'Fetch a support ticket by ID.',
  z.object({ ticketId: z.string().min(1) }),
  async ({ ticketId }) => ({ ticketId, status: 'open' }),
  { capabilities: ['support'] }
);
```

For high-risk tools, set `highRisk: true` so human approval can guard execution.

## Plug In Tool Providers

Built-in tools such as `webSearch`, `databaseQuery`, and `ragSearch` stay in mock mode by default. In live mode, pass provider adapters through the runtime instead of editing framework files.

```typescript
import { Orchestrator, ToolProviderRegistry } from '../src/framework/index.ts';

const toolProviders = new ToolProviderRegistry({
  webSearch: {
    async search(query, options, context) {
      return [
        {
          title: `Result for ${query}`,
          url: 'https://example.com/result',
          snippet: `Tenant ${context.tenantId}, limit ${options.numResults}`
        }
      ];
    }
  }
});

const orchestrator = new Orchestrator({
  tenantId: 'demo',
  toolProviders
});
```

This keeps live integrations replaceable. Use `ORCHESTRA_TOOL_WEBSEARCH_MODE=live`, `ORCHESTRA_TOOL_DATABASEQUERY_MODE=live`, or `ORCHESTRA_TOOL_RAGSEARCH_MODE=live` only after registering the matching provider.

## Scope Secrets Per Runtime

Use a runtime-scoped `SecretStore` when tools need secrets. `SecretVault` is the in-memory local implementation; scoped stores keep tests, tenants, and AI Agent workflows from relying on shared secret state.

```typescript
import { IAMInterceptor, SecretVault, createRuntimeContext } from '../src/framework/index.ts';

const secretVault = new SecretVault();
secretVault.setSecret('tenant-a', 'searchApiKey', process.env.SEARCH_API_KEY!);

const iamInterceptor = new IAMInterceptor({ secretVault });
iamInterceptor.registerPolicy({
  tenantId: 'tenant-a',
  allowedTools: ['webSearch'],
  requiredSecrets: { webSearch: ['searchApiKey'] }
});

const runtime = createRuntimeContext({
  tenantId: 'tenant-a',
  secretVault,
  iamInterceptor
});
```

## Swap State Backends

Use the `StateAdapter` contract when you need durable or distributed state. The default is in-memory for local development.

```typescript
import { KeyValueStateAdapter, MemoryStateAdapter, type StateAdapter } from '../src/framework/index.ts';

const local: StateAdapter = new MemoryStateAdapter();
const durable: StateAdapter = new KeyValueStateAdapter(process.env.ORCHESTRA_STATE_URL!);

await local.increment('counter');
await durable.compareAndSwap('release:gate', null, { status: 'pending' });
```

The key-value adapter uses the Redis-compatible protocol and is tested with Valkey in CI. Keep application code typed against `StateAdapter` so the backend remains replaceable.

## Choose Providers Explicitly

`LLMConfig.provider` lets callers choose the provider instead of relying on API-key guessing. Use `baseURL` with `provider: 'openai'` for OpenAI-compatible local or hosted gateways.

Provider failures should be honest. Configure `fallbackConfig` when you want Orchestra to try a second real provider. Simulation fallback is off by default; set `allowSimulationFallback: true` only for demos or deterministic tests where fake output is acceptable.

```typescript
import { ProviderRegistry, type LLMConfig } from '../src/framework/index.ts';

const localProvider: LLMConfig = {
  provider: 'openai',
  apiKey: process.env.LOCAL_LLM_API_KEY,
  baseURL: process.env.LOCAL_LLM_BASE_URL,
  modelName: 'local-model',
  useNativeREST: true
};

const fallbackProvider: LLMConfig = {
  ...localProvider,
  fallbackConfig: {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
    modelName: 'gemini-2.5-flash'
  }
};

await ProviderRegistry.generate(fallbackProvider, 'Follow policy.', [
  { role: 'user', content: 'Summarize release risk.' }
]);
```

Validate provider contracts without real API spend:

```bash
npm run test:providers
```

## Add Runtime Plugins

Plugins are lifecycle hooks. Pass a scoped `PluginRegistry` into `Orchestrator` to avoid global test or tenant coupling.

```typescript
import { Orchestrator, PluginRegistry, type AgenticPlugin } from '../src/framework/index.ts';

const plugin: AgenticPlugin = {
  name: 'AuditMetadataPlugin',
  version: '1.0.0',
  async beforeAgentExecute(_agentId, task) {
    return { ...task, auditMetadata: { source: 'sdk-guide' } };
  }
};

const pluginRegistry = new PluginRegistry();
pluginRegistry.register(plugin);

const orchestrator = new Orchestrator({
  tenantId: 'tenant-a',
  pluginRegistry
});
```

## Run Deterministic Validation

Useful SDK-facing checks:

```bash
npm run test:sdk
npm run test:providers
npm run examples:check
npm run test:reference
```

`npm run test:sdk` proves that the public entrypoint supports workflow construction, state adapters, memory search, runtime plugins, and example import hygiene.

## Public Surface

The public entrypoint currently exposes:

- Agents: `BaseAgent`, `WorkerAgent`, `ManagerAgent`, `PlannerAgent`, `CriticAgent`
- Orchestration: `Orchestrator`, `WorkflowConfig`, `Paradigm`
- Runtime: `createRuntimeContext`, `RuntimeContextOptions`, `PluginRegistry`, `AgenticPlugin`
- State and queue: `StateAdapter`, `MemoryStateAdapter`, `KeyValueStateAdapter`, `QueueBroker`
- Memory: `MemoryMesh`, `MemoryMeshOptions`
- Governance and safety: `PolicyEngine`, `AuditLog`, `Sanitizer`, `createApiAuthMiddleware`
- Events and errors: `EventStore`, `FrameworkEvent`, `AgentFrameworkError`, `ConfigurationError`
- LLM: `ProviderRegistry`, `LLMConfig`, `LLMResponse`, `ProviderType`, `ModelTier`

New examples should import only from `src/framework/index.ts`; the SDK contract test enforces this.
