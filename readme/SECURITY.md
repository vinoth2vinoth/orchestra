# Orchestra Security Architecture

Orchestra implements a Multi-Dimension Defense strategy to ensure agentic reliability and data privacy.

## 1. Data-at-Rest Protection (AES-256-GCM)
All workflow checkpoints are encrypted using hardware-accelerated AES-256-GCM before being written to storage. This prevents sensitive workflow state from being leaked via storage snapshots.

**Implementation**: `Checkpointer.ts`

```ts
// Example of secured state
const securedData = await checkpointer.encrypt(JSON.stringify(workflowState));
```

## 2. Sterile Wrapping (Dimension 10)
Untrusted content (e.g. from the web, external tools, or user inputs) is wrapped in "Sterile Containers" using cryptographically tagged tags. This prevents prompt induction and injection by clearly demarcating what is "instruction" vs "data".

**Implementation**: `Sanitizer.ts`, `BaseAgent.ts`

```markdown
<UNTRUSTED_CONTENT>
[Untrusted data here]
</UNTRUSTED_CONTENT>
```

## 3. Entropy-Based Redaction
Orchestra automatically detects and redacts high-entropy strings (potential API keys, secrets, or tokens) in all logs and events before they are appended to the `EventStore`.

**Implementation**: `Sanitizer.ts`, `EventStore.ts`

## 4. Prompt Injection Detection
The framework uses heuristic pattern matching to detect common injection triggers (e.g., "ignore previous instructions") at the ingestion point (`BaseAgent.generateResponse`).

## 5. Execution Context Isolation
Agents execute within an `ExecutionContext` that binds specific capabilities and thread-level secrets, preventing cross-tenant or cross-thread data leakage.

**Implementation**: `ExecutionContext.ts`, `Orchestrator.ts`
